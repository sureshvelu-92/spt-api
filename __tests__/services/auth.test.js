'use strict';

jest.mock('../../models/User', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
}));
// Mock the WebAuthn library so it doesn't need real crypto
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));
jest.mock('../../lib/constants', () => ({
  WEBAUTHN_RP_NAME: 'Test Temple',
  WEBAUTHN_RP_ID_DEFAULT: 'localhost',
  RCP_YEAR: '2026',
}));

const User = require('../../models/User');
const svc  = require('../../services/auth');

function makeFindChain(resolvedValue) {
  return {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(resolvedValue),
  };
}

// For findOne().lean() pattern used in verifyPin
function makeFindOneChain(resolvedValue) {
  return { lean: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('auth service — getUsers()', () => {
  it('returns ok response with user list', async () => {
    const fakeUsers = [
      { _id: 'u1', name: 'Alice', role: 'admin', isActive: true },
      { _id: 'u2', name: 'Bob', role: 'trustee', isActive: true },
    ];
    User.find.mockReturnValue(makeFindChain(fakeUsers));

    const result = await svc.getUsers();
    expect(result.status).toBe('ok');
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe('Alice');
  });
});

describe('auth service — verifyPin()', () => {
  it('returns error when name is missing', async () => {
    const result = await svc.verifyPin({ pin: '1234' });
    expect(result.status).toBe('error');
    expect(result.message).toBe('name required');
  });

  it('returns error when pin is missing', async () => {
    const result = await svc.verifyPin({ name: 'Alice' });
    expect(result.status).toBe('error');
    expect(result.message).toBe('pin required');
  });

  it('returns error when user not found', async () => {
    User.findOne.mockReturnValue(makeFindOneChain(null));
    const result = await svc.verifyPin({ name: 'Ghost', pin: '9999' });
    expect(result.status).toBe('error');
    expect(result.message).toBe('User not found');
  });

  it('returns error when pin is wrong', async () => {
    User.findOne.mockReturnValue(makeFindOneChain({ _id: 'u1', name: 'Alice', pin: '1234', role: 'admin', isActive: true }));
    const result = await svc.verifyPin({ name: 'Alice', pin: '9999' });
    expect(result.status).toBe('error');
    expect(result.message).toBe('Wrong PIN');
  });

  it('returns ok with user data (without pin) when PIN matches', async () => {
    User.findOne.mockReturnValue(makeFindOneChain({ _id: 'u1', name: 'Alice', pin: '1234', role: 'admin', isActive: true, email: '' }));
    const result = await svc.verifyPin({ name: 'Alice', pin: '1234' });
    expect(result.status).toBe('ok');
    expect(result.data.name).toBe('Alice');
    // pin should NOT be present in the returned data
    expect(result.data.pin).toBeUndefined();
  });
});

describe('auth service — addUser()', () => {
  beforeEach(() => {
    User.create.mockResolvedValue({
      _id: 'u3',
      name: 'Charlie',
      role: 'trustee',
      isActive: true,
    });
  });

  it('returns error when name is empty', async () => {
    const result = await svc.addUser({ name: '   ', pin: '1234' });
    expect(result.status).toBe('error');
    expect(result.message).toBe('name required');
  });

  it('creates user with valid role', async () => {
    const result = await svc.addUser({ name: 'Charlie', role: 'admin', pin: '5678' });
    expect(User.create).toHaveBeenCalled();
    const [doc] = User.create.mock.calls[0];
    expect(doc.name).toBe('Charlie');
    expect(doc.role).toBe('admin');
    expect(result.status).toBe('ok');
  });

  it('defaults role to trustee for invalid roles', async () => {
    await svc.addUser({ name: 'Dave', role: 'superuser', pin: '1234' });
    const [doc] = User.create.mock.calls[0];
    expect(doc.role).toBe('trustee');
  });

  it('defaults pin to 1234 when invalid', async () => {
    await svc.addUser({ name: 'Eve', pin: 'abc' });
    const [doc] = User.create.mock.calls[0];
    expect(doc.pin).toBe('1234');
  });
});
