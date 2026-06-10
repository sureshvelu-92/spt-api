/**
 * migrate-pooja-schedule.js
 *
 * Builds the PoojaSchedule collection from scratch:
 *
 *  1. Auto-generate all Tue/Fri/Sun + Amavasai/Pournami slots for every
 *     month from START_YEAR/START_MONTH up to current month.
 *
 *  2. For each existing Donation that is a pooja type:
 *     a. Find the matching PoojaSchedule slot by poojaDate (or date fallback).
 *     b. Copy pooja fields (poojaType, poojaVariant, personName, birthdayDate)
 *        into the PoojaSchedule record.
 *     c. Mark the slot as donor_funded / temple_funded / pending_approval.
 *     d. Link donationId + receiptNo back on the schedule slot.
 *     e. Backfill Donation.poojaDate = slot.poojaDate.
 *     f. Backfill Donation.poojaScheduleId = slot._id.
 *     g. For Birthday/Anniversary poojas not matching a standard slot,
 *        create a new PoojaSchedule entry with dayType='Special'.
 *
 *  3. Sync VendorTransaction dates to match the correct poojaDate.
 *
 * Safe to re-run: uses upsert on (poojaDate + poojaType).
 *
 * Run:
 *   cd spt-api
 *   node scripts/migrate-pooja-schedule.js
 *
 * Options:
 *   --from 2026-01   override start month  (default: 2026-01)
 *   --dry-run        print what would happen, no writes
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const Donation          = require('../models/Donation');
const VendorTransaction = require('../models/VendorTransaction');
const PoojaSchedule     = require('../models/PoojaSchedule');

// ── Config ─────────────────────────────────────────────────
const START_YEAR  = 2026;
const START_MONTH = 1;
const DRY_RUN     = process.argv.includes('--dry-run');

// ── Lunar helpers ──────────────────────────────────────────
const SYNODIC_MS      = 29.530588853 * 24 * 60 * 60 * 1000;
const REF_NEW_MOON_MS = new Date('2025-01-29T12:36:00Z').getTime();
const IST_OFFSET_MS   = 5.5 * 60 * 60 * 1000;
const DAY_NAMES       = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function lunarPhases(year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1)).getTime();
  const to   = new Date(Date.UTC(year, month,     1)).getTime();
  const amavasai = [], pournami = [];
  const startCycle = Math.floor((from - REF_NEW_MOON_MS) / SYNODIC_MS);

  for (let i = startCycle - 1; i <= startCycle + 3; i++) {
    const nmIst = new Date(REF_NEW_MOON_MS + i * SYNODIC_MS + IST_OFFSET_MS);
    const nmDay = new Date(Date.UTC(nmIst.getUTCFullYear(), nmIst.getUTCMonth(), nmIst.getUTCDate()));
    if (nmDay.getTime() >= from && nmDay.getTime() < to) amavasai.push(nmDay);

    const fmIst = new Date(REF_NEW_MOON_MS + (i + 0.5) * SYNODIC_MS + IST_OFFSET_MS);
    const fmDay = new Date(Date.UTC(fmIst.getUTCFullYear(), fmIst.getUTCMonth(), fmIst.getUTCDate()));
    if (fmDay.getTime() >= from && fmDay.getTime() < to) pournami.push(fmDay);
  }
  return { amavasai, pournami };
}

function weeklyPoojaDays(year, month) {
  const TARGETS = new Set([0, 2, 5]); // Sun, Tue, Fri
  const days = [];
  const end  = new Date(Date.UTC(year, month, 1));
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (TARGETS.has(d.getUTCDay())) days.push(new Date(d));
  }
  return days;
}

function isoDate(d) { return d.toISOString().split('T')[0]; }

// ── Build all slots for a month ────────────────────────────
function buildMonthSlots(year, month) {
  const { amavasai, pournami } = lunarPhases(year, month);
  const weekly = weeklyPoojaDays(year, month);

  const slots = [];
  for (const d of weekly) {
    const dow = d.getUTCDay();
    const dayType = dow === 2 ? 'Tuesday' : dow === 5 ? 'Friday' : 'Sunday';
    slots.push({ poojaDate: d, year, month, dayType, poojaType: 'Weekly Pooja' });
  }
  for (const d of amavasai) {
    slots.push({ poojaDate: d, year, month, dayType: 'Amavasai', poojaType: 'Amavasai Pooja' });
  }
  for (const d of pournami) {
    slots.push({ poojaDate: d, year, month, dayType: 'Pournami', poojaType: 'Pournami Pooja' });
  }
  slots.sort((a, b) => a.poojaDate - b.poojaDate);
  return slots;
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB');
  if (DRY_RUN) console.log('  (DRY RUN — no writes)\n');

  const now       = new Date();
  const endYear   = now.getFullYear();
  const endMonth  = now.getMonth() + 1;

  // ── STEP 1: Generate schedule slots ─────────────────────
  console.log('\n── Step 1: Generate PoojaSchedule slots ───────────────');
  let slotsUpserted = 0;

  let y = START_YEAR, m = START_MONTH;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const slots = buildMonthSlots(y, m);
    for (const slot of slots) {
      if (!DRY_RUN) {
        await PoojaSchedule.findOneAndUpdate(
          { poojaDate: slot.poojaDate, poojaType: slot.poojaType },
          { $setOnInsert: { ...slot, status: 'unfunded' } },  // only set on new docs
          { upsert: true, new: true }
        );
      } else {
        console.log(`  [dry] ${isoDate(slot.poojaDate)} ${slot.dayType} — ${slot.poojaType}`);
      }
      slotsUpserted++;
    }
    console.log(`  ${y}-${String(m).padStart(2,'0')}: ${slots.length} slots`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  console.log(`  Total: ${slotsUpserted} slots generated\n`);

  // ── STEP 2: Map donations to schedule slots ──────────────
  console.log('── Step 2: Map pooja donations to schedule ────────────');

  const POOJA_TYPES = [
    'Weekly Pooja', 'Amavasai Pooja', 'Pournami Pooja',
    'Birthday Pooja', 'Anniversary Pooja',
  ];

  const donations = await Donation.find({ donType: { $in: POOJA_TYPES } })
    .sort({ date: 1 })
    .lean();

  console.log(`  Found ${donations.length} pooja donation(s) to process`);

  let linked = 0, newSlots = 0, skipped = 0;

  for (const don of donations) {
    // Effective pooja date: use poojaDate if set, else fall back to date
    const effDate = don.poojaDate
      ? new Date(Date.UTC(
          don.poojaDate.getUTCFullYear(),
          don.poojaDate.getUTCMonth(),
          don.poojaDate.getUTCDate()))
      : new Date(Date.UTC(
          don.date.getUTCFullYear(),
          don.date.getUTCMonth(),
          don.date.getUTCDate()));

    const effIso   = isoDate(effDate);
    const donYear  = effDate.getUTCFullYear();
    const donMonth = effDate.getUTCMonth() + 1;
    const donDay   = effDate.getUTCDay();

    // Build pooja fields to copy to schedule
    const poojaFields = {
      poojaType:    don.donType,
      poojaVariant: don.poojaVariant || 'Regular',
      personName:   don.personName   || '',
      // birthdayDate: not in old Donation model — leave null
    };

    // Determine status
    let status, approvalStatus;
    if (don.isTempleFunded) {
      approvalStatus = don.approvalStatus || 'pending';
      status = approvalStatus === 'approved' ? 'temple_funded'
             : approvalStatus === 'rejected' ? 'rejected'
             : 'pending_approval';
    } else {
      status         = 'donor_funded';
      approvalStatus = null;
    }

    const linkFields = {
      donationId:     don._id,
      receiptNo:      don.receiptNo,
      status,
      approvalStatus,
      approvedBy:     don.approvedBy   || '',
      approvedAt:     don.approvedAt   || null,
      rejectedReason: don.rejectedReason || '',
      ...poojaFields,
    };

    // Try to find existing standard slot
    const existing = await PoojaSchedule.findOne({
      poojaDate: effDate,
      poojaType: don.donType,
    });

    if (existing) {
      // Link donation to existing slot
      if (!DRY_RUN) {
        await PoojaSchedule.updateOne(
          { _id: existing._id },
          { $set: linkFields }
        );
        // Backfill donation
        await Donation.updateOne(
          { _id: don._id },
          { $set: {
            poojaDate:       effDate,
            poojaScheduleId: existing._id,
          }}
        );
        // Sync VendorTransaction dates
        await VendorTransaction.updateMany(
          { refId: don.receiptNo, refType: 'pooja' },
          { $set: { date: effDate } }
        );
      }
      console.log(`  ✓ Linked  ${don.receiptNo}  ${don.donType}  →  slot ${effIso}`);
      linked++;

    } else if (don.donType === 'Birthday Pooja' || don.donType === 'Anniversary Pooja') {
      // Special pooja — create a new slot
      const dayType = donDay === 2 ? 'Tuesday' : donDay === 5 ? 'Friday' : donDay === 0 ? 'Sunday' : 'Special';
      if (!DRY_RUN) {
        const newSlot = await PoojaSchedule.findOneAndUpdate(
          { poojaDate: effDate, poojaType: don.donType },
          { $set: {
              poojaDate: effDate,
              year:      donYear,
              month:     donMonth,
              dayType,
              ...linkFields,
            }
          },
          { upsert: true, new: true }
        );
        await Donation.updateOne(
          { _id: don._id },
          { $set: {
            poojaDate:       effDate,
            poojaScheduleId: newSlot._id,
          }}
        );
        await VendorTransaction.updateMany(
          { refId: don.receiptNo, refType: 'pooja' },
          { $set: { date: effDate } }
        );
      }
      console.log(`  + Created ${don.receiptNo}  ${don.donType}  →  new slot ${effIso} (${DAY_NAMES[donDay]})`);
      newSlots++;

    } else {
      // Standard slot not found (date might be outside generated range, or unusual date)
      console.log(`  ✗ No slot ${don.receiptNo}  ${don.donType}  on ${effIso} — skipping`);
      skipped++;
    }
  }

  console.log(`\n  Linked: ${linked}  |  New special slots: ${newSlots}  |  Skipped: ${skipped}\n`);

  // ── STEP 3: Final summary ────────────────────────────────
  console.log('── Step 3: Summary ─────────────────────────────────────');
  if (!DRY_RUN) {
    const total      = await PoojaSchedule.countDocuments();
    const funded     = await PoojaSchedule.countDocuments({ status: { $in: ['donor_funded','temple_funded'] } });
    const pending    = await PoojaSchedule.countDocuments({ status: 'pending_approval' });
    const unfunded   = await PoojaSchedule.countDocuments({ status: 'unfunded' });
    console.log(`  Total slots : ${total}`);
    console.log(`  Funded      : ${funded}`);
    console.log(`  Pending     : ${pending}`);
    console.log(`  Unfunded    : ${unfunded}`);
  }

  await mongoose.disconnect();
  console.log('\n✓ Done');
}

main().catch(e => { console.error(e); process.exit(1); });
