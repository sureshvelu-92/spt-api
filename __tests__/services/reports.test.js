'use strict';

// ── Model mocks ───────────────────────────────────────────────
jest.mock('../../models/Donation');
jest.mock('../../models/Expense');
jest.mock('../../models/Transaction');
jest.mock('../../lib/constants', () => ({ RCP_YEAR: '2026' }));

const Donation    = require('../../models/Donation');
const Expense     = require('../../models/Expense');
const Transaction = require('../../models/Transaction');
const svc         = require('../../services/reports');

// ── Helpers to build chainable mongoose mock ──────────────────
function makeFindChain(docs) {
  return {
    lean: jest.fn().mockResolvedValue(docs),
  };
}

// ── getCombinedLedger ─────────────────────────────────────────

describe('reports service — getCombinedLedger()', () => {
  beforeEach(() => {
    // Default: empty collections
    Donation.find.mockReturnValue(makeFindChain([]));
    Expense.find.mockReturnValue(makeFindChain([]));
    Transaction.find.mockReturnValue(makeFindChain([]));
  });

  it('returns ok with correct shape on empty data', async () => {
    const result = await svc.getCombinedLedger({ year: '2026' });
    expect(result.status).toBe('ok');
    expect(typeof result.openingBalance).toBe('number');
    expect(typeof result.totalCredit).toBe('number');
    expect(typeof result.totalDebit).toBe('number');
    expect(typeof result.closingBalance).toBe('number');
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('computes totalCredit = sum of donation received amounts', async () => {
    const fakeDonations = [
      { _id: 'd1', receiptNo: '2026/D/1', date: new Date('2026-03-01'), received: 1000, donor: 'Alice', donType: 'Aadi Festival', poojaType: '', notes: '', mode: 'Cash', receivedBy: '' },
      { _id: 'd2', receiptNo: '2026/D/2', date: new Date('2026-04-01'), received: 500, donor: 'Bob', donType: 'Aadi Festival', poojaType: '', notes: '', mode: 'UPI', receivedBy: '' },
    ];

    // Mock find to return in-period docs for the main query, empty for pre-period
    Donation.find
      .mockReturnValueOnce(makeFindChain(fakeDonations)) // main query
      .mockReturnValueOnce(makeFindChain([]));            // pre-period (opening balance)
    Expense.find
      .mockReturnValueOnce(makeFindChain([]))             // main query
      .mockReturnValueOnce(makeFindChain([]));            // pre-period
    Transaction.find
      .mockReturnValueOnce(makeFindChain([]))             // main query
      .mockReturnValueOnce(makeFindChain([]));            // pre-period

    const result = await svc.getCombinedLedger({ year: '2026' });
    expect(result.totalCredit).toBe(1500);
    expect(result.totalDebit).toBe(0);
  });

  it('computes totalDebit = sum of expense amounts', async () => {
    const fakeExpenses = [
      { _id: 'e1', voucherNo: '2026/EX/1', date: new Date('2026-03-05'), amount: 300, vendor: 'VendorA', description: 'Supplies', mode: 'Cash', paidBy: '' },
      { _id: 'e2', voucherNo: '2026/EX/2', date: new Date('2026-03-10'), amount: 200, vendor: 'VendorB', description: 'Food', mode: 'Cash', paidBy: '' },
    ];

    Donation.find
      .mockReturnValueOnce(makeFindChain([]))
      .mockReturnValueOnce(makeFindChain([]));
    Expense.find
      .mockReturnValueOnce(makeFindChain(fakeExpenses))
      .mockReturnValueOnce(makeFindChain([]));
    Transaction.find
      .mockReturnValueOnce(makeFindChain([]))
      .mockReturnValueOnce(makeFindChain([]));

    const result = await svc.getCombinedLedger({ year: '2026' });
    expect(result.totalDebit).toBe(500);
    expect(result.totalCredit).toBe(0);
  });

  it('closingBalance = openingBalance + totalCredit - totalDebit', async () => {
    const preDonations = [
      { _id: 'pd1', receiptNo: 'OLD/D/1', date: new Date('2025-01-01'), received: 2000 },
    ];
    const preExpenses = [
      { _id: 'pe1', voucherNo: 'OLD/EX/1', date: new Date('2025-01-02'), amount: 500 },
    ];
    const curDonations = [
      { _id: 'd1', receiptNo: '2026/D/1', date: new Date('2026-03-01'), received: 1000, donor: 'Alice', donType: 'Aadi Festival', poojaType: '', notes: '', mode: 'Cash', receivedBy: '' },
    ];

    Donation.find
      .mockReturnValueOnce(makeFindChain(curDonations))   // in-period
      .mockReturnValueOnce(makeFindChain(preDonations));  // pre-period
    Expense.find
      .mockReturnValueOnce(makeFindChain([]))              // in-period
      .mockReturnValueOnce(makeFindChain(preExpenses));   // pre-period
    Transaction.find
      .mockReturnValueOnce(makeFindChain([]))              // in-period
      .mockReturnValueOnce(makeFindChain([]));             // pre-period

    const result = await svc.getCombinedLedger({ year: '2026' });
    // openingBalance = 2000 - 500 = 1500
    expect(result.openingBalance).toBe(1500);
    expect(result.totalCredit).toBe(1000);
    expect(result.totalDebit).toBe(0);
    expect(result.closingBalance).toBe(2500); // 1500 + 1000 - 0
  });

  it('rows have runningBalance that increments correctly', async () => {
    const curDonations = [
      { _id: 'd1', receiptNo: '2026/D/1', date: new Date('2026-03-01'), received: 1000, donor: 'A', donType: 'Aadi Festival', poojaType: '', notes: '', mode: 'Cash', receivedBy: '' },
      { _id: 'd2', receiptNo: '2026/D/2', date: new Date('2026-04-01'), received: 500, donor: 'B', donType: 'Aadi Festival', poojaType: '', notes: '', mode: 'Cash', receivedBy: '' },
    ];

    Donation.find
      .mockReturnValueOnce(makeFindChain(curDonations))
      .mockReturnValueOnce(makeFindChain([]));
    Expense.find
      .mockReturnValueOnce(makeFindChain([]))
      .mockReturnValueOnce(makeFindChain([]));
    Transaction.find
      .mockReturnValueOnce(makeFindChain([]))
      .mockReturnValueOnce(makeFindChain([]));

    const result = await svc.getCombinedLedger({ year: '2026' });
    // data is returned reversed (newest first), so last row (oldest) has smallest balance
    // Oldest entry: 1000 credit → runningBalance 1000
    // Newest entry: 500 credit → runningBalance 1500
    const sorted = [...result.data].sort((a, b) => new Date(a.date) - new Date(b.date));
    expect(sorted[0].runningBalance).toBe(1000);
    expect(sorted[1].runningBalance).toBe(1500);
  });

  it('supports from/to date range params', async () => {
    Donation.find.mockReturnValue(makeFindChain([]));
    Expense.find.mockReturnValue(makeFindChain([]));
    Transaction.find.mockReturnValue(makeFindChain([]));

    const result = await svc.getCombinedLedger({ from: '2026-03-01', to: '2026-03-31' });
    expect(result.status).toBe('ok');
    expect(result.from).toContain('2026-03-01');
  });
});
