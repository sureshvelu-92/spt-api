/**
 * SPT Seed Script
 * Run once from your local terminal: node seed.js
 *
 * Seeds:
 *   1. Vendors     — Saravana (Poojari), Elagovan, Dhamodhar, Saravana brother
 *   2. Users       — Sunil Kumar & Suresh Velu (admin)
 *   3. AppConfig   — temple info, dropdowns, poojaBreakdown with vendorId refs, sequences
 */
require('dotenv').config();
const mongoose  = require('mongoose');
const AppConfig = require('./models/AppConfig');
const Vendor    = require('./models/Vendor');
const User      = require('./models/User');

// ── Vendor seed data ─────────────────────────────────────────
const VENDORS = [
  { name: 'Saravana',         type: 'Poojari',  defaultCategory: 'Puja & Rituals',        notes: 'Poojari + lemon supplier' },
  { name: 'Elagovan',         type: 'Supplier', defaultCategory: 'Decorations & Flowers', notes: 'Flowers & decoration' },
  { name: 'Dhamodhar',        type: 'Supplier', defaultCategory: 'Puja & Rituals',        notes: 'Pooja items' },
  { name: 'Saravana brother', type: 'Supplier', defaultCategory: 'Puja & Rituals',        notes: 'Milk supplier' },
];

// ── User seed data ────────────────────────────────────────────
const USERS = [
  { name: 'Sunil Kumar', role: 'admin', isActive: true, pin: '1234' },
  { name: 'Suresh Velu', role: 'admin', isActive: true, email: 'suresh.velu@exathought.com', pin: '1234' },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI, { autoSelectFamily: false });
  console.log('Connected to MongoDB\n');

  // ── 1. Vendors ───────────────────────────────────────────
  console.log('── Vendors ──');
  const vendorMap = {};  // name → _id

  for (const v of VENDORS) {
    const doc = await Vendor.findOneAndUpdate(
      { name: v.name },
      { $setOnInsert: { ...v, displayName: `${v.name} (${v.type})` } },
      { upsert: true, new: true }
    );
    vendorMap[v.name] = doc._id.toString();
    console.log(`  OK    ${v.name} (${v.type}) → ${doc._id}`);
  }

  // ── 2. Users ─────────────────────────────────────────────
  console.log('\n── Users ──');
  for (const u of USERS) {
    const { pin, ...rest } = u;
    const doc = await User.findOneAndUpdate(
      { name: u.name },
      { $set: { pin },            // always update PIN so seed sets it correctly
        $setOnInsert: { ...rest } },
      { upsert: true, new: true }
    );
    console.log(`  OK    ${u.name} (${u.role}) → ${doc._id}`);
  }

  // ── 3. AppConfig ─────────────────────────────────────────
  console.log('\n── AppConfig ──');

  // Build poojaBreakdown with vendorId references
  const poojaBreakdown = {
    regular: [
      { vendorName: 'Saravana',         vendorId: vendorMap['Saravana'],         item: 'Poojari charge',      category: 'Puja & Rituals',        amount: 150 },
      { vendorName: 'Elagovan',         vendorId: vendorMap['Elagovan'],         item: 'Flowers & decoration', category: 'Decorations & Flowers', amount: 100 },
      { vendorName: 'Dhamodhar',        vendorId: vendorMap['Dhamodhar'],        item: 'Pooja items',          category: 'Puja & Rituals',        amount: 120 },
      { vendorName: 'Saravana',         vendorId: vendorMap['Saravana'],         item: 'Lemon',                category: 'Puja & Rituals',        amount: 20  },
      { vendorName: 'Saravana brother', vendorId: vendorMap['Saravana brother'], item: 'Milk',                 category: 'Puja & Rituals',        amount: 80  },
    ],
    special: [
      { vendorName: 'Saravana',         vendorId: vendorMap['Saravana'],         item: 'Poojari charge',      category: 'Puja & Rituals',        amount: 250 },
      { vendorName: 'Elagovan',         vendorId: vendorMap['Elagovan'],         item: 'Flowers & decoration', category: 'Decorations & Flowers', amount: 350 },
      { vendorName: 'Dhamodhar',        vendorId: vendorMap['Dhamodhar'],        item: 'Pooja items',          category: 'Puja & Rituals',        amount: 165 },
      { vendorName: 'Saravana',         vendorId: vendorMap['Saravana'],         item: 'Lemon',                category: 'Puja & Rituals',        amount: 20  },
      { vendorName: 'Saravana brother', vendorId: vendorMap['Saravana brother'], item: 'Milk',                 category: 'Puja & Rituals',        amount: 80  },
    ],
  };

  await AppConfig.findByIdAndUpdate(
    'config',
    {
      // Always update poojaBreakdown so vendorIds are always current
      $set: {
        poojaBreakdown,
      },
      // Only set these on first insert — won't overwrite user changes
      $setOnInsert: {
        templeName:        'Sri Ponniamman Temple Trust (R)',
        templeAddress:     '54, Bhajanai Koil Street, Gundaleri Village, Ranipet Dt, Tamil Nadu',
        templeBranch:      '39, Ramakrishna Mutt Road, Ulsoor, Bangalore – 560 008',
        templePAN:         'AAYTS1092E',
        templeRegNo:       '64/2013',
        rcpYear:           '2026',

        donationCashTypes: ['Pooja', 'Aadi Festival', 'Temple Development', 'Others'],

        poojaTypes: [
          'Weekly Pooja',
          'Amavasai Pooja',
          'Pournami Pooja',
          'Birthday Pooja',
          'Anniversary Pooja',
        ],

        poojaRates: { Regular: 799, Special: 1499 },

        inkindCategories:    ['Pooja Materials', 'Flowers', 'Milk', 'Food', 'Cloth', 'Utensils', 'Miscellaneous'],
        expenseTypes:        ['Aadi Festival', 'Temple Operations', 'Temple Development', 'Others'],
        expenseCategories:   ['Puja & Rituals', 'Decorations & Flowers', 'Food & Catering', 'Infrastructure & Logistics', 'Miscellaneous'],
        templeDevCategories: ['Construction & Renovation', 'Electrical & Lighting', 'Plumbing', 'Painting', 'Flooring', 'Materials & Hardware', 'Labour', 'Miscellaneous'],
        paymentModes:        ['Cash', 'UPI', 'Cheque', 'Bank Transfer'],
        defaultReceivers:    ['Sunil Kumar', 'Suresh Velu'],

        apiToken:       'SPTT@1985',
        youtubeChannel: 'https://youtube.com/@SriPonniammanTempleGundaleri',
        whatsappFooter: 'Sri Ponniamman Temple Trust (R) | 64/2013',
      },
    },
    { upsert: true, new: true }
  );

  console.log('  OK    config');
  console.log('        poojaBreakdown updated with vendorId references');
  console.log('\n── Breakdown Summary ──');
  console.log('  Regular: ₹470 cost (₹329 margin on ₹799)');
  for (const line of poojaBreakdown.regular) {
    console.log(`    ${line.vendorName.padEnd(18)} ${line.item.padEnd(20)} ₹${line.amount}`);
  }
  console.log('  Special: ₹865 cost (₹634 margin on ₹1499)');
  for (const line of poojaBreakdown.special) {
    console.log(`    ${line.vendorName.padEnd(18)} ${line.item.padEnd(20)} ₹${line.amount}`);
  }

  await mongoose.disconnect();
  console.log('\n✓ Seed complete.');
}

seed().catch(e => { console.error(e); process.exit(1); });
