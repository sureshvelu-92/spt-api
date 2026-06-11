'use strict';
/**
 * One-time script: add a vendor directly to MongoDB.
 * Usage: node scripts/add-vendor.js
 * Requires MONGODB_URI in .env (or environment).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Vendor   = require('../models/Vendor');

const VENDOR = {
  name:            'Bala Abirami Hardwares',
  displayName:     'Bala Abirami Hardwares',
  type:            'Supplier',
  phone:           '',
  upiId:           '',
  accountNo:       '',
  ifscCode:        '',
  bankName:        '',
  defaultCategory: 'Materials & Hardware',
  notes:           'Hardware supplier — paint, building materials, etc.',
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const existing = await Vendor.findOne({ name: VENDOR.name }).lean();
  if (existing) {
    console.log(`Vendor "${VENDOR.name}" already exists (_id: ${existing._id}). Nothing added.`);
  } else {
    const doc = await Vendor.create(VENDOR);
    console.log(`✓ Added vendor "${doc.name}" with _id: ${doc._id}`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
