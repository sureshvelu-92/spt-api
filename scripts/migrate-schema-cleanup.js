/**
 * migrate-schema-cleanup.js
 *
 * Removes deprecated fields from existing MongoDB documents and
 * migrates the PoojaSchedule unique index to include personName.
 *
 * Changes applied:
 *
 *  Donation documents:
 *    $unset: isPending, isTempleFunded, approvalStatus,
 *            approvedBy, approvedAt, rejectedReason
 *    (isPending is now computed as status !== 'Received' in the API)
 *
 *  Expense documents:
 *    $unset: poojaTypeId, paymentId
 *    (both reference unused legacy models: PoojaMaster, Payment)
 *
 *  PoojaSchedule documents:
 *    $set: hasVendorTxn = false  (on docs that don't have the field yet)
 *    Index: drop (poojaDate + poojaType) unique index,
 *           create (poojaDate + poojaType + personName) unique index
 *
 * Safe to re-run — all operations are idempotent.
 *
 * Run:
 *   cd spt-api
 *   node scripts/migrate-schema-cleanup.js
 *
 * Options:
 *   --dry-run    print counts only, no writes
 */

require('dotenv').config();
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected\n');
  if (DRY_RUN) console.log('  (DRY RUN — no writes)\n');

  const db = mongoose.connection.db;

  // ── Step 1: Donation — unset deprecated fields ───────────
  console.log('── Step 1: Donation — remove deprecated fields ─────────');
  const donFields = {
    isPending:      '',
    isTempleFunded: '',
    approvalStatus: '',
    approvedBy:     '',
    approvedAt:     '',
    rejectedReason: '',
  };

  const donCol = db.collection('donations');

  // Count how many docs still have each field
  for (const field of Object.keys(donFields)) {
    const count = await donCol.countDocuments({ [field]: { $exists: true } });
    console.log(`  ${count.toString().padStart(4)} docs have  '${field}'`);
  }

  if (!DRY_RUN) {
    const donResult = await donCol.updateMany(
      { $or: Object.keys(donFields).map(f => ({ [f]: { $exists: true } })) },
      { $unset: donFields }
    );
    console.log(`  ✓ Updated ${donResult.modifiedCount} donation document(s)\n`);
  } else {
    const affected = await donCol.countDocuments({
      $or: Object.keys(donFields).map(f => ({ [f]: { $exists: true } })),
    });
    console.log(`  [dry] Would update ${affected} donation document(s)\n`);
  }

  // ── Step 2: Expense — unset deprecated fields ────────────
  console.log('── Step 2: Expense — remove deprecated fields ──────────');
  const expFields = { poojaTypeId: '', paymentId: '' };
  const expCol = db.collection('expenses');

  for (const field of Object.keys(expFields)) {
    const count = await expCol.countDocuments({ [field]: { $exists: true } });
    console.log(`  ${count.toString().padStart(4)} docs have  '${field}'`);
  }

  if (!DRY_RUN) {
    const expResult = await expCol.updateMany(
      { $or: Object.keys(expFields).map(f => ({ [f]: { $exists: true } })) },
      { $unset: expFields }
    );
    console.log(`  ✓ Updated ${expResult.modifiedCount} expense document(s)\n`);
  } else {
    const affected = await expCol.countDocuments({
      $or: Object.keys(expFields).map(f => ({ [f]: { $exists: true } })),
    });
    console.log(`  [dry] Would update ${affected} expense document(s)\n`);
  }

  // ── Step 3: PoojaSchedule — backfill hasVendorTxn ────────
  console.log('── Step 3: PoojaSchedule — backfill hasVendorTxn ───────');
  const psCol = db.collection('poojaschedules');

  const missingVtxn = await psCol.countDocuments({ hasVendorTxn: { $exists: false } });
  console.log(`  ${missingVtxn} docs missing 'hasVendorTxn'`);

  if (!DRY_RUN && missingVtxn > 0) {
    const r = await psCol.updateMany(
      { hasVendorTxn: { $exists: false } },
      { $set: { hasVendorTxn: false } }
    );
    console.log(`  ✓ Backfilled ${r.modifiedCount} PoojaSchedule document(s)\n`);
  } else if (missingVtxn === 0) {
    console.log('  ✓ All docs already have hasVendorTxn\n');
  } else {
    console.log(`  [dry] Would backfill ${missingVtxn} document(s)\n`);
  }

  // ── Step 4: PoojaSchedule — migrate unique index ─────────
  console.log('── Step 4: PoojaSchedule — migrate unique index ────────');
  const psIndexes = await psCol.indexes();

  const oldIdx = psIndexes.find(i =>
    i.name === 'poojaDate_1_poojaType_1' && i.unique === true
  );
  const newIdx = psIndexes.find(i =>
    i.name === 'poojaDate_1_poojaType_1_personName_1'
  );

  if (oldIdx) {
    console.log('  Found old 2-field unique index — dropping…');
    if (!DRY_RUN) {
      await psCol.dropIndex('poojaDate_1_poojaType_1');
      console.log('  ✓ Dropped poojaDate_1_poojaType_1');
    } else {
      console.log('  [dry] Would drop poojaDate_1_poojaType_1');
    }
  } else {
    console.log('  Old 2-field index not present (already migrated or fresh DB)');
  }

  if (!newIdx) {
    console.log('  Creating new 3-field unique index (poojaDate + poojaType + personName)…');
    if (!DRY_RUN) {
      await psCol.createIndex(
        { poojaDate: 1, poojaType: 1, personName: 1 },
        { unique: true, name: 'poojaDate_1_poojaType_1_personName_1' }
      );
      console.log('  ✓ Created poojaDate_1_poojaType_1_personName_1 (unique)');
    } else {
      console.log('  [dry] Would create poojaDate_1_poojaType_1_personName_1');
    }
  } else {
    console.log('  ✓ New 3-field unique index already exists');
  }

  // ── Summary ───────────────────────────────────────────────
  console.log('\n── Summary ─────────────────────────────────────────────');
  if (!DRY_RUN) {
    const donTotal = await donCol.countDocuments();
    const expTotal = await expCol.countDocuments();
    const psTotal  = await psCol.countDocuments();
    console.log(`  donations:      ${donTotal} documents`);
    console.log(`  expenses:       ${expTotal} documents`);
    console.log(`  poojaschedules: ${psTotal} documents`);

    // Verify clean
    const donDirty = await donCol.countDocuments({
      $or: Object.keys(donFields).map(f => ({ [f]: { $exists: true } })),
    });
    const expDirty = await expCol.countDocuments({
      $or: Object.keys(expFields).map(f => ({ [f]: { $exists: true } })),
    });
    const psMissing = await psCol.countDocuments({ hasVendorTxn: { $exists: false } });
    if (donDirty === 0 && expDirty === 0 && psMissing === 0) {
      console.log('\n  ✅ All collections clean — migration complete');
    } else {
      if (donDirty)   console.log(`\n  ⚠️  ${donDirty} donation doc(s) still have deprecated fields`);
      if (expDirty)   console.log(`  ⚠️  ${expDirty} expense doc(s) still have deprecated fields`);
      if (psMissing)  console.log(`  ⚠️  ${psMissing} schedule doc(s) missing hasVendorTxn`);
    }
  }

  await mongoose.disconnect();
  console.log('\n✓ Done');
}

main().catch(e => { console.error(e); process.exit(1); });
