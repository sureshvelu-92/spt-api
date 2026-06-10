const mongoose = require('mongoose');

/**
 * Budget — festival budget per year
 *
 * One document per festival per year.
 * Line items capture per-item initial/revised budget + advances paid.
 */
const budgetItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  category:    { type: String, default: 'Miscellaneous' },
  initialBudget:  { type: Number, default: 0 },
  revisedBudget:  { type: Number, default: 0 },
  advance:        { type: Number, default: 0 },   // amount already paid/advanced
  notes:          { type: String, default: '' },
}, { _id: true });

const budgetSchema = new mongoose.Schema({
  festival:   { type: String, required: true },   // e.g. 'Aadi Festival'
  year:       { type: Number, required: true, index: true },
  items:      { type: [budgetItemSchema], default: [] },
  notes:      { type: String, default: '' },
  isFinalized:{ type: Boolean, default: false },
}, { timestamps: true });

// One budget per festival per year
budgetSchema.index({ festival: 1, year: 1 }, { unique: true });

// Virtual: total initial / revised / advance / balance
budgetSchema.virtual('totals').get(function () {
  const initial  = this.items.reduce((s, i) => s + (i.initialBudget  || 0), 0);
  const revised  = this.items.reduce((s, i) => s + (i.revisedBudget  || 0), 0);
  const advance  = this.items.reduce((s, i) => s + (i.advance        || 0), 0);
  return { initial, revised, advance, balance: revised - advance };
});

module.exports = mongoose.model('Budget', budgetSchema);
