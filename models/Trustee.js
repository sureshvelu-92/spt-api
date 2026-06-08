const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const trusteeSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  phone:      { type: String, required: true, unique: true, index: true },
  email:      { type: String, default: '' },
  pin:        { type: String, required: true },             // bcrypt-hashed 4-digit PIN
  role:       { type: String, default: 'trustee',
                enum: ['admin','trustee'] },
  qrImage:    { type: String, default: '' },                // path to QR image file
  isActive:   { type: Boolean, default: true },
  lastLogin:  { type: Date },
}, { timestamps: true });

// Hash PIN before save
trusteeSchema.pre('save', async function (next) {
  if (!this.isModified('pin')) return next();
  this.pin = await bcrypt.hash(this.pin, 10);
  next();
});

// Verify PIN
trusteeSchema.methods.verifyPin = function (pin) {
  return bcrypt.compare(pin, this.pin);
};

module.exports = mongoose.model('Trustee', trusteeSchema);
