'use strict';

jest.mock('../../services/donations', () => ({
  addDonation:        jest.fn(),
  addInKind:          jest.fn(),
  getReceipts:        jest.fn(),
  getRecentDonations: jest.fn(),
  getInKind:          jest.fn(),
  getLastSeq:         jest.fn(),
  updateReceived:     jest.fn(),
  getAllData:          jest.fn(),
  getYearlyDonations: jest.fn(),
}));

const ctrl = require('../../controllers/donations');
const svc  = require('../../services/donations');

function mockRes() {
  return { json: jest.fn() };
}

describe('donations controller — addDonation', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { donor: 'Test Donor', amount: '1000' } };
    const res = mockRes();
    svc.addDonation.mockResolvedValue({ status: 'ok', receiptNo: '2026/D/1', seq: 1 });

    await ctrl.addDonation(req, res);

    expect(svc.addDonation).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', receiptNo: '2026/D/1', seq: 1 });
  });
});

describe('donations controller — getReceipts', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { year: '2026' } };
    const res = mockRes();
    svc.getReceipts.mockResolvedValue({ status: 'ok', data: [], total: 0, page: 1, limit: 0 });

    await ctrl.getReceipts(req, res);

    expect(svc.getReceipts).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', data: [], total: 0, page: 1, limit: 0 });
  });
});

describe('donations controller — updateReceived', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { id: 'abc123', received: '500' } };
    const res = mockRes();
    svc.updateReceived.mockResolvedValue({ status: 'ok', receiptNo: '2026/D/1', status: 'Received' });

    await ctrl.updateReceived(req, res);

    expect(svc.updateReceived).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalled();
  });
});

describe('donations controller — getYearlyDonations', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { year: '2026' } };
    const res = mockRes();
    svc.getYearlyDonations.mockResolvedValue({ status: 'ok', data: [], year: 2026, count: 0 });

    await ctrl.getYearlyDonations(req, res);

    expect(svc.getYearlyDonations).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', data: [], year: 2026, count: 0 });
  });
});

describe('donations controller — getLastSeq', () => {
  it('calls service getLastSeq with "donation" type', async () => {
    const req = { query: {} };
    const res = mockRes();
    svc.getLastSeq.mockResolvedValue({ status: 'ok', seq: 42 });

    await ctrl.getLastSeq(req, res);

    expect(svc.getLastSeq).toHaveBeenCalledWith('donation');
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', seq: 42 });
  });
});
