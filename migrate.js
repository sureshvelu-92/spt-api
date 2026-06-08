/**
 * migrate.js — Import Excel data into MongoDB Atlas
 *
 * Usage:  node migrate.js
 *
 * Reads ./SPT_Accounts (1)-4e39878b.xlsx and inserts:
 *   - Donations  (rows 87–133, sheet "2026")   → donations collection
 *   - Expenses   (rows 41–67,  sheet "2026")   → expenses collection
 *   - InKind     (rows 141–143, sheet "2026")  → inkind collection
 *
 * After inserting, sets AppConfig sequences:
 *   donationSeq=48, expenseSeq=27, inkindSeq=3
 */

'use strict';

require('dotenv').config();

const path     = require('path');
const XLSX     = require('xlsx');
const mongoose = require('mongoose');

const Donation          = require('./models/Donation');
const Expense           = require('./models/Expense');
const InKind            = require('./models/InKind');
const AppConfig         = require('./models/AppConfig');
const VendorTransaction = require('./models/VendorTransaction');
const Transaction       = require('./models/Transaction');
const User              = require('./models/User');

// ── Config ─────────────────────────────────────────────────────────────────────
// Look for the Excel file next to migrate.js first, then fall back to uploads folder
const EXCEL_CANDIDATES = [
  path.join(__dirname, 'SPT_Accounts (1)-4e39878b.xlsx'),
  path.join(__dirname, 'SPT_Accounts (1).xlsx'),
  path.join(require('os').homedir(), 'Library/Application Support/Claude/local-agent-mode-sessions/8d32b9b1-0109-4eed-873a-2d9b72a0e32c/d1c5d627-4dbd-4041-bf9b-c6b67a2269c8/local_a5f659e5-88dd-4896-ab37-c8bd49eb5a81/uploads/SPT_Accounts (1)-4e39878b.xlsx'),
];
const EXCEL_FILE = EXCEL_CANDIDATES.find(f => require('fs').existsSync(f))
  ?? EXCEL_CANDIDATES[0]; // will fail with a clear error if none found
const SHEET_NAME = '2026';

// Row ranges (1-based, inclusive) — map to 0-based array indices
const DONATIONS_ROWS = { start: 87, end: 133 };   // 47 data rows (row 87 may be header)
const EXPENSES_ROWS  = { start: 41, end: 67  };   // 27 data rows
const INKIND_ROWS    = { start: 141, end: 143 };  // 3 data rows

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns true if the donType is a pooja/ceremony that uses vendor breakdown */
function isPoojaType(donType) {
  const t = (donType || '').toLowerCase();
  return t.includes('pooja') || t.includes('anniversary');
}

/**
 * Parse a cell value to a number, returning 0 for blank/invalid.
 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Parse a cell value to a trimmed string, returning '' for blank.
 */
function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Parse a date from either:
 *  - Excel serial number (number)
 *  - String in "DD/MM/YYYY" or "D/M/YYYY" format
 *  - ISO date string
 * Returns a JS Date or null.
 */
function parseDate(v) {
  if (!v && v !== 0) return null;

  // Excel serial number (days since 1899-12-30)
  if (typeof v === 'number') {
    // Convert serial to y/m/d via XLSX helper, then build UTC midnight
    try {
      const p = XLSX.SSF.parse_date_code(v);
      if (p) return new Date(Date.UTC(p.y, p.m - 1, p.d));
    } catch (_) { /* fall through */ }
    // Fallback manual serial → UTC
    const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
    const dt = new Date(EXCEL_EPOCH_MS + v * 86400000);
    return isNaN(dt.getTime()) ? null : dt;
  }

  const s = String(v).trim();
  if (!s) return null;

  // DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY, DD-MM-YY  → store as UTC midnight
  const dmSep = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmSep) {
    const [, d, m, rawY] = dmSep;
    const y = rawY.length === 2 ? (Number(rawY) >= 50 ? 1900 + Number(rawY) : 2000 + Number(rawY)) : Number(rawY);
    const dt = new Date(Date.UTC(y, Number(m) - 1, Number(d)));
    if (!isNaN(dt.getTime())) return dt;
  }

  // ISO string already UTC — parse directly
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Extract a slice of rows from a sheet (1-based start/end, both inclusive).
 * Returns array of raw row arrays (using sheet_to_json with header:1).
 */
