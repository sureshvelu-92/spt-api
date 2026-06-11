'use strict';

jest.mock('../../models/Donation', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock('../../models/AppConfig', () => ({ nextSeq: jest.fn().mockResolvedValue(1) }));
jest.mock('../../models/Transaction', () => ({ create: jest.fn() }));
jest.mock('../../models/InKind', () => ({ create: jest.fn(), find: jest.fn() }));
jest.mock('../../models/PoojaSchedule', () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../lib/constants', () => ({
  EXP_TYPE_AADI: 'Aadi Festival',
  RCP_YEAR: '2026',
}));

const Donation    = require('../../models/Donation');
const AppConfig   = require('../../models/AppConfig');
const svc         = require('../../services/donations');

// ── Helper to build a chainable lean() mock for Donation.find ────
function makeFindChain(resolvedValue) {
  const chain = {
    sort:  jest.fn().mockReturnThis(),
    skip:  jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean:  jest.fn().mockResolvedValue(resolvedValue),
  };
  return chain;
}

// ── Helper for findOne().lean() chain ─────────────────────────────
function makeFindOneChain(resolvedValue) {
  return { lean: jest.fn().mockResolvedValue(resolvedValue) };
}

// ═══════════════════════════════════════════════════════════════════
// addDonation
// ═══════════════════════════════════════════════════════════════════
describe('donations service — addDonation()', () => {
  beforeEach(() => {
    // upsert call returns a doc
    Donation.findOneAndUpdate.mockResolvedValue({ _id: 'doc1', receiptNo: '2026/D/1' });
    // findOne used after upsert to get donation _id for PoojaSchedule link (no .lean())
    Donation.findOne.mockResolvedValue({ _id: 'doc1', receiptNo: '2026/D/1' });
    AppConfig.nextSeq.mockResolvedValue(1);
  });

  it('calls Donation.findOneAndUpdate (upsert) with correct receiptNo', async () => {
    const result = await svc.addDonation({
      donor: 'Test Donor',
      amount: '1000',
      mode: 'Cash',
      donType: 'Aadi Festival',
    });

    expect(Donation.findOneAndUpdate).toHaveBeenCalled();
    const [query, update] = Donation.findOneAndUpdate.mock.calls[0];
    expect(query.receiptNo).toBe('2026/D/1');
    expect(update.$set.donor).toBe('Test Donor');
    expect(update.$set.amount).toBe(1000);
    expect(result.status).toBe('ok');
    expect(result.receiptNo).toBe('2026/D/1');
  });

  it('sets status to Received when full amount is received', async () => {
    await svc.addDonation({ donor: 'A', amount: '500', received: '500', donType: 'Aadi Festival' });
    const [, update] = Donation.findOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe('Received');
  });

  it('sets status to Partially Received when partial amount received', async () => {
    await svc.addDonation({ donor: 'B', amount: '500', received: '200', donType: 'Aadi Festival' });
    const [, update] = Donation.findOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe('Partially Received');
  });

  it('sets status to Pending when isPending is true', async () => {
    await svc.addDonation({ donor: 'C', amount: '500', isPending: 'true', donType: 'Aadi Festival' });
    const [, update] = Donation.findOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe('Pending');
  });

  it('uses provided receiptNo without generating a new seq', async () => {
    await svc.addDonation({ donor: 'D', amount: '200', receiptNo: 'CUSTOM/001', donType: 'Aadi Festival' });
    const [query] = Donation.findOneAndUpdate.mock.calls[0];
    expect(query.receiptNo).toBe('CUSTOM/001');
    // AppConfig.nextSeq should not have been called for 'donation'
    const donationSeqCalls = AppConfig.nextSeq.mock.calls.filter(c => c[0] === 'donation');
    expect(donationSeqCalls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// getReceipts
// ═══════════════════════════════════════════════════════════════════
describe('donations service — getReceipts()', () => {
  it('returns ok response with data array', async () => {
    const fakeDocs = [
      { receiptNo: '2026/D/1', date: new Date(), donor: 'Alice', phone: '', amount: 500, received: 500, balance: 0, mode: 'Cash', receivedBy: '', notes: '', status: 'Received', donType: 'Aadi Festival', personName: '', poojaType: '', poojaVariant: '', poojaDate: null, _id: '1' },
    ];
    Donation.find.mockReturnValue(makeFindChain(fakeDocs));
    Donation.countDocuments.mockResolvedValue(0);

    const result = await svc.getReceipts({});
    expect(result.status).toBe('ok');
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]['Donor Name']).toBe('Alice');
  });

  it('filters by donType when provided', async () => {
    Donation.find.mockReturnValue(makeFindChain([]));
    await svc.getReceipts({ donType: 'Aadi Festival' });
    const [filter] = Donation.find.mock.calls[0];
    expect(filter.donType).toBe('Aadi Festival');
  });

  it('applies year filter when year param provided', async () => {
    Donation.find.mockReturnValue(makeFindChain([]));
    await svc.getReceipts({ year: '2026' });
    const [filter] = Donation.find.mock.calls[0];
    expect(filter.date).toBeDefined();
    expect(filter.date.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateReceived
// ═══════════════════════════════════════════════════════════════════
describe('donations service — updateReceived()', () => {
  it('returns error if donation not found', async () => {
    // updateReceived uses findOne().lean() - need chain mock
    Donation.findOne.mockReturnValue(makeFindOneChain(null));
    const result = await svc.updateReceived({ id: 'nonexistent' });
    expect(result.status).toBe('error');
    expect(result.message).toBe('Donation not found');
  });

  it('updates received amount and recalculates status', async () => {
    Donation.findOne.mockReturnValue(makeFindOneChain({ _id: 'id1', received: 200, amount: 500, mode: 'Cash' }));
    Donation.findOneAndUpdate.mockResolvedValue({ receiptNo: '2026/D/1', status: 'Partially Received' });

    const result = await svc.updateReceived({ id: 'id1', received: '100' });
    // ok() spreads {receiptNo, status} which overrides the 'ok' status key with the donation status
    expect(result.receiptNo).toBe('2026/D/1');
    const [, update] = Donation.findOneAndUpdate.mock.calls[0];
    expect(update.$set.received).toBe(300); // 200 + 100
  });

  it('sets status to Received when balance reaches 0', async () => {
    Donation.findOne.mockReturnValue(makeFindOneChain({ _id: 'id2', received: 400, amount: 500, mode: 'Cash' }));
    Donation.findOneAndUpdate.mockResolvedValue({ receiptNo: '2026/D/2', status: 'Received' });

    await svc.updateReceived({ id: 'id2', received: '100' });
    const [, update] = Donation.findOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe('Received');
    expect(update.$set.balance).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// getYearlyDonations
// ═══════════════════════════════════════════════════════════════════
describe('donations service — getYearlyDonations()', () => {
  it('filters donations by year and returns ok response', async () => {
    const fakeDocs = [
      { receiptNo: '2026/D/1', date: new Date('2026-03-01'), donor: 'Bob', phone: '', amount: 300, received: 300, balance: 0, mode: 'Cash', receivedBy: '', notes: '', status: 'Received', donType: 'Aadi Festival', personName: '', poojaType: '', poojaVariant: '', poojaDate: null, _id: '2' },
    ];
    Donation.find.mockReturnValue(makeFindChain(fakeDocs));

    const result = await svc.getYearlyDonations({ year: '2026' });
    expect(result.status).toBe('ok');
    expect(result.year).toBe(2026);
    expect(Array.isArray(result.data)).toBe(true);

    const [filter] = Donation.find.mock.calls[0];
    expect(filter.date.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(filter.date.$lt).toEqual(new Date(Date.UTC(2027, 0, 1)));
  });

  it('defaults to current year when no year param provided', async () => {
    Donation.find.mockReturnValue(makeFindChain([]));
    await svc.getYearlyDonations({});
    const [filter] = Donation.find.mock.calls[0];
    const currentYear = new Date().getFullYear();
    expect(filter.date.$gte).toEqual(new Date(Date.UTC(currentYear, 0, 1)));
  });
});
