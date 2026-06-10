/**
 * import-budget-aadi-2026.js
 *
 * Imports the "BUDGET — AADI FESTIVAL 2026" data from Google Sheets into MongoDB.
 * Creates or replaces the Budget document for festival="Aadi Festival", year=2026.
 *
 * Usage:
 *   cd spt-api
 *   node scripts/import-budget-aadi-2026.js
 *
 * Add --dry-run to preview without writing to DB.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Budget   = require('../models/Budget');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Budget items extracted from Google Sheet ─────────────────────────────────
// Columns: description, category, initialBudget, revisedBudget, advance
const ITEMS = [
  { description: 'Iyer',                                                              category: 'Puja & Rituals',             initialBudget: 12000, revisedBudget: 15000, advance: 5001  },
  { description: 'Pooja items',                                                       category: 'Puja & Rituals',             initialBudget: 10000, revisedBudget: 10000, advance: 9500  },
  { description: 'Flowers & Flower decoration for Chariot',                           category: 'Decorations & Flowers',      initialBudget: 12000, revisedBudget: 12000, advance: 5001  },
  { description: 'Decoration of Ponniamman & tempo charges for Procession',           category: 'Decorations & Flowers',      initialBudget:  7500, revisedBudget:  7500, advance: 2001  },
  { description: 'Food Expenses - Breakfast, Lunch, Dinner & 2 variety of Prasadam', category: 'Food & Catering',            initialBudget: 35000, revisedBudget: 40000, advance: 40000 },
  { description: 'Photography',                                                       category: 'Miscellaneous',              initialBudget:  2500, revisedBudget:  6000, advance: 1001  },
  { description: 'Nadaswaram',                                                        category: 'Puja & Rituals',             initialBudget:  7500, revisedBudget:  3000, advance: 1001  },
  { description: 'Electrical Lighting & Generator Mic & Sound system',                category: 'Infrastructure & Logistics', initialBudget: 11000, revisedBudget: 11000, advance: 2001  },
  { description: 'Shamiana, Table, Chairs & Vessels',                                 category: 'Infrastructure & Logistics', initialBudget:  5500, revisedBudget:  5500, advance: 2001  },
  { description: 'Plantian Leaf 2 Nos.',                                              category: 'Puja & Rituals',             initialBudget:  1000, revisedBudget:  1000, advance: 0     },
  { description: 'Supply of water',                                                   category: 'Food & Catering',            initialBudget:  1000, revisedBudget:  1000, advance: 0     },
  { description: 'Plate/cups Roll etc.',                                              category: 'Food & Catering',            initialBudget:  3000, revisedBudget:  3000, advance: 0     },
  { description: 'Night Sweets',                                                      category: 'Food & Catering',            initialBudget:  1000, revisedBudget:  1000, advance: 0     },
  { description: 'Fruits/Coconut',                                                    category: 'Puja & Rituals',             initialBudget:  8000, revisedBudget:  8000, advance: 0     },
  { description: 'Pamplet Printing',                                                  category: 'Miscellaneous',              initialBudget:  2000, revisedBudget:  2000, advance: 1500  },
  { description: 'Blouse pieces/Kumkum set/Thread',                                  category: 'Puja & Rituals',             initialBudget: 10000, revisedBudget: 10000, advance: 0     },
  { description: 'Temple Painting',                                                   category: 'Infrastructure & Logistics', initialBudget:  8000, revisedBudget:  8000, advance: 0     },
  { description: 'Temple premises cleaning',                                          category: 'Infrastructure & Logistics', initialBudget:  3000, revisedBudget:  3000, advance: 0     },
  { description: 'Crackers',                                                          category: 'Miscellaneous',              initialBudget:  2000, revisedBudget:  5000, advance: 0     },
  { description: 'Others (Transport etc..)',                                          category: 'Miscellaneous',              initialBudget:  5000, revisedBudget:  5000, advance: 0     },
  { description: 'Petrol/Kerosene for Generator',                                     category: 'Infrastructure & Logistics', initialBudget:  1000, revisedBudget:  1000, advance: 0     },
  { description: 'Band set',                                                          category: 'Puja & Rituals',             initialBudget:     0, revisedBudget:  5000, advance: 1000  },
  { description: 'Amman Decoration',                                                  category: 'Decorations & Flowers',      initialBudget:     0, revisedBudget: 13000, advance: 0     },
  { description: 'Band set-Beverage',                                                 category: 'Miscellaneous',              initialBudget:     0, revisedBudget:  1000, advance: 0     },
];

// Verification: totals should match the sheet's grand total
const totalInitial  = ITEMS.reduce((s, i) => s + i.initialBudget,  0);
const totalRevised  = ITEMS.reduce((s, i) => s + i.revisedBudget,  0);
const totalAdvance  = ITEMS.reduce((s, i) => s + i.advance,        0);
console.log(`Items: ${ITEMS.length}`);
console.log(`Initial:  ₹${totalInitial.toLocaleString()}  (expected ₹1,48,000)`);
console.log(`Revised:  ₹${totalRevised.toLocaleString()}  (expected ₹1,77,000)`);
console.log(`Advance:  ₹${totalAdvance.toLocaleString()}`);

if (totalInitial !== 148000 || totalRevised !== 177000) {
  console.error('❌ Totals mismatch — aborting');
  process.exit(1);
}
console.log('✅ Totals verified');

if (DRY_RUN) {
  console.log('\n-- DRY RUN — no changes written --');
  process.exit(0);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Delete existing doc for this festival+year and replace with fresh data
  const existing = await Budget.findOne({ festival: 'Aadi Festival', year: 2026 });
  if (existing) {
    console.log(`Found existing budget _id=${existing._id} — replacing items`);
    existing.items = ITEMS;
    await existing.save();
    console.log(`✅ Updated budget _id=${existing._id}`);
  } else {
    const doc = await Budget.create({
      festival: 'Aadi Festival',
      year:     2026,
      items:    ITEMS,
    });
    console.log(`✅ Created budget _id=${doc._id}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
