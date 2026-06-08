const mongoose = require('mongoose');

/**
 * VendorTransaction — tracks amounts owed to vendors and settlements
 *
 * credit > 0  → amount owed TO vendor (created when pooja receipt generated)
 * debit  > 0  → amount PAID to vendor (created when trustee settles)
 *
 * balance per vendor = sum(credit) - sum(debit) across isSettled: false credits
 */
const vendorTransactionSchema = new mongoose.Schema({
  vendorName: { type: String, required: true, index: true },
  vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },

  date:        { type: Date, default: Date.now, index: true },
  description: { type: String, default: '' },    // e.g. "Weekly Pooja (Regular) — 2026/D/012"
  item:        { type: String, default: '' },    // e.g. "Poojari charge", "Flowers & decoration"

  credit:  { type: Number, default: 0 },         // amount owed TO vendor (from pooja breakdown)
  debit:   { type: Number, default: 0 },         // amount PAID to vendor (settlement)

  refType: { type: String, enum: ['pooja', 'settlement'], required: true },
  refId:   { type: String, default: '' },        // receiptNo (pooja) or voucherNo (settlement)

  poojaName: { type: String, default: '' },      // e.g. "Weekly Pooja"
  variant:   { type: String, default: '' },      // "Regular" | "Special"

  // Settlement tracking
  isSettled:  { type: Boolean, default: false, index: true },
  settledAt:  { type: Date },
  settledBy:  { type: String, default: '' },
  settlementRef: { type: String, default: '' },  // expense voucherNo of the settlement

}, { timestamps: true });

// Compound index for payables query: unsettled credits per vendor
vendorTransactionSchema.index({ vendorName: 1, isSettled: 1, refType: 1 });

module.exports = mongoose.model('VendorTransaction', vendorTransactionSchema);
