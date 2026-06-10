/**
 * migrate-from-excel.js
 *
 * Migrates historical data from Ponniamman_Accounts.xlsm into MongoDB:
 *
 *  Sheet "Pooja Entry"    → PoojaSchedule + Donation (temple-funded, status=approved)
 *  Sheet "Donations Entry" → Donation (donor-funded, linked to PoojaSchedule)
 *  Sheet "Expenses Entry" → Expense + VendorTransaction
 *
 * Safe to re-run: upserts on natural keys (date+type for schedule, date+donor+amount for donations).
 *
 * Usage:
 *   cd spt-api
 *   node scripts/migrate-from-excel.js [path/to/file.xlsm]
 *
 * Requires: npm install xlsx
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const path              = require('path');
const XLSX              = require('xlsx');

const Donation          = require('../models/Donation');
const Expense           = require('../models/Expense');
const VendorTransaction = require('../models/VendorTransaction');
const PoojaSchedule     = require('../models/PoojaSchedule');
const AppConfig         = require('../models/AppConfig');

// ── Config ────────────────────────────────────────────────
const EXCEL_FILE = process.argv[2]
  || path.join(__dirname, '../SPT_Accounts (1)-4e39878b.xlsx');
const RCP_YEAR   = '2026';
const DRY_RUN    = process.argv.includes('--dry-run');

// ── Lunar helpers ─────────────────────────────────────────
const SYNODIC_MS      = 29.530588853 * 24 * 60 * 60 * 1000;
const REF_NEW_MOON_MS = new Date('2025-01-29T12:36:00Z').getTime();
const IST_OFFSET_MS   = 5.5 * 60 * 60 * 1000;
const DAY_NAMES       = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function lunarPhases(year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1)).getTime();
  const to   = new Date(Date.UTC(year, month, 1)).getTime();
  const amavasai = [], pournami = [];
  const sc = Math.floor((from - REF_NEW_MOON_MS) / SYNODIC_MS);
  for (let i = sc - 1; i <= sc + 3; i++) {
    const nmIst = new Date(REF_NEW_MOON_MS + i * SYNODIC_MS + IST_OFFSET_MS);
    const nm = new Date(Date.UTC(nmIst.getUTCFullYear(), nmIst.getUTCMonth(), nmIst.getUTCDate()));
    if (nm >= from && nm < to) amavasai.push(nm);
    const fmIst = new Date(REF_NEW_MOON_MS + (i + 0.5) * SYNODIC_MS + IST_OFFSET_MS);
    const fm = new Date(Date.UTC(fmIst.getUTCFullYear(), fmIst.getUTCMonth(), fmIst.getUTCDate()));
    if (fm >= from && fm < to) pournami.push(fm);
  }
  return { amavasai, pournami };
}

// Classify a date: returns dayType for standard slots
function classifyDate(d) {
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1;
  const { amavasai, pournami } = lunarPhases(year, month);
  const isoD = d.toISOString().split('T')[0];
  if (amavasai.some(x => x.toISOString().split('T')[0] === isoD)) return 'Amavasai';
  if (pournami.some(x => x.toISOString().split('T')[0] === isoD)) return 'Pournami';
  const dow = d.getUTCDay();
  if (dow === 2) return 'Tuesday';
  if (dow === 5) return 'Friday';
  if (dow === 0) return 'Sunday';
  return 'Special';
}

// Normalize date from Excel to UTC midnight
function toUTCDate(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d)) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// Map pooja type strings from Excel to canonical names
function normalizePoojaType(rawType, purpose) {
  const t = (rawType || '').toLowerCase().trim();
  const p = (purpose || '').toLowerCase();
  if (t.includes('special')) return 'Weekly Pooja';  // Special pooja = special variant of weekly
  if (t.includes('regular')) return 'Weekly Pooja';
  if (p.includes('birthday')) return 'Birthday Pooja';
  if (p.includes('anniversary')) return 'Anniversary Pooja';
  return 'Weekly Pooja';
}

function normalizePoojaVariant(rawType) {
  const t = (rawType || '').toLowerCase();
  return t.includes('special') ? 'Special' : 'Regular';
}

// Map donation purpose to donType
function normalizeDonType(purpose) {
  const p = (purpose || '').toLowerCase();
  if (p.includes('birthday'))    return 'Birthday Pooja';
  if (p.includes('anniversary')) return 'Anniversary Pooja';
  if (p.includes('special'))     return 'Birthday Pooja';
  // All others = Weekly Pooja donation (toward pooja / regular pooja)
  return 'Weekly Pooja';
}

// ── Read Excel ────────────────────────────────────────────
function readSheet(wb, sheetName, skipRows = 4) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const dataRows = rows.slice(skipRows).filter(r => r[0] !== null && r[0] !== undefined);
  return dataRows;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB');
  if (DRY_RUN) console.log('  (DRY RUN — no writes)\n');

  // Read Excel
  console.log(`\nReading: ${EXCEL_FILE}`);
  const wb = XLSX.readFile(EXCEL_FILE, { cellDates: true });
  console.log('Sheets found:', wb.SheetNames.join(', '));

  const poojaRows    = readSheet(wb, 'Pooja Entry');
  const donationRows = readSheet(wb, 'Donations Entry');
  const expenseRows  = readSheet(wb, 'Expenses Entry');

  console.log(`\nPooja rows: ${poojaRows.length} | Donation rows: ${donationRows.length} | Expense rows: ${expenseRows.length}\n`);

  // ── STEP 1: Process Pooja Entry → PoojaSchedule + Donation ──
  console.log('── Step 1: Pooja Entry → PoojaSchedule ─────────────────');
  // Columns: Date, Pooja Type, Rate, Devotee Name, Receipt No, Notes
  const scheduleMap = new Map(); // isoDate+type → _id
  let schCreated = 0, schLinked = 0;

  for (const row of poojaRows) {
    const [dateVal, rawType, , devoteeName, , notes] = row;
    const poojaDate  = toUTCDate(dateVal);
    if (!poojaDate) continue;

    const poojaType    = normalizePoojaType(rawType, devoteeName);
    const poojaVariant = normalizePoojaVariant(rawType);
    const dayType      = classifyDate(poojaDate);
    const isTemple     = !devoteeName || devoteeName.toLowerCase() === 'temple' ||
                         devoteeName.toLowerCase().startsWith('by ponniamman') ||
                         devoteeName.toLowerCase().startsWith('temple');

    const slotKey = `${poojaDate.toISOString().split('T')[0]}|${poojaType}`;

    const slotData = {
      poojaDate,
      year:         poojaDate.getUTCFullYear(),
      month:        poojaDate.getUTCMonth() + 1,
      dayType,
      poojaType,
      poojaVariant,
      personName:   isTemple ? '' : (devoteeName || ''),
      status:       isTemple ? 'temple_funded' : 'donor_funded',
      isTempleFunded: isTemple,
      approvalStatus: isTemple ? 'approved' : null,
      notes:        notes || '',
    };

    let slot;
    if (!DRY_RUN) {
      slot = await PoojaSchedule.findOneAndUpdate(
        { poojaDate, poojaType },
        { $set: slotData },
        { upsert: true, new: true }
      );
      scheduleMap.set(slotKey, slot._id);
      schCreated++;
    } else {
      const iso = poojaDate.toISOString().split('T')[0];
      console.log(`  [dry] ${iso} ${dayType} — ${poojaType} (${poojaVariant}) | ${isTemple ? 'Temple' : devoteeName}`);
      schCreated++;
    }
  }
  console.log(`  Created/updated ${schCreated} PoojaSchedule entries\n`);

  // ── STEP 2: Process Donations → Donation + link to schedule ──
  console.log('── Step 2: Donations Entry → Donation ──────────────────');
  // Columns: Date, Donor Name, Amount, Purpose, Receipt No, Comment
  const seqCache = {};
  async function nextSeq(type) {
    return await AppConfig.nextSeq(type);
  }

  let donCreated = 0, donLinked = 0;

  for (const row of donationRows) {
    const [dateVal, donorName, amountRaw, purpose, existingReceipt, comment] = row;
    const donDate = toUTCDate(dateVal);
    if (!donDate || !donorName) continue;

    const amount  = parseFloat(amountRaw) || 0;
    const donType = normalizeDonType(purpose);
    const year    = donDate.getUTCFullYear();
    const yearStr = String(year);

    // Generate receipt
    const seq = await nextSeq('donation');
    const receiptNo = existingReceipt || `${yearStr}/D/${seq}`;

    // Find matching PoojaSchedule slot
    const slotKey = `${donDate.toISOString().split('T')[0]}|${donType}`;
    const scheduleId = scheduleMap.get(slotKey) || null;

    const donDoc = {
      receiptNo,
      date:       donDate,
      poojaDate:  donDate,
      donor:      donorName.trim(),
      amount,
      received:   amount,
      balance:    0,
      mode:       'Cash',
      status:     amount > 0 ? 'Received' : 'Pending',
      donType,
      poojaType:  donType,
      poojaVariant: 'Regular',
      notes:      (purpose || '') + (comment ? ` | ${comment}` : ''),
      year,
      isPending:  false,
      poojaScheduleId: scheduleId,
    };

    if (!DRY_RUN) {
      const don = await Donation.findOneAndUpdate(
        { receiptNo },
        { $set: donDoc },
        { upsert: true, new: true }
      );
      // Update schedule to link this donor
      if (scheduleId) {
        await PoojaSchedule.updateOne(
          { _id: scheduleId },
          { $set: {
            status:     'donor_funded',
            donationId: don._id,
            receiptNo,
          }}
        );
        donLinked++;
      }
      donCreated++;
    } else {
      const iso = donDate.toISOString().split('T')[0];
      console.log(`  [dry] ${iso} | ${donorName} | ₹${amount} | ${donType} ${scheduleId ? '→ linked' : '(no slot)'}`);
      donCreated++;
    }
  }
  console.log(`  Created ${donCreated} donation(s), linked ${donLinked} to schedule\n`);

  // ── STEP 3: Process Expenses ──────────────────────────────
  console.log('── Step 3: Expenses Entry → Expense + VendorTransaction ');
  // Columns: Date, Expense Category, Service Provider, Amount, Payment Mode, Notes
  //
  // Vendor split:
  //   Payable vendors (recurring) → Expense + VendorTransaction
  //   One-off purchases           → Expense only (no VendorTransaction)
  const PAYABLE_VENDORS = new Set([
    'saravana', 'saravana brother', 'dhamodhar', 'elango', 'udaya',
  ]);
  function isPayableVendor(name) {
    return PAYABLE_VENDORS.has((name || '').toLowerCase().trim());
  }

  let expCreated = 0, vtxnCreated = 0;

  // Group by date (each pooja day = one expense group)
  const expGroups = new Map();
  for (const row of expenseRows) {
    const [dateVal, category, vendor, amountRaw, mode, notes] = row;
    const expDate = toUTCDate(dateVal);
    if (!expDate || !vendor) continue;
    const iso = expDate.toISOString().split('T')[0];
    if (!expGroups.has(iso)) expGroups.set(iso, []);
    expGroups.get(iso).push({
      expDate, category, vendor: (vendor || '').toString().trim(),
      amount: parseFloat(amountRaw) || 0, mode: mode || 'Cash', notes,
    });
  }

  for (const [iso, lines] of expGroups) {
    const expDate    = lines[0].expDate;
    const totalCost  = lines.reduce((s, l) => s + l.amount, 0);
    const notes      = lines.find(l => l.notes)?.notes || '';
    const poojaLabel = notes.toLowerCase().includes('special') ? 'Special' : 'Regular';
    const year       = expDate.getUTCFullYear();
    const yearStr    = String(year);

    // One Expense record per day
    const expSeq    = await nextSeq('expense');
    const voucherNo = `${yearStr}/EXP/${expSeq}`;
    const label     = `Weekly Pooja (${poojaLabel}) — ${iso}`;

    if (!DRY_RUN) {
      await Expense.findOneAndUpdate(
        { voucherNo },
        { $set: {
          voucherNo,
          date:        expDate,
          vendor:      'Temple Fund',
          description: label,
          category:    'Puja & Rituals',
          expType:     'Temple Operations',
          amount:      totalCost,
          mode:        'Cash',
          paidBy:      '',
          year,
        }},
        { upsert: true }
      );
      expCreated++;

      // VendorTransaction only for recurring payable vendors
      for (const line of lines) {
        if (!isPayableVendor(line.vendor)) {
          console.log(`    [skip vtxn] ${iso} | ${line.vendor} ₹${line.amount} → Expense only`);
          continue;
        }
        await VendorTransaction.create({
          vendorName:  line.vendor,
          date:        line.expDate,
          description: label,
          item:        line.category || '',
          credit:      line.amount,
          debit:       0,
          refType:     'pooja',
          refId:       voucherNo,
          poojaName:   'Weekly Pooja',
          variant:     poojaLabel,
          isSettled:   false,
        });
        vtxnCreated++;
      }

      // Link expense voucherNo to PoojaSchedule slot
      await PoojaSchedule.updateOne(
        { poojaDate: expDate, poojaType: 'Weekly Pooja' },
        { $set: { expenseVoucherNo: voucherNo } }
      );
    } else {
      const payableLines = lines.filter(l => isPayableVendor(l.vendor));
      const skipLines    = lines.filter(l => !isPayableVendor(l.vendor));
      console.log(`  [dry] ${iso} | ₹${totalCost} | ${label}`);
      if (skipLines.length) {
        skipLines.forEach(l => console.log(`    → Expense only: ${l.vendor} ₹${l.amount}`));
      }
      expCreated++;
    }
  }
  console.log(`  Created ${expCreated} expense(s) + ${vtxnCreated} vendor transaction(s)\n`);

  // ── Summary ───────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log('── Summary ──────────────────────────────────────────────');
    console.log(`  PoojaSchedule : ${await PoojaSchedule.countDocuments()}`);
    console.log(`  Donations     : ${await Donation.countDocuments()}`);
    console.log(`  Expenses      : ${await Expense.countDocuments()}`);
    console.log(`  VendorTxns    : ${await VendorTransaction.countDocuments()}`);
  }

  await mongoose.disconnect();
  console.log('\n✓ Migration complete');
}

main().catch(e => { console.error(e); process.exit(1); });
