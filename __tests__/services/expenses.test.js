'use strict';

jest.mock('../../models/Expense', () => ({
  create: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../../models/AppConfig', () => ({ nextSeq: jest.fn().mockResolvedValue(1) }));
jest.mock('../../models/Transaction', () => ({ create: jest.fn() }));
jest.mock('../../lib/constants', () => ({
  EXP_TYPE_AADI: 'Aadi Festival',
  RCP_YEAR: '2026',
}));

const Expense   = require('../../models/Expense');
const AppConfig = require('../../models/AppConfig');
const svc       = require('../../services/expenses');

function makeFindChain(resolvedValue) {
  return {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(resolvedValue),
  };
}

describe('expenses service — addExpense()', () => {
  beforeEach(() => {
    Expense.create.mockResolvedValue({ _id: 'exp1', voucherNo: '2026/EX/1' });
    AppConfig.nextSeq.mockResolvedValue(1);
  });

  it('calls Expense.create with correct fields', async () => {
    const result = await svc.addExpense({
      vendor: 'TestVendor',
      description: 'Pooja supplies',
      category: 'Pooja Materials',
      amount: '2500',
      mode: 'Cash',
      paidBy: 'Admin',
    });

    expect(Expense.create).toHaveBeenCalled();
    const [doc] = Expense.create.mock.calls[0];
    expect(doc.vendor).toBe('TestVendor');
    expect(doc.amount).toBe(2500);
    expect(doc.voucherNo).toBe('2026/EX/1');
    expect(result.status).toBe('ok');
    expect(result.voucherNo).toBe('2026/EX/1');
  });

  it('uses provided voucherNo when given (no seq generated)', async () => {
    Expense.create.mockResolvedValue({ _id: 'exp2', voucherNo: 'MANUAL/EX/1' });
    await svc.addExpense({ vendor: 'V', amount: '100', voucherNo: 'MANUAL/EX/1' });
    const [doc] = Expense.create.mock.calls[0];
    expect(doc.voucherNo).toBe('MANUAL/EX/1');
    const expSeqCalls = AppConfig.nextSeq.mock.calls.filter(c => c[0] === 'expense');
    expect(expSeqCalls).toHaveLength(0);
  });

  it('defaults amount to 0 when not provided', async () => {
    Expense.create.mockResolvedValue({ _id: 'exp3', voucherNo: '2026/EX/1' });
    await svc.addExpense({ vendor: 'V' });
    const [doc] = Expense.create.mock.calls[0];
    expect(doc.amount).toBe(0);
  });
});

describe('expenses service — getExpenses()', () => {
  it('returns ok response with data array', async () => {
    const fakeDocs = [
      { voucherNo: '2026/EX/1', date: new Date(), vendor: 'Vendor A', description: 'Test', category: 'Food', amount: 1000, mode: 'Cash', paidBy: 'Admin', remarks: '', expType: 'Aadi Festival', _id: '1' },
    ];
    Expense.find.mockReturnValue(makeFindChain(fakeDocs));

    const result = await svc.getExpenses({});
    expect(result.status).toBe('ok');
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data[0]['Vendor/Payee']).toBe('Vendor A');
    expect(result.data[0]['Amount(₹)']).toBe(1000);
  });

  it('filters by expType when provided', async () => {
    Expense.find.mockReturnValue(makeFindChain([]));
    await svc.getExpenses({ expType: 'Temple Operations' });
    const [filter] = Expense.find.mock.calls[0];
    expect(filter.expType).toBe('Temple Operations');
  });

  it('applies year filter when year param provided', async () => {
    Expense.find.mockReturnValue(makeFindChain([]));
    await svc.getExpenses({ year: '2026' });
    const [filter] = Expense.find.mock.calls[0];
    expect(filter.date).toBeDefined();
    expect(filter.date.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });
});

describe('expenses service — getYearlyExpenses()', () => {
  it('returns filtered expenses for the given year', async () => {
    const fakeDocs = [
      { voucherNo: '2026/EX/1', date: new Date('2026-02-01'), vendor: 'Vendor B', description: '', category: '', amount: 500, mode: 'Cash', paidBy: '', remarks: '', expType: 'Aadi Festival', _id: '2' },
    ];
    Expense.find.mockReturnValue(makeFindChain(fakeDocs));

    const result = await svc.getYearlyExpenses({ year: '2026' });
    expect(result.status).toBe('ok');
    expect(result.year).toBe(2026);
    expect(result.count).toBe(1);

    const [filter] = Expense.find.mock.calls[0];
    expect(filter.date.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(filter.date.$lt).toEqual(new Date(Date.UTC(2027, 0, 1)));
  });

  it('defaults to current year when no year provided', async () => {
    Expense.find.mockReturnValue(makeFindChain([]));
    await svc.getYearlyExpenses({});
    const [filter] = Expense.find.mock.calls[0];
    const currentYear = new Date().getFullYear();
    expect(filter.date.$gte).toEqual(new Date(Date.UTC(currentYear, 0, 1)));
  });
});
