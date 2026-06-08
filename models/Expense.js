const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  voucherNo:   { type: String, required: true, unique: true, index: true },
  date:        { type: Date,   default: Date.now, index: true },
  vendor:      { type: String, default: '' },
  description: { type: String, default: '' },
  category:    { type: String, default: '' },
  amount:      { type: Number, default: 0 },
  mode:        { type: String, default: 'Cash' },
  paidBy:      { type: String, default: '' },
  remarks:     { type: String, default: '' },
  expType:     { type: String, default: 'Aadi Festival' },
  vendorId:    { type: require('mongoose').Schema.Types.ObjectId, ref: 'Vendor' },
  paidById:    { type: require('mongoose').Schema.Types.ObjectId, ref: 'User', default: null },
  poojaTypeId: { type: require('mongoose').Schema.Types.ObjectId, ref: 'PoojaMaster' },
  paymentId:   { type: require('mongoose').Schema.Types.ObjectId, ref: 'Payment' },
  year:        { type: Number, default: () => new Date().getFullYear(), index: true },
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);
