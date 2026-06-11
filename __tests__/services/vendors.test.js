'use strict';

jest.mock('../../models/Vendor', () => ({
  find: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../models/VendorTransaction', () => ({
  aggregate: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('../../models/Expense', () => ({
  create: jest.fn(),
}));
jest.mock('../../models/AppConfig', () => ({ nextSeq: jest.fn().mockResolvedValue(1) }));
jest.mock('../../models/Transaction', () => ({ create: jest.fn() }));
jest.mock('../../lib/constants', () => ({
  EXP_TYPE_TEMPLE_OPS: 'Temple Operations',
  RCP_YEAR: '2026',
}));

const Vendor = require('../../models/Vendor');
const svc    = require('../../services/vendors');

function makeFindChain(resolvedValue) {
  return {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(resolvedValue),
  };
}

describe('vendors service — getVendors()', () => {
  it('returns ok response with active vendors', async () => {
    const fakeVendors = [
      { _id: 'v1', name: 'Saravana', displayName: 'Saravana (Poojari)', type: 'Poojari', isActive: true },
    ];
    Vendor.find.mockReturnValue(makeFindChain(fakeVendors));

    const result = await svc.getVendors();
    expect(result.status).toBe('ok');
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data[0].name).toBe('Saravana');
  });

  it('queries only active vendors', async () => {
    Vendor.find.mockReturnValue(makeFindChain([]));
    await svc.getVendors();
    const [filter] = Vendor.find.mock.calls[0];
    expect(filter).toEqual({ isActive: true });
  });
});

describe('vendors service — addVendor()', () => {
  beforeEach(() => {
    Vendor.create.mockResolvedValue({
      _id: 'v2',
      name: 'NewVendor',
      displayName: 'NewVendor',
      type: 'Supplier',
    });
  });

  it('creates vendor with provided fields', async () => {
    const result = await svc.addVendor({
      name: 'NewVendor',
      type: 'Supplier',
      phone: '9876543210',
    });

    expect(Vendor.create).toHaveBeenCalled();
    const [doc] = Vendor.create.mock.calls[0];
    expect(doc.name).toBe('NewVendor');
    expect(doc.type).toBe('Supplier');
    expect(doc.phone).toBe('9876543210');
    expect(result.status).toBe('ok');
  });

  it('defaults displayName to name when not provided', async () => {
    await svc.addVendor({ name: 'QuickVendor' });
    const [doc] = Vendor.create.mock.calls[0];
    expect(doc.displayName).toBe('QuickVendor');
  });

  it('defaults type to Other when not provided', async () => {
    await svc.addVendor({ name: 'SomeVendor' });
    const [doc] = Vendor.create.mock.calls[0];
    expect(doc.type).toBe('Other');
  });
});
