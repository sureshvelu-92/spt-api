'use strict';

const User = require('../models/User');
const { ok, err } = require('../utils/helpers');
const { WEBAUTHN_RP_NAME, WEBAUTHN_RP_ID_DEFAULT } = require('../lib/constants');

const RP_NAME  = WEBAUTHN_RP_NAME;
const RP_ID    = process.env.WEBAUTHN_RP_ID || WEBAUTHN_RP_ID_DEFAULT;
// Accept both GitHub Pages and localhost dev origins
const ORIGINS  = process.env.WEBAUTHN_ORIGIN
  ? [process.env.WEBAUTHN_ORIGIN]
  : ['https://sureshvelu-92.github.io', 'http://localhost:3000', 'http://localhost:3001'];
const ORIGIN   = ORIGINS[0]; // kept for backward compat

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

async function getUsers() {
  const users = await User.find().sort({ name: 1 }).lean();
  return ok({ data: users });
}

async function addUser(p) {
  if (!p.name || !p.name.trim()) return err('name required');
  const validRoles = ['admin', 'trustee', 'viewer'];
  const role = validRoles.includes(p.role) ? p.role : 'trustee';
  const pin = /^\d{4}$/.test(p.pin || '') ? p.pin : '1234';
  const user = await User.create({
    name:      p.name.trim(),
    email:     p.email     || '',
    phone:     p.phone     || '',
    role,
    isActive:  p.isActive !== 'false',
    pin,
    createdBy: p.createdBy || '',
  });
  return ok({ data: user });
}

async function verifyPin(p) {
  if (!p.name) return err('name required');
  if (!p.pin)  return err('pin required');
  const user = await User.findOne({ name: p.name, isActive: true }).lean();
  if (!user)   return err('User not found');
  if (user.pin !== p.pin) return err('Wrong PIN');
  // Return user without pin field
  const { pin: _pin, ...safeUser } = user;
  return ok({ data: safeUser });
}

async function setPin(p) {
  if (!p.name)    return err('name required');
  if (!p.pin || !/^\d{4}$/.test(p.pin)) return err('PIN must be 4 digits');
  await User.updateOne({ name: p.name }, { $set: { pin: p.pin } });
  return ok({ message: 'PIN updated' });
}

// GET ?action=webauthnRegisterOptions&name=<userName>
async function webauthnRegisterOptions(p) {
  if (!p.name) return err('name required');
  const user = await User.findOne({ name: p.name, isActive: true }).select('+currentChallenge');
  if (!user) return err('User not found');
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID:   RP_ID,
    userID: Buffer.from(user._id.toString()),
    userName: user.name,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',   // force device biometric (Android fingerprint / iOS Face ID / Touch ID)
      residentKey:             'preferred',
      userVerification:        'preferred',  // request biometric but don't hard-fail if device skips UV flag
    },
    excludeCredentials: user.webAuthnCredentials.map(c => ({
      id:         c.credentialID,
      type:       'public-key',
      transports: c.transports,
    })),
  });
  user.currentChallenge = options.challenge;
  await user.save();
  return ok({ options });
}

// POST ?action=webauthnRegisterVerify  body: { name, response, label }
async function webauthnRegisterVerify(p) {
  if (!p.name) return err('name required');
  const user = await User.findOne({ name: p.name, isActive: true }).select('+currentChallenge');
  if (!user || !user.currentChallenge) return err('No registration in progress');
  let body;
  try { body = typeof p.response === 'string' ? JSON.parse(p.response) : p.response; }
  catch { return err('Invalid response JSON'); }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response:                body,
      expectedChallenge:       user.currentChallenge,
      expectedOrigin:          ORIGINS,
      expectedRPID:            RP_ID,
      requireUserVerification: false,  // Android/iOS handle UV during the prompt; don't double-check
    });
  } catch (e) {
    return err(e.message || 'Verification error');
  }
  if (!verification.verified) return err('Verification failed');
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  user.webAuthnCredentials.push({
    credentialID:        Buffer.from(credential.id).toString('base64url'),
    credentialPublicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter:             credential.counter,
    deviceType:          credentialDeviceType,
    backedUp:            credentialBackedUp,
    transports:          body.response?.transports ?? [],
    label:               p.label || 'My device',
  });
  user.currentChallenge = null;
  await user.save();
  return ok({ message: 'Biometric registered successfully' });
}

// GET ?action=webauthnAuthOptions&name=<userName>
async function webauthnAuthOptions(p) {
  if (!p.name) return err('name required');
  const user = await User.findOne({ name: p.name, isActive: true }).select('+currentChallenge');
  if (!user) return err('User not found');
  if (!user.webAuthnCredentials.length) return err('No biometric registered for this user');
  const options = await generateAuthenticationOptions({
    rpID:             RP_ID,
    userVerification: 'required',   // forces biometric on mobile
    allowCredentials: user.webAuthnCredentials.map(c => ({
      id:         c.credentialID,
      type:       'public-key',
      transports: c.transports,
    })),
  });
  user.currentChallenge = options.challenge;
  await user.save();
  return ok({ options });
}

// POST ?action=webauthnAuthVerify  body: { name, response }
async function webauthnAuthVerify(p) {
  if (!p.name) return err('name required');
  const user = await User.findOne({ name: p.name, isActive: true }).select('+currentChallenge +webAuthnCredentials');
  if (!user || !user.currentChallenge) return err('No authentication in progress');
  let body;
  try { body = typeof p.response === 'string' ? JSON.parse(p.response) : p.response; }
  catch { return err('Invalid response JSON'); }
  const credential = user.webAuthnCredentials.find(c => c.credentialID === body.id);
  if (!credential) return err('Credential not found');
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response:                body,
      expectedChallenge:       user.currentChallenge,
      expectedOrigin:          ORIGINS,
      expectedRPID:            RP_ID,
      requireUserVerification: true,
      credential: {
        id:         credential.credentialID,
        publicKey:  Buffer.from(credential.credentialPublicKey, 'base64url'),
        counter:    credential.counter,
        transports: credential.transports,
      },
    });
  } catch (e) {
    return err(e.message || 'Authentication error');
  }
  if (!verification.verified) return err('Authentication failed');
  credential.counter    = verification.authenticationInfo.newCounter;
  user.currentChallenge = null;
  await user.save();
  return ok({ name: user.name, role: user.role });
}

module.exports = {
  getUsers,
  addUser,
  verifyPin,
  setPin,
  webauthnRegisterOptions,
  webauthnRegisterVerify,
  webauthnAuthOptions,
  webauthnAuthVerify,
};
