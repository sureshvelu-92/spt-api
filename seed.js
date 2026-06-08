/**
 * SPT Seed Script
 * Run once from your local terminal: node seed.js
 *
 * Seeds:
 *   - AppConfig singleton (temple info, all dropdowns, pooja breakdown, rates)
 *     Sequences are now fields inside AppConfig (donationSeq, inkindSeq, expenseSeq, txnSeq)
 *
 * NOT seeded (added manually via app):
 *   - Vendors (Poojari / Supplier / Contractor names)
 *   - Trustees (users)
 */
require('dotenv').config();
const mongoose  = require('mongoose');
const AppConfig = require('./models/AppConfig');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // ── AppConfig ────────────────────────────────────────────
  console.log('\n── AppConfig ──');
  const cfg = await AppConfig.findByIdAndUpdate(
    'config',
    {
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

        // Pooja cost breakdown — applies to ALL pooja types equally
        // Regular: total cost ₹470, margin ₹329
        // Special: total cost ₹865, margin ₹634
        poojaBreakdown: {
          regular: [
            { vendorName: 'Saravana',         item: 'Poojari charge',       category: 'Puja & Rituals',        amount: 150 },
            { vendorName: 'Elagovan',         item: 'Flowers & decoration',  category: 'Decorations & Flowers', amount: 100 },
            { vendorName: 'Dhamodhar',        item: 'Pooja items',           category: 'Puja & Rituals',        amount: 120 },
            { vendorName: 'Saravana',         item: 'Lemon',                 category: 'Puja & Rituals',        amount: 20  },
            { vendorName: 'Saravana brother', item: 'Milk',                  category: 'Puja & Rituals',        amount: 80  },
          ],
          special: [
            { vendorName: 'Saravana',         item: 'Poojari charge',       category: 'Puja & Rituals',        amount: 250 },
            { vendorName: 'Elagovan',         item: 'Flowers & decoration',  category: 'Decorations & Flowers', amount: 350 },
            { vendorName: 'Dhamodhar',        item: 'Pooja items',           category: 'Puja & Rituals',        amount: 165 },
            { vendorName: 'Saravana',         item: 'Lemon',                 category: 'Puja & Rituals',        amount: 20  },
            { vendorName: 'Saravana brother', item: 'Milk',                  category: 'Puja & Rituals',        amount: 80  },
          ],
        },

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
  console.log('        Sequences live in AppConfig (donationSeq, inkindSeq, expenseSeq, txnSeq)');
  console.log('        To migrate from old app, update sequences in Settings → Config after seeding.');

  await mongoose.disconnect();
  console.log('\n✓ Seed complete.');
  console.log('  Note: Vendors and Trustees are added manually via the app.');
}

seed().catch(e => { console.error(e); process.exit(1); });
