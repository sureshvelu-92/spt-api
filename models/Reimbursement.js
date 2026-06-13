const mongoose = require('mongoose');

const reimbursementSchema = new mongoose.Schema({
  reimbNo:     { type: String, required: true, unique: true, index: true },
  date:        { type: Date,   default: Date.now, index: true },
  fromUser:    { type: String, required: true },   // who hands over cash
  toUser:      { type: String, required: true },   // who receives (gets reimbursed)
  amount:      { type: Number, required: true, min: 0 },
  notes:       { type: String, default: '' },
  recordedBy:  { type: String, default: '' },
  year:        { type: Number, default: () => new Date().getFullYear(), index: true },
}, { timestamps: true });

reimbursementSchema.index({ year: 1, date: -1 });
reimbursementSchema.index({ fromUser: 1, year: 1 });
reimbursementSchema.index({ toUser: 1, year: 1 });

module.exports = mongoose.model('Reimbursement', reimbursementSchema);
