/**
 * create-indexes.js
 *
 * Forces Mongoose to create all indexes defined in the models.
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

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected\n');

  const modelNames = Object.keys(mongoose.models);
  console.log(`Found ${modelNames.length} models: ${modelNames.join(', ')}\n`);

  for (const name of modelNames) {
    const Model = mongoose.model(name);
    try {
      await Model.createIndexes();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  await mongoose.disconnect();
  console.log('\n✓ All indexes created');
}

main().catch(e => { console.error(e); process.exit(1); });
