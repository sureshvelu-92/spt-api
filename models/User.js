const mongoose = require('mongoose');

// ── WebAuthn credential sub-document ─────────────────────
// Stores one passkey per device per user.
// credentialID is base64url-encoded and used as the lookup key.
const webAuthnCredentialSchema = new mongoose.Schema({
  credentialID:        { type: String, required: true },   // base64url
  credentialPublicKey: { type: String, required: true },   // base64url (COSE key)
  counter:             { type: Number, default: 0 },        // replay-attack counter
  deviceType:          { type: String, default: '' },       // 'singleDevice' | 'multiDevice'
  backedUp:            { type: Boolean, default: false },
  transports:          { type: [String], default: [] },     // 'usb'|'ble'|'nfc'|'internal'
  createdAt:           { type: Date, default: Date.now },
  label:               { type: String, default: 'My device' },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, default: '' },
  phone:     { type: String, default: '' },
  role:      { type: String, enum: ['admin', 'trustee', 'viewer'], default: 'trustee', index: true },
  isActive:  { type: Boolean, default: true, index: true },
  pin:       { type: String, default: '1234' }, // 4-digit PIN for login
  createdBy: { type: String, default: '' },

  // ── WebAuthn / biometric passkeys ──────────────────────
  // Each entry represents one registered device (phone, laptop, etc.)
  webAuthnCredentials: { type: [webAuthnCredentialSchema], default: [] },
  // Temporary challenge stored during registration/authentication ceremony.
  // Cleared after use. NOT returned to clients.
  currentChallenge:    { type: String, default: null, select: false },

}, { timestamps: true });

userSchema.index({ name: 1 });

module.exports = mongoose.model('User', userSchema);
