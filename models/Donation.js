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
  receivedBy:   { type: String, default: '' },
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
  year:         { type: Number, default: () => new Date().getFullYear(), index: true },
}, { timestamps: true });

module.exports = mongoose.model('Donation', donationSchema);
