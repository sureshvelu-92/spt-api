/**
 * fix-vendor-txn-dates.js
 *
 * Updates VendorTransaction dates to use poojaDate from the linked Donation
 * when poojaDate is set and refType = 'pooja' and refId is a donation receipt.
 *
 * Run: node scripts/fix-vendor-txn-dates.js
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const Donation          = require('../models/Donation');
const VendorTransaction = require('../models/VendorTransaction');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find all pooja vendor transactions where refId looks like a donation receipt (D/)
  const txns = await VendorTransaction.find({
    refType: 'pooja',
    refId:   /\/D\//,         // donation receipt format: YYYY/D/NNN
  }).lean();

  console.log(`Found ${txns.length} vendor transactions to check`);

  let updated = 0;
  for (const txn of txns) {
    const don = await Donation.findOne({ receiptNo: txn.refId }).lean();
    if (!don?.poojaDate) continue;  // no poojaDate set, skip

    const poojaDateISO  = don.poojaDate.toISOString().split('T')[0];
    const txnDateISO    = txn.date.toISOString().split('T')[0];
    if (poojaDateISO === txnDateISO) continue;  // already correct

    await VendorTransaction.updateMany(
      { refId: txn.refId, refType: 'pooja' },
      { $set: { date: don.poojaDate } }
    );
    console.log(`Updated ${txn.refId}: ${txnDateISO} → ${poojaDateISO}`);
    updated++;
  }

  console.log(`\nDone. ${updated} transaction group(s) updated.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
