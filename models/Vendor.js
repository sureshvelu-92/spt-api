const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  name:            { type: String, required: true },
  displayName:     { type: String, default: '' },          // e.g. "Saravana (Poojari)"
  type:            { type: String, required: true,
                     enum: ['Poojari','Supplier','Contractor','Utility','Other'],
                     index: true },
  phone:           { type: String, default: '' },
  upiId:           { type: String, default: '' },
  accountNo:       { type: String, default: '' },
  ifscCode:        { type: String, default: '' },
  bankName:        { type: String, default: '' },
  defaultCategory: { type: String, default: '' },          // auto-fill on selection
  isActive:        { type: Boolean, default: true, index: true },
  notes:           { type: String, default: '' },
}, { timestamps: true });

vendorSchema.index({ name: 1 });

module.exports = mongoose.model('Vendor', vendorSchema);