function sliceRows(rows, start, end) {
  // rows is 0-based array from header:1 parse
  // Row 1 of the sheet is index 0
  const s = start - 1;
  const e = end;          // slice is exclusive at end, so end (1-based) → index = end-1, slice end = end
  return rows.slice(s, e);
}

/**
 * Check if a row is effectively blank (all cells empty/undefined).
 */
function isBlankRow(row) {
  if (!row) return true;
  return row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
}

// ── Parse functions ────────────────────────────────────────────────────────────

/**
 * Parse donation rows from the sheet.
 * Actual column mapping (0-based) — col 2 is a blank spacer:
 *   0: #(receiptNo)  1: donorName  2: (null/blank)  3: pledged  4: received
 *   5: balance       6: status     7: mode           8: dateReceived
 *   9: receivedBy   10: notes     11: type          12: personName  13: expPayDate
 */
function parseDonations(rows) {
  const slice = sliceRows(rows, DONATIONS_ROWS.start, DONATIONS_ROWS.end);
  const results = [];

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (isBlankRow(row)) continue;

    const receiptNo = toStr(row[0]);
    if (!receiptNo) continue;  // must have receipt number

    const donorName = toStr(row[1]);
    if (!donorName) continue;  // must have donor name

    // col 2 is blank spacer — skip it
    const pledged    = toNumber(row[3]);
    const received   = toNumber(row[4]);
    const balance    = toNumber(row[5]);
    const rawStatus  = toStr(row[6]);
    const mode       = toStr(row[7]) || 'Cash';
    const rawDate    = row[8];
    const receivedBy = toStr(row[9]);
    const notes      = toStr(row[10]);
    const donType    = toStr(row[11]) || 'Others';
    const personName = toStr(row[12]);

    // Normalise status
    let status = 'Pending';
    const sl = rawStatus.toLowerCase();
    if (sl.includes('received') && sl.includes('partial')) {
      status = 'Partially Received';
    } else if (sl.includes('received')) {
      status = 'Received';
    } else if (sl.includes('partial')) {
      status = 'Partially Received';
    }

    const date = parseDate(rawDate) || new Date();

    // Derive year from date
    const year = date.getFullYear();

    // Extract poojaType / poojaVariant
    // donType may directly be the pooja type (e.g. "Birthday Pooja", "Weekly Pooja")
    // or donType === "Pooja" with variant info in notes
    let poojaType    = '';
    let poojaVariant = '';
    if (isPoojaType(donType)) {
      // donType IS the poojaType (e.g. "Birthday Pooja", "Anniversary", "Weekly Pooja")
      poojaType = donType;
      // Check notes for variant "(Regular)" / "(Special)"
      if (notes) {
        const variantMatch = notes.match(/\((Regular|Special)\)/i);
        if (variantMatch) {
          poojaVariant = variantMatch[1];
        }
      }
    }

    results.push({
      receiptNo,
      donor:      donorName,
      amount:     pledged || received,  // amount is the pledged total
      received,
      balance,
      status,
      mode,
      date,
      receivedBy,
      notes,
      donType,
      personName,
      poojaType,
      poojaVariant,
      isPending:  status !== 'Received',
      year,
    });
  }

  console.log(`  Parsed ${results.length} donation rows from Excel.`);
  return results;
}

/**
 * Parse expense rows from the sheet.
 * Column mapping (0-based):
 *   0: voucherNo  1: date  2: vendor  3: description  4: category
 *   5: amount     6: mode  7: paidBy  8: remarks       9: expType
 */
function parseExpenses(rows) {
  const slice = sliceRows(rows, EXPENSES_ROWS.start, EXPENSES_ROWS.end);
  const results = [];

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (isBlankRow(row)) continue;

    const voucherNo = toStr(row[0]);
    if (!voucherNo) continue;

    const rawDate   = row[1];
    const vendor     = toStr(row[2]);
    const description = toStr(row[3]);
    const category   = toStr(row[4]);
    const amount     = toNumber(row[5]);
    const mode       = toStr(row[6]) || 'Cash';
    const paidBy     = toStr(row[7]);
    const remarks    = toStr(row[8]);
    const expType    = toStr(row[9]) || 'Others';

    const date = parseDate(rawDate) || new Date();
    const year = date.getFullYear();

    results.push({
      voucherNo,
      date,
      vendor,
      description,
      category,
      amount,
      mode,
      paidBy,
      remarks,
      expType,
      year,
    });
  }

  console.log(`  Parsed ${results.length} expense rows from Excel.`);
  return results;
}

