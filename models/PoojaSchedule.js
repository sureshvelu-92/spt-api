const mongoose = require('mongoose');

/**
 * PoojaSchedule — one document per pooja slot per day
 *
 * Financial data (amount, received, mode, receivedBy) stays in Donation.
 * Pooja-specific data (type, variant, personName, birthdayDate) lives here.
 *
 * Unique index: (poojaDate + poojaType) prevents duplicate slots.
 * For special poojas (Birthday/Anniversary) on the same day, poojaType differs.
 */
const poojaScheduleSchema = new mongoose.Schema({
  // ── Date / slot identity ──────────────────────────────────
  poojaDate:  { type: Date,   required: true, index: true },   // UTC midnight
  year:       { type: Number, required: true, index: true },
  month:      { type: Number, required: true, index: true },
  dayType:    { type: String, required: true,
                enum: ['Tuesday','Friday','Sunday','Amavasai','Pournami','Special'] },

  // ── Pooja details ─────────────────────────────────────────
  poojaType:    { type: String, default: 'Weekly Pooja' },
                // 'Weekly Pooja' | 'Amavasai Pooja' | 'Pournami Pooja'
                // | 'Birthday Pooja' | 'Anniversary Pooja'
  poojaVariant: { type: String, default: 'Regular' },           // 'Regular' | 'Special'
  personName:   { type: String, default: '' },                  // person for birthday/anniversary
  birthdayDate: { type: Date,   default: null },                // actual birth/anniversary date

  // ── Funding / status ─────────────────────────────────────
  status:         { type: String, default: 'unfunded',
                    enum: ['unfunded','donor_funded','temple_funded','pending_approval','rejected'] },
  isTempleFunded: { type: Boolean, default: false },
  approvalStatus: { type: String,  default: null,
                    enum: [null, 'pending', 'approved', 'rejected'] },
  approvedBy:     { type: String,  default: '' },
  approvedAt:     { type: Date,    default: null },
  rejectedReason: { type: String,  default: '' },

  // ── Links ─────────────────────────────────────────────────
  donationId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Donation', default: null },
  receiptNo:        { type: String, default: '' },              // denorm for fast lookup
  expenseVoucherNo: { type: String, default: '' },              // set after approval

  notes: { type: String, default: '' },
}, { timestamps: true });

// Unique: one record per (poojaDate + poojaType) — prevents duplicate slots
poojaScheduleSchema.index({ poojaDate: 1, poojaType: 1 }, { unique: true });
poojaScheduleSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model('PoojaSchedule', poojaScheduleSchema);
