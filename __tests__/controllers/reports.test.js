'use strict';

jest.mock('../../services/reports', () => ({
  getMonthlyReport:  jest.fn(),
  getYearlyReport:   jest.fn(),
  getOverallReport:  jest.fn(),
  getLedger:         jest.fn(),
  getCombinedLedger: jest.fn(),
}));

const ctrl = require('../../controllers/reports');
const svc  = require('../../services/reports');

function mockRes() {
  return { json: jest.fn() };
}

describe('reports controller — getCombinedLedger', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { year: '2026' } };
    const res = mockRes();
    const fakeResult = {
      status: 'ok',
      openingBalance: 0,
      totalCredit: 1000,
      totalDebit: 200,
      closingBalance: 800,
      data: [],
    };
    svc.getCombinedLedger.mockResolvedValue(fakeResult);

    await ctrl.getCombinedLedger(req, res);

    expect(svc.getCombinedLedger).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });
});

describe('reports controller — getMonthlyReport', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { year: '2026', month: '6' } };
    const res = mockRes();
    const fakeResult = { status: 'ok', period: 'Jun 2026', donations: {}, expenses: {} };
    svc.getMonthlyReport.mockResolvedValue(fakeResult);

    await ctrl.getMonthlyReport(req, res);

    expect(svc.getMonthlyReport).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });
});

describe('reports controller — getYearlyReport', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { year: '2026' } };
    const res = mockRes();
    const fakeResult = { status: 'ok', year: 2026, summary: {}, monthlyGrid: [] };
    svc.getYearlyReport.mockResolvedValue(fakeResult);

    await ctrl.getYearlyReport(req, res);

    expect(svc.getYearlyReport).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });
});

describe('reports controller — getOverallReport', () => {
  it('calls service getOverallReport with no args and sends json', async () => {
    const req = { query: {} };
    const res = mockRes();
    const fakeResult = { status: 'ok', summary: {} };
    svc.getOverallReport.mockResolvedValue(fakeResult);

    await ctrl.getOverallReport(req, res);

    expect(svc.getOverallReport).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });
});

describe('reports controller — getLedger', () => {
  it('calls service with req.query and sends json', async () => {
    const req = { query: { year: '2026', type: 'credit' } };
    const res = mockRes();
    const fakeResult = { status: 'ok', year: 2026, data: [] };
    svc.getLedger.mockResolvedValue(fakeResult);

    await ctrl.getLedger(req, res);

    expect(svc.getLedger).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });
});
