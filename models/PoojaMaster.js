// ⚠️  LEGACY — pooja breakdown config moved to AppConfig.poojaBreakdown. Not used by api.js.
// Kept for any existing data; do not reference in new code.
const mongoose = require('mongoose');

const breakdownLineSchema = new mongoose.Schema({
  vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  vendorName: { type: String, required: true },
  item:       { type: String, default: '' },       // e.g. 'Lemon', 'Milk', 'Poojari charge'
  amount:     { type: Number, required: true, default: 0 },
  category:   { type: String, default: '' },
}, { _id: false });

const variantSchema = new mongoose.Schema({
  breakdown:  { type: [breakdownLineSchema], default: [] },
  totalCost:  { type: Number, default: 0 },   // sum of breakdown amounts
  margin:     { type: Number, default: 0 },   // rate - totalCost (rate from AppConfig.poojaRates)
}, { _id: false });

const poojaMasterSchema = new mongoose.Schema({
  name:     { type: String, required: true, unique: true, index: true },
  // Regular and Special breakdowns are separate — rates come from AppConfig.poojaRates
  regular:  { type: variantSchema, default: () => ({}) },
  special:  { type: variantSchema, default: () => ({}) },
  isActive: { type: Boolean, default: true, index: true },
  notes:    { type: String, default: '' },
}, { timestamps: true });

// Auto-compute totalCost and margin for each variant before save
poojaMasterSchema.pre('save', function (next) {
  const REGULAR_RATE = 799;
  const SPECIAL_RATE = 1499;
  if (this.regular?.breakdown?.length) {
    this.regular.totalCost = this.regular.breakdown.reduce((s, b) => s + (b.amount || 0), 0);
    this.regular.margin    = REGULAR_RATE - this.regular.totalCost;
  }
  if (this.special?.breakdown?.length) {
    this.special.totalCost = this.special.breakdown.reduce((s, b) => s + (b.amount || 0), 0);
    this.special.margin    = SPECIAL_RATE - this.special.totalCost;
  }
  next();
});

module.exports = mongoose.model('PoojaMaster', poojaMasterSchema);
