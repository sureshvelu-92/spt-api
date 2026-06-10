const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  receiptNo:    { type: String, required: true, unique: true, index: true },
  date:         { type: Date,   default: Date.now, index: true },
  donor:        { type: String, required: true },
  phone:        { type: String, default: '' },
  amount:       { type: Number, default: 0 },
  received:     { type: Number, default: 0 },
  balance:      { type: Number, default: 0 },
  mode:         { type: String, default: 'Cash' },
  receivedBy:   { type: String, default: '' },          // display name (kept for legacy)
  receivedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notes:        { type: String, default: '' },
  status:       { type: String, default: 'Pending',
                  enum: ['Pending','Received','Partially Received'] },
  expectedDate: { type: String, default: '' },
  donType:      { type: String, default: 'Aadi Festival' },
  personName:   { type: String, default: '' },
  isPending:    { type: Boolean, default: false },
  // Pooja-specific fields
  poojaType:    { type: String, default: '' },   // e.g. "Weekly Pooja"
  poojaVariant: { type: String, default: '' },   // "Regular" | "Special"
  poojaDate:      { type: Date,    default: null },   // date pooja will be performed
  isTempleFunded:  { type: Boolean, default: false }, // true = no donor, funded by temple
  approvalStatus:  { type: String, default: 'approved',
                     enum: ['pending', 'approved', 'rejected'] },
  approvedBy:      { type: String, default: '' },
  approvedAt:      { type: Date,   default: null },
  rejectedReason:  { type: String, default: '' },
  // Link to PoojaSchedule (populated after migration / new donations)
  poojaScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoojaSchedule', default: null },
  year:         { type: Number, default: () => new Date().getFullYear(), index: true },
}, { timestamps: true });

// Compound indexes for common query patterns
donationSchema.index({ year: 1, date: -1 });              // yearly listings
donationSchema.index({ donType: 1, poojaDate: 1 });       // pooja schedule lookups
donationSchema.index({ poojaScheduleId: 1 });              // schedule → donation
donationSchema.index({ status: 1, year: 1 });              // pending/received filter
donationSchema.index({ receivedBy: 1, year: 1 });          // cash holders report

module.exports = mongoose.model('Donation', donationSchema);