/**
 * Parse in-kind rows from the sheet.
 * Column mapping (0-based):
 *   0: receiptNo  1: donor  2: itemDesc  3: qty  4: estValue
 *   5: category   6: status 7: dateReceived  8: receivedBy
 */
function parseInKind(rows) {
  const slice = sliceRows(rows, INKIND_ROWS.start, INKIND_ROWS.end);
  const results = [];

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (isBlankRow(row)) continue;

    const receiptNo = toStr(row[0]);
    if (!receiptNo) continue;

    const donor      = toStr(row[1]);
    const itemDesc   = toStr(row[2]);
    const qty        = toStr(row[3]);
    const estValue   = toNumber(row[4]);
    const category   = toStr(row[5]);
    const rawStatus  = toStr(row[6]) || 'In Stock';
    const rawDate    = row[7];
    const receivedBy = toStr(row[8]);

    const date = parseDate(rawDate) || new Date();

    results.push({
      receiptNo,
      donor,
      itemDesc,
      qty,
      estValue,
      category,
      status: rawStatus || 'In Stock',
      date,
      receivedBy,
    });
  }

  console.log(`  Parsed ${results.length} in-kind rows from Excel.`);
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI is not set. Add it to your .env file.');
    process.exit(1);
  }

  console.log('\n=== SPT Excel Migration ===\n');

  // ── 1. Read Excel ─────────────────────────────────────────────────────────
  console.log(`Reading Excel file: ${EXCEL_FILE}`);
  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_FILE);
  } catch (err) {
    console.error(`ERROR: Could not read Excel file.\n  ${err.message}`);
    process.exit(1);
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    console.error(`ERROR: Sheet "${SHEET_NAME}" not found. Available sheets: ${available}`);
    process.exit(1);
  }

  // Parse entire sheet to array-of-arrays (1-based rows, 0-based cols)
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`  Sheet "${SHEET_NAME}" has ${allRows.length} rows total.\n`);

  // ── 2. Parse data ──────────────────────────────────────────────────────────
  console.log('Parsing donations…');
  const donationDocs = parseDonations(allRows);

  console.log('\nParsing expenses…');
  const expenseDocs = parseExpenses(allRows);

  console.log('\nParsing in-kind donations…');
  const inkindDocs = parseInKind(allRows);

  // ── 3. Connect to MongoDB ─────────────────────────────────────────────────
  console.log('\nConnecting to MongoDB Atlas…');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoSelectFamily: false });
    console.log('  Connected.\n');
  } catch (err) {
    console.error(`ERROR: MongoDB connection failed.\n  ${err.message}`);
    process.exit(1);
  }

  // ── Build user lookup map (name → _id) ───────────────────
  const userMap = {};  // e.g. { 'Sunil Kumar': ObjectId, 'Suresh Velu': ObjectId }
  try {
    const users = await User.find({}, '_id name').lean();
    for (const u of users) {
      userMap[u.name.toLowerCase().trim()] = u._id;
    }
    console.log(`  Loaded ${users.length} users for receivedBy/paidBy lookup.`);
  } catch (e) {
    console.log('  WARNING: Could not load users — receivedById/paidById will be null.');
  }

  /** Resolve a name string to a User _id (or null) */
  function resolveUser(name) {
    if (!name) return null;
    return userMap[name.toLowerCase().trim()] || null;
  }

  let insertedDonations   = 0;
  let insertedExpenses    = 0;
  let insertedInKind      = 0;
  let insertedVendorTxns  = 0;
  let insertedTxns        = 0;
  const errors = [];

  try {
    // ── 4. Upsert donations (safe to re-run — matches on receiptNo) ───────────
    if (donationDocs.length > 0) {
      console.log(`Upserting ${donationDocs.length} donations…`);
      try {
        const ops = donationDocs.map(doc => ({
          updateOne: {
            filter: { receiptNo: doc.receiptNo },
            update: { $set: { ...doc, receivedById: resolveUser(doc.receivedBy) } },
            upsert: true,
          },
        }));
        const res = await Donation.bulkWrite(ops, { ordered: false });
        insertedDonations = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
        console.log(`  Upserted ${res.upsertedCount ?? 0} new, updated ${res.modifiedCount ?? 0} existing donations.`);
      } catch (err) {
        errors.push(`Donations: ${err.message}`);
        console.error(`  ERROR upserting donations: ${err.message}`);
      }
    } else {
      console.log('  No donation rows to insert.');
    }

    // ── 5. Upsert expenses (safe to re-run — matches on voucherNo) ─────────────
    if (expenseDocs.length > 0) {
      console.log(`Upserting ${expenseDocs.length} expenses…`);
      try {
        const ops = expenseDocs.map(doc => ({
          updateOne: {
            filter: { voucherNo: doc.voucherNo },
            update: { $set: { ...doc, paidById: resolveUser(doc.paidBy) } },
            upsert: true,
          },
        }));
        const res = await Expense.bulkWrite(ops, { ordered: false });
        insertedExpenses = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
        console.log(`  Upserted ${res.upsertedCount ?? 0} new, updated ${res.modifiedCount ?? 0} existing expenses.`);
      } catch (err) {
        errors.push(`Expenses: ${err.message}`);
        console.error(`  ERROR upserting expenses: ${err.message}`);
      }
    } else {
      console.log('  No expense rows to insert.');
    }

    // ── 6. Upsert in-kind (safe to re-run — matches on receiptNo) ───────────
    if (inkindDocs.length > 0) {
      console.log(`Upserting ${inkindDocs.length} in-kind donations…`);
      try {
        const ops = inkindDocs.map(doc => ({
          updateOne: {
            filter: { receiptNo: doc.receiptNo },
            update: { $set: doc },
            upsert: true,
          },
        }));
        const res = await InKind.bulkWrite(ops, { ordered: false });
        insertedInKind = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
        console.log(`  Upserted ${res.upsertedCount ?? 0} new, updated ${res.modifiedCount ?? 0} existing in-kind.`);
      } catch (err) {
        errors.push(`InKind: ${err.message}`);
        console.error(`  ERROR upserting in-kind: ${err.message}`);
      }
    } else {
      console.log('  No in-kind rows to insert.');
    }

    // ── 7. VendorTransaction credits for pooja donations ──────────────────────
    // For each pooja donation (received > 0), create vendor payable lines
    // using the AppConfig poojaBreakdown (Regular or Special).
    console.log('\nMigrating vendor transactions for pooja donations…');
    let insertedVendorTxns = 0;
    try {
      // Load AppConfig to get poojaBreakdown with vendorIds
      const cfg = await AppConfig.findById('config').lean();
      const breakdown = cfg && cfg.poojaBreakdown ? cfg.poojaBreakdown : null;

      if (!breakdown) {
        console.log('  WARNING: AppConfig poojaBreakdown not found — run seed.js first. Skipping.');
      } else {
        const poojaDonations = donationDocs.filter(
          d => isPoojaType(d.donType) && d.received > 0
        );
        console.log(`  Found ${poojaDonations.length} pooja donations to process.`);

        const vtOps = [];
        for (const d of poojaDonations) {
          // Use Special breakdown if poojaVariant is "Special", otherwise Regular
          const variant  = (d.poojaVariant || 'regular').toLowerCase();
          const lines    = (variant === 'special' ? breakdown.special : breakdown.regular) || [];

          for (const line of lines) {
            vtOps.push({
              updateOne: {
                filter: { refId: d.receiptNo, vendorName: line.vendorName, item: line.item },
                update: {
                  $setOnInsert: {
                    vendorName:  line.vendorName,
                    vendorId:    line.vendorId || null,
                    date:        d.date,
                    description: `${d.poojaType || d.donType} (${variant.charAt(0).toUpperCase() + variant.slice(1)}) — ${d.receiptNo}${d.personName ? ` | ${d.personName}` : ''}`,
                    item:        line.item,
                    credit:      line.amount,
                    debit:       0,
                    refType:     'pooja',
                    refId:       d.receiptNo,
                    poojaName:   d.poojaType || d.donType,
                    variant:     d.poojaVariant || 'Regular',
                    isSettled:   false,
                  },
                },
                upsert: true,
              },
            });
          }
        }

        if (vtOps.length > 0) {
          const res = await VendorTransaction.bulkWrite(vtOps, { ordered: false });
          insertedVendorTxns = (res.upsertedCount ?? 0);
          console.log(`  Created ${res.upsertedCount ?? 0} new vendor transaction lines (${res.matchedCount ?? 0} already existed).`);
        } else {
          console.log('  No pooja donations with received > 0.');
        }
      }
    } catch (err) {
      errors.push(`VendorTransactions: ${err.message}`);
      console.error(`  ERROR migrating vendor transactions: ${err.message}`);
    }

    // ── 8. Transaction records (cash book) ────────────────────────────────────
    // Create general ledger entries: donation credits + expense debits.
    // Upsert on (refType + refId) so re-runs are safe.
    console.log('\nMigrating cash book (Transaction) records…');
    let insertedTxns = 0;
    try {
      const txnOps = [];

      // Donation credits (received > 0)
      for (const d of donationDocs.filter(x => x.received > 0)) {
        const category = isPoojaType(d.donType) ? 'Pooja Income' : 'Donation';
        txnOps.push({
          updateOne: {
            filter: { refType: 'donation', refId: d.receiptNo },
            update: {
              $setOnInsert: {
                txnNo:       `MIG/D/${d.receiptNo.replace(/\//g, '-')}`,
                date:        d.date,
                type:        'credit',
                category,
                amount:      d.received,
                description: d.donType + (d.poojaType ? ` — ${d.poojaType}` : ''),
                party:       d.donor,
                mode:        d.mode || 'Cash',
                refType:     'donation',
                refId:       d.receiptNo,
                recordedBy:  d.receivedBy || '',
                year:        d.year,
              },
            },
            upsert: true,
          },
        });
      }

      // Expense debits
      for (const e of expenseDocs) {
        txnOps.push({
          updateOne: {
            filter: { refType: 'expense', refId: e.voucherNo },
            update: {
              $setOnInsert: {
                txnNo:       `MIG/E/${e.voucherNo.replace(/\//g, '-')}`,
                date:        e.date,
                type:        'debit',
                category:    'Expense',
                amount:      e.amount,
                description: e.description || e.category || '',
                party:       e.vendor || '',
                mode:        e.mode || 'Cash',
                refType:     'expense',
                refId:       e.voucherNo,
                recordedBy:  e.paidBy || '',
                year:        e.year,
              },
            },
            upsert: true,
          },
        });
      }

      if (txnOps.length > 0) {
        const res = await Transaction.bulkWrite(txnOps, { ordered: false });
        insertedTxns = (res.upsertedCount ?? 0);
        console.log(`  Created ${res.upsertedCount ?? 0} new transaction records (${res.matchedCount ?? 0} already existed).`);
      }
    } catch (err) {
      errors.push(`Transactions: ${err.message}`);
      console.error(`  ERROR migrating transactions: ${err.message}`);
    }

    // ── 9. Update AppConfig sequences ───────────────────────────────────────
    console.log('\nUpdating AppConfig sequences…');
    await AppConfig.findByIdAndUpdate(
      'config',
      {
        $set: {
          donationSeq: 48,
          inkindSeq:   3,
          expenseSeq:  27,
        },
      },
      { upsert: true }
    );
    console.log('  donationSeq=48, inkindSeq=3, expenseSeq=27');

  } finally {
    await mongoose.disconnect();
    console.log('\n  Disconnected from MongoDB.\n');
  }

  // ── 10. Summary ──────────────────────────────────────────────────────────────
  console.log('=== Migration Summary ===');
  console.log(`  Donations:           ${insertedDonations}`);
  console.log(`  Expenses:            ${insertedExpenses}`);
  console.log(`  In-kind donations:   ${insertedInKind}`);
  console.log(`  Vendor transactions: ${insertedVendorTxns}`);
  console.log(`  Cash book entries:   ${insertedTxns}`);
  if (errors.length > 0) {
    console.log('\n  Errors encountered:');
    errors.forEach(e => console.log(`    - ${e}`));
  } else {
    console.log('\n  Migration completed successfully.');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
