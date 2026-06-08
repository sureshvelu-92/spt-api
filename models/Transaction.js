const mongoose = require('mongoose');

/**
 * Transaction — General Ledger / Cash Book
 *
 * Every money movement creates one entry:
 *   credit  → money IN  (donation received, asset sale, interest, misc income)
 *   debit   → money OUT (expense paid, vendor settlement)
 *
 * Running balance = sum(all credits) - sum(all debits) up to that date.
 * Balance is NOT stored — computed at query time to avoid update cascades.
 *
 * Auto-created by:
 *   addDonation  → credit  (when received > 0)
 *   addExpense   → debit
 * Manually created via addTransaction for ad-hoc income (asset sales etc.)
 */
const transactionSchema = new mongoose.Schema({

  txnNo:    { type: String, required: true, unique: true, index: true },
  // pattern: 2026/TXN/1

  date:     { type: Date, default: Date.now, index: true },

  // ── Direction ─────────────────────────────────────────────
  type:     { type: String, required: true, enum: ['credit', 'debit'], index: true },

  // ── What kind of transaction ──────────────────────────────
  category: {
    type: String,
    required: true,
    enum: [
      // Credits
      'Donation',           // regular cash/upi donation
      'Pooja Income',       // pooja booking fee
      'Asset Sale',         // selling old temple assets
      'Interest Income',    // bank/FD interest
      'Scrap Income',       // scrap / recycling proceeds
      'Misc Income',        // anything else coming in

      // Debits
      'Expense',            // regular expense voucher
      'Vendor Payment',     // vendor ledger settlement
      'Refund',             // money returned to donor
    ],
  },

  amount:      { type: Number, required: true, min: 0 },
  description: { type: String, default: '' },

  // ── Party (donor / vendor / payee) ───────────────────────
  party:       { type: String, default: '' },   // donor name or vendor name
  mode:        { type: String, default: 'Cash',
                 enum: ['Cash', 'UPI', 'Cheque', 'Bank Transfer', ''] },

  // ── Back-reference to source record ──────────────────────
  refType:  { type: String, enum: ['donation', 'inkind', 'expense', 'vendor_settlement', 'manual'], default: 'manual' },
  refId:    { type: String, default: '' },   // receiptNo / voucherNo

  // ── Who recorded it ──────────────────────────────────────
  recordedBy: { type: String, default: '' },
  remarks:    { type: String, default: '' },

  year: { type: Number, default: () => new Date().getFullYear(), index: true },

}, { timestamps: true });

// Compound index for ledger queries
transactionSchema.index({ date: 1, txnNo: 1 });
transactionSchema.index({ year: 1, type: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
