/**
 * backfill-pooja-dates.js
 *
 * For every pooja/anniversary donation that has poojaDate = null,
 * set poojaDate = date (the date the donation was recorded / pooja was done).
 * Also syncs the date on any linked VendorTransactions (refId = receiptNo).
 *
 * Safe to run multiple times — only touches records where poojaDate is null.
 *
 * Usage:
 *   cd spt-api
 *   node scripts/backfill-pooja-dates.js
 *
 * To override poojaDate for a specific receipt after running:
 *   node scripts/backfill-pooja-dates.js --set 2026/D/35=2026-06-09
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const Donation          = require('../models/Donation');
const VendorTransaction = require('../models/VendorTransaction');

const POOJA_TYPES = [
  'Weekly Pooja', 'Amavasai Pooja', 'Pournami Pooja',
  'Birthday Pooja', 'Anniversary Pooja',
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB\n');

  // ── Parse optional overrides: --set RECEIPT=YYYY-MM-DD ────
  const overrides = {};
  const setArg = process.argv.indexOf('--set');
  if (setArg !== -1 && process.argv[setArg + 1]) {
    for (const pair of process.argv.slice(setArg + 1)) {
      if (!pair.includes('=')) break;
      const [receipt, dateStr] = pair.split('=');
      overrides[receipt] = new Date(dateStr + 'T00:00:00Z');
      console.log(`Override: ${receipt} → ${dateStr}`);
    }
    console.log('');
  }

  // ── Step 1: Backfill null poojaDate ───────────────────────
  const nullDonations = await Donation.find({
    donType:   { $in: POOJA_TYPES },
    poojaDate: { $in: [null, ''] },
  }).lean();

  console.log(`Found ${nullDonations.length} donation(s) missing poojaDate`);

  let donUpdated = 0;
  let txnUpdated = 0;

  for (const don of nullDonations) {
    const poojaDate = don.date;
    if (!poojaDate) continue;

    await Donation.updateOne({ _id: don._id }, { $set: { poojaDate } });
    donUpdated++;

    const r = await VendorTransaction.updateMany(
      { refId: don.receiptNo, refType: 'pooja' },
      { $set: { date: poojaDate } }
    );
    txnUpdated += r.modifiedCount;

    const iso = poojaDate.toISOString().split('T')[0];
    console.log(`  ✓ ${don.receiptNo}  ${don.donType}  →  poojaDate = ${iso}  (vtxns: ${r.modifiedCount})`);
  }

  console.log(`\nStep 1 done: ${donUpdated} donation(s), ${txnUpdated} vendor transaction(s) updated\n`);

  // ── Step 2: Apply manual overrides ────────────────────────
  if (Object.keys(overrides).length) {
    console.log('Applying manual overrides:');
    for (const [receipt, newDate] of Object.entries(overrides)) {
      const don = await Donation.findOne({ receiptNo: receipt }).lean();
      if (!don) { console.log(`  ✗ ${receipt} — not found`); continue; }

      await Donation.updateOne({ receiptNo: receipt }, { $set: { poojaDate: newDate } });

      const r = await VendorTransaction.updateMany(
        { refId: receipt, refType: 'pooja' },
        { $set: { date: newDate } }
      );

      const iso = newDate.toISOString().split('T')[0];
      console.log(`  ✓ ${receipt}  →  poojaDate = ${iso}  (vtxns: ${r.modifiedCount})`);
    }
  }

  // ── Summary ───────────────────────────────────────────────
  console.log('\n── Final state of pooja donations ──────────────────────');
  const all = await Donation.find({ donType: { $in: POOJA_TYPES } })
    .sort({ date: 1 })
    .select('receiptNo donType date poojaDate donor')
    .lean();

  for (const d of all) {
    const entryIso = d.date?.toISOString().split('T')[0] ?? '?';
    const poojaIso = d.poojaDate?.toISOString().split('T')[0] ?? 'NULL';
    const flag     = entryIso !== poojaIso ? ' ← differs' : '';
    console.log(`  ${d.receiptNo}  ${d.donType}  entry:${entryIso}  pooja:${poojaIso}${flag}`);
  }

  await mongoose.disconnect();
  console.log('\n✓ Done');
}

main().catch(e => { console.error(e); process.exit(1); });
