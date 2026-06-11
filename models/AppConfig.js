const mongoose = require('mongoose');

// Singleton document — always upsert on _id: 'config'
const appConfigSchema = new mongoose.Schema({
  _id:            { type: String, default: 'config' },

  // ── Temple identity ──────────────────────────────────────
  templeName:     { type: String, default: 'Sri Ponniamman Temple Trust (R)' },
  templeAddress:  { type: String, default: '54, Bhajanai Koil Street, Gundaleri Village, Ranipet Dt, Tamil Nadu' },
  templeBranch:   { type: String, default: '39, Ramakrishna Mutt Road, Ulsoor, Bangalore – 560 008' },
  templePAN:      { type: String, default: 'AAYTS1092E' },
  templeRegNo:    { type: String, default: '64/2013' },
  rcpYear:        { type: String, default: () => String(new Date().getFullYear()) },

  // ── Sequences (auto-increment counters, no separate collection) ─
  donationSeq:    { type: Number, default: 0 },
  inkindSeq:      { type: Number, default: 0 },
  expenseSeq:     { type: Number, default: 0 },
  txnSeq:         { type: Number, default: 0 },

  // ── Auth & integrations ──────────────────────────────────
  apiToken:       { type: String, default: 'SPTT@1985' },
  youtubeChannel: { type: String, default: 'https://youtube.com/@SriPonniammanTempleGundaleri' },
  whatsappFooter: { type: String, default: '' },

  // ── Volunteers (receivers / payers) ─────────────────────
  defaultReceivers: { type: [String], default: ['Sunil Kumar', 'Suresh Velu'] },

  // ── Payment modes ────────────────────────────────────────
  paymentModes: { type: [String], default: ['Cash', 'UPI', 'Cheque', 'Bank Transfer'] },

  // ── Donation — Cash/UPI top-level types ─────────────────
  // Shown in the "Donation for" dropdown
  donationCashTypes: {
    type: [String],
    default: ['Pooja', 'Aadi Festival', 'Temple Development', 'Others'],
  },

  // ── Donation — Pooja sub-types ───────────────────────────
  // Shown in the "Pooja" dropdown (when "Pooja" is selected above)
  poojaTypes: {
    type: [String],
    default: [
      'Weekly Pooja',
      'Amavasai Pooja',
      'Pournami Pooja',
      'Birthday Pooja',
      'Anniversary Pooja',
    ],
  },

  // ── Donation — Pooja variant rates ───────────────────────
  poojaRates: {
    type: mongoose.Schema.Types.Mixed,
    default: { Regular: 799, Special: 1499 },
  },

  // ── Donation — In-Kind categories ───────────────────────
  inkindCategories: {
    type: [String],
    default: ['Pooja Materials', 'Flowers', 'Milk', 'Food', 'Cloth', 'Utensils', 'Miscellaneous'],
  },

  // ── Expense — types ──────────────────────────────────────
  expenseTypes: {
    type: [String],
    default: ['Aadi Festival', 'Temple Operations', 'Temple Development', 'Others'],
  },

  // ── Expense — categories (Aadi Festival / Temple Operations / Others) ──
  expenseCategories: {
    type: [String],
    default: [
      'Puja & Rituals',
      'Decorations & Flowers',
      'Food & Catering',
      'Infrastructure & Logistics',
      'Miscellaneous',
    ],
  },

  // ── Expense — Temple Development specific categories ─────
  templeDevCategories: {
    type: [String],
    default: [
      'Construction & Renovation',
      'Electrical & Lighting',
      'Plumbing',
      'Painting',
      'Flooring',
      'Materials & Hardware',
      'Labour',
      'Miscellaneous',
    ],
  },

  // ── Pooja Breakdown — shared across ALL pooja types ─────
  // Each line: { vendorName, item, category, amount }
  // Regular and Special have separate breakdown lists.
  // Rates come from poojaRates above; breakdown totals must be < rate.
  poojaBreakdown: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      regular: [
        { vendorName: 'Saravana',         item: 'Poojari charge',      category: 'Puja & Rituals',        amount: 150 },
        { vendorName: 'Elagovan',         item: 'Flowers & decoration', category: 'Decorations & Flowers', amount: 100 },
        { vendorName: 'Dhamodhar',        item: 'Pooja items',          category: 'Puja & Rituals',        amount: 120 },
        { vendorName: 'Saravana',         item: 'Lemon',                category: 'Puja & Rituals',        amount: 20  },
        { vendorName: 'Saravana brother', item: 'Milk',                 category: 'Puja & Rituals',        amount: 80  },
      ],
      special: [
        { vendorName: 'Saravana',         item: 'Poojari charge',      category: 'Puja & Rituals',        amount: 250 },
        { vendorName: 'Elagovan',         item: 'Flowers & decoration', category: 'Decorations & Flowers', amount: 350 },
        { vendorName: 'Dhamodhar',        item: 'Pooja items',          category: 'Puja & Rituals',        amount: 165 },
        { vendorName: 'Saravana',         item: 'Lemon',                category: 'Puja & Rituals',        amount: 20  },
        { vendorName: 'Saravana brother', item: 'Milk',                 category: 'Puja & Rituals',        amount: 80  },
      ],
    },
  },

  // ── Festival dates (for receipt banner, WhatsApp msg) ───
  festivalDates: { type: mongoose.Schema.Types.Mixed, default: {} },

}, { timestamps: true, _id: false });

// ── Static helper — get the singleton ───────────────────────
appConfigSchema.statics.get = async function () {
  let doc = await this.findById('config');
  if (!doc) doc = await this.create({ _id: 'config' });

  // Auto-advance rcpYear when a new calendar year begins
  const currentYear = String(new Date().getFullYear());
  if (!doc.rcpYear || doc.rcpYear < currentYear) {
    doc.rcpYear = currentYear;
    await doc.save();
  }

  return doc;
};

// ── Static helper — atomic increment, returns next number ───
// type: 'donation' | 'inkind' | 'expense' | 'txn'
appConfigSchema.statics.nextSeq = async function (type) {
  const field = `${type}Seq`;
  const doc = await this.findByIdAndUpdate(
    'config',
    { $inc: { [field]: 1 } },
    { new: true, upsert: true }
  );
  return doc[field];
};

module.exports = mongoose.model('AppConfig', appConfigSchema);
