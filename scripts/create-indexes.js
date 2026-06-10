/**
 * create-indexes.js
 *
 * Creates all Mongoose schema indexes PLUS MongoDB text-search indexes
 * for donor search, expense search, and vendor search.
 * Safe to re-run — MongoDB is idempotent for existing indexes.
 *
 * Run:
 *   cd spt-api
 *   node scripts/create-indexes.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Load all models so their schemas (and indexes) are registered
require('../models/Donation');
require('../models/Expense');
require('../models/Transaction');
require('../models/VendorTransaction');
require('../models/User');
require('../models/Vendor');
require('../models/PoojaSchedule');
require('../models/PoojaMaster');
require('../models/Payment');
require('../models/InKind');

// ── Extra text-search indexes (not in Mongoose schemas) ───
const TEXT_INDEXES = [
  {
    collection: 'donations',
    name: 'donation_text_search',
    keys: { donor: 'text', notes: 'text', receiptNo: 'text', personName: 'text' },
    weights: { donor: 10, receiptNo: 8, personName: 5, notes: 3 },
  },
  {
    collection: 'expenses',
    name: 'expense_text_search',
    keys: { vendor: 'text', description: 'text', voucherNo: 'text', category: 'text' },
    weights: { voucherNo: 10, vendor: 8, description: 5, category: 3 },
  },
  {
    collection: 'vendors',
    name: 'vendor_text_search',
    keys: { name: 'text', category: 'text' },
    weights: { name: 10, category: 3 },
  },
  {
    collection: 'transactions',
    name: 'transaction_text_search',
    keys: { description: 'text', party: 'text', txnNo: 'text', category: 'text' },
    weights: { txnNo: 10, party: 8, description: 5, category: 3 },
  },
];

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected\n');

  const db = mongoose.connection.db;

  // ── Step 1: Mongoose schema indexes ─────────────────────
  console.log('── Step 1: Schema indexes ──────────────────────────────');
  const modelNames = Object.keys(mongoose.models);
  for (const name of modelNames) {
    const Model = mongoose.model(name);
    try {
      await Model.createIndexes();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  // ── Step 2: Text search indexes ──────────────────────────
  console.log('\n── Step 2: Text search indexes ─────────────────────────');
  for (const { collection, name, keys, weights } of TEXT_INDEXES) {
    try {
      const col = db.collection(collection);
      // Drop existing text index first (only one text index allowed per collection)
      const existing = await col.indexes();
      const existingText = existing.find(idx => idx.name === name);
      if (existingText) {
        await col.dropIndex(name);
        console.log(`  ↻ Dropped old ${name}`);
      }
      await col.createIndex(keys, { name, weights, default_language: 'english' });
      console.log(`  ✓ ${collection} — text search on [${Object.keys(keys).join(', ')}]`);
    } catch (e) {
      console.error(`  ✗ ${collection}: ${e.message}`);
    }
  }

  await mongoose.disconnect();
  console.log('\n✓ Done — all indexes created');
}

main().catch(e => { console.error(e); process.exit(1); });
