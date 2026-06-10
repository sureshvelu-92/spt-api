const mongoose = require('mongoose');

// ⚠️  LEGACY — not used by api.js. Vendor settlements now use VendorTransaction model.
// Kept for any existing data; do not reference in new code.
const paymentSchema = new mongoose.Schema({
  paymentNo:   { type: String, required: true, unique: true, index: true },
  // pattern: 2026/PAY/1
  date:        { type: Date,   default: Date.now, index: true },
  vendorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', index: true },
  vendorName:  { type: String, required: true },            // denormalized
  expenseIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Expense' }],
  amount:      { type: Number, required: true, default: 0 },
  mode:        { type: String, default: 'Cash',
                 enum: ['Cash','UPI','Cheque','Bank Transfer'] },
  reference:   { type: String, default: '' },               // UPI txn ID / cheque no
  paidBy:      { type: String, default: '' },               // trustee name
  paidById:    { type: mongoose.Schema.Types.ObjectId, ref: 'Trustee' },
  remarks:     { type: String, default: '' },
  year:        { type: Number, default: () => new Date().getFullYear(), index: true },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
