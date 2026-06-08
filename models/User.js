const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, default: '' },
  phone:     { type: String, default: '' },
  role:      { type: String, enum: ['admin', 'trustee', 'viewer'], default: 'trustee', index: true },
  isActive:  { type: Boolean, default: true, index: true },
  pin:       { type: String, default: '1234' }, // 4-digit PIN for login
  createdBy: { type: String, default: '' },
}, { timestamps: true });

userSchema.index({ name: 1 });

module.exports = mongoose.model('User', userSchema);
