'use strict';

const Donation    = require('../models/Donation');
const Expense     = require('../models/Expense');
const Transaction = require('../models/Transaction');
const { ok, err, fmtDate, isPoojaType } = require('../utils/helpers');

// ── Monthly Report ────────────────────────────────────────
// ?action=getMonthlyReport&year=2026&month=6
async function getMonthlyReport(p) {
  const year  = parseInt(p.year  || new Date().getFullYear());
  const month = parseInt(p.month || new Date().getMonth() + 1); // 1-based

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to   = new Date(Date.UTC(year, month, 1));

  const [donAgg, expAgg, donRows, expRows, otherIncAgg, otherDebitAgg, cumulativePendingAgg, prevDonAgg, prevExpAgg, prevOtherCreditAgg, prevOtherDebitAgg] = await Promise.all([
    // Donation summary
    Donation.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: {
          _id:           null,
          totalPledged:  { $sum: '$amount' },
          totalReceived: { $sum: '$received' },
          totalBalance:  { $sum: '$balance' },
          count:         { $sum: 1 },
          byType: { $push: { type: '$donType', amount: '$received' } },
      }},
    ]),
    // Expense summary
    Expense.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: {
          _id:        null,
          totalSpent: { $sum: '$amount' },
          count:      { $sum: 1 },
          byCategory: { $push: { cat: '$category', amount: '$amount' } },
          byVendor:   { $push: { vendor: '$vendor', amount: '$amount' } },
      }},
    ]),
    // Donation detail rows
    Donation.find({ date: { $gte: from, $lt: to } }).sort({ date: 1 }).lean(),
    // Expense detail rows
    Expense.find({ date: { $gte: from, $lt: to } }).sort({ date: 1 }).lean(),
    // Other income this month (manual + vendor_settlement credits)
    Transaction.aggregate([
      { $match: { date: { $gte: from, $lt: to }, type: 'credit', refType: { $in: ['manual', 'vendor_settlement'] } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Other debits this month (vendor settlements, manual debits) — must match Cashbook
    Transaction.aggregate([
      { $match: { date: { $gte: from, $lt: to }, type: 'debit', refType: { $in: ['manual', 'vendor_settlement'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // ALL-TIME cumulative pending — sum of every unpaid donation balance across all months
    Donation.aggregate([
      { $match: { balance: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$balance' }, count: { $sum: 1 } } },
    ]),
    // Opening balance — all donations received BEFORE this month
    Donation.aggregate([
      { $match: { date: { $lt: from } } },
      { $group: { _id: null, received: { $sum: '$received' } } },
    ]),
    // Opening balance — all expenses BEFORE this month
    Expense.aggregate([
      { $match: { date: { $lt: from } } },
      { $group: { _id: null, spent: { $sum: '$amount' } } },
    ]),
    // Opening balance — all Transaction credits BEFORE this month
    Transaction.aggregate([
      { $match: { date: { $lt: from }, type: 'credit', refType: { $in: ['manual', 'vendor_settlement'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // Opening balance — all Transaction debits BEFORE this month (vendor settlements, etc.)
    Transaction.aggregate([
      { $match: { date: { $lt: from }, type: 'debit', refType: { $in: ['manual', 'vendor_settlement'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const dSumRaw    = donAgg[0] || { totalPledged: 0, totalReceived: 0, totalBalance: 0, count: 0, byType: [] };
  const eSumRaw    = expAgg[0] || { totalSpent: 0, count: 0, byCategory: [], byVendor: [] };
  const cumPending = (cumulativePendingAgg[0] || { total: 0, count: 0 });
  const otherDebitTotal = otherDebitAgg[0]?.total ?? 0;

  // Opening balance matches getCombinedLedger: donations + txn credits − expenses − txn debits
  const openingBalance =
    (prevDonAgg[0]?.received  ?? 0) +
    (prevOtherCreditAgg[0]?.total ?? 0) -
    (prevExpAgg[0]?.spent     ?? 0) -
    (prevOtherDebitAgg[0]?.total  ?? 0);

  // Summarise byType
  const donByType = {};
  dSumRaw.byType.forEach(r => {
    const k = r.type || 'Others';
    donByType[k] = (donByType[k] || 0) + (r.amount || 0);
  });
  // Summarise byCategory
  const expByCategory = {};
  eSumRaw.byCategory.forEach(r => {
    const k = r.cat || 'Miscellaneous';
    expByCategory[k] = (expByCategory[k] || 0) + (r.amount || 0);
  });
  // Summarise byVendor
  const expByVendor = {};
  eSumRaw.byVendor.forEach(r => {
    const k = r.vendor || 'Unknown';
    expByVendor[k] = (expByVendor[k] || 0) + (r.amount || 0);
  });

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const otherIncomeByCategory = {};
  let otherIncomeTotal = 0;
  (otherIncAgg || []).forEach(r => {
    const k = r._id || 'Misc Income';
    otherIncomeByCategory[k] = r.total;
    otherIncomeTotal += r.total;
  });

  const totalIncome  = dSumRaw.totalReceived + otherIncomeTotal;
  // totalOutflow = expenses + vendor settlement / manual debits — matches Cashbook
  const totalOutflow = eSumRaw.totalSpent + otherDebitTotal;

  return ok({
    period:  `${MONTH_NAMES[month]} ${year}`,
    year, month,
    donations: {
      totalPledged:  dSumRaw.totalPledged,
      totalReceived: dSumRaw.totalReceived,
      totalBalance:  dSumRaw.totalBalance,
      count:         dSumRaw.count,
      byType:        donByType,
      rows:          donRows.map(mapDonation),
    },
    otherIncome: {
      total:      otherIncomeTotal,
      byCategory: otherIncomeByCategory,
    },
    expenses: {
      totalSpent:  eSumRaw.totalSpent,
      count:       eSumRaw.count,
      byCategory:  expByCategory,
      byVendor:    expByVendor,
      rows:        expRows.map(mapExpense),
    },
    totalIncome,
    netBalance:             totalIncome - totalOutflow,
    openingBalance,
    closingBalance:         openingBalance + totalIncome - totalOutflow,
    cumulativePending:      cumPending.total,
    cumulativePendingCount: cumPending.count,
  });
}

// ── Yearly Report ─────────────────────────────────────────
// ?action=getYearlyReport&year=2026
async function getYearlyReport(p) {
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(Date.UTC(year, 0, 1));
  const to   = new Date(Date.UTC(year + 1, 0, 1));

  const [donMonthly, expMonthly, donByType, expByCat, expByVendor, otherIncMonthly,
         prevYearDonAgg, prevYearExpAgg, prevYearOtherAgg] = await Promise.all([
    // Donations month-by-month
    Donation.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: {
          _id:      { $month: '$date' },
          pledged:  { $sum: '$amount' },
          received: { $sum: '$received' },
          balance:  { $sum: '$balance' },
          count:    { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
    // Expenses month-by-month
    Expense.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: {
          _id:   { $month: '$date' },
          spent: { $sum: '$amount' },
          count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
    // Donations by type (full year)
    Donation.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: { _id: '$donType', total: { $sum: '$received' }, count: { $sum: 1 } } },
    ]),
    // Expenses by category (full year)
    Expense.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    // Top vendors (full year)
    Expense.aggregate([
      { $match: { date: { $gte: from, $lt: to } } },
      { $group: { _id: '$vendor', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 20 },
    ]),
    // Other income month-by-month (manual Transaction credits)
    Transaction.aggregate([
      { $match: { date: { $gte: from, $lt: to }, type: 'credit', refType: { $in: ['manual'] } } },
      { $group: { _id: { $month: '$date' }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    // Opening balance — all donations received BEFORE this year
    Donation.aggregate([
      { $match: { date: { $lt: from } } },
      { $group: { _id: null, received: { $sum: '$received' } } },
    ]),
    // Opening balance — all expenses BEFORE this year
    Expense.aggregate([
      { $match: { date: { $lt: from } } },
      { $group: { _id: null, spent: { $sum: '$amount' } } },
    ]),
    // Opening balance — all manual other income BEFORE this year
    Transaction.aggregate([
      { $match: { date: { $lt: from }, type: 'credit', refType: { $in: ['manual'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Year opening balance
  const yearOpeningBalance = (prevYearDonAgg[0]?.received ?? 0)
                            + (prevYearOtherAgg[0]?.total ?? 0)
                            - (prevYearExpAgg[0]?.spent ?? 0);

  // Build 12-month grid with running opening/closing balance per month
  const donMap   = Object.fromEntries(donMonthly.map(r => [r._id, r]));
  const expMap   = Object.fromEntries(expMonthly.map(r => [r._id, r]));
  const otherMap = Object.fromEntries((otherIncMonthly || []).map(r => [r._id, r.total]));

  let runningBalance = yearOpeningBalance;
  const monthlyGrid = Array.from({ length: 12 }, (_, i) => {
    const m   = i + 1;
    const don = donMap[m] || { pledged: 0, received: 0, balance: 0, count: 0 };
    const exp = expMap[m] || { spent: 0, count: 0 };
    const other = otherMap[m] || 0;
    const totalIncome = don.received + other;
    const net = totalIncome - exp.spent;
    const opening = runningBalance;
    const closing = opening + net;
    runningBalance = closing;
    return {
      month:          MONTH_NAMES[m],
      monthNo:        m,
      pledged:        don.pledged,
      received:       don.received,
      otherIncome:    other,
      totalIncome,
      balance:        don.balance,
      donCount:       don.count,
      spent:          exp.spent,
      expCount:       exp.count,
      net,
      openingBalance: opening,
      closingBalance: closing,
    };
  });

  const totalReceived    = monthlyGrid.reduce((s, r) => s + r.received, 0);
  const totalOtherIncome = monthlyGrid.reduce((s, r) => s + r.otherIncome, 0);
  const totalIncome      = totalReceived + totalOtherIncome;
  const totalSpent       = monthlyGrid.reduce((s, r) => s + r.spent, 0);

  return ok({
    year,
    summary: {
      totalPledged:    monthlyGrid.reduce((s, r) => s + r.pledged, 0),
      totalReceived,
      totalOtherIncome,
      totalIncome,
      totalBalance:    monthlyGrid.reduce((s, r) => s + r.balance, 0),
      totalSpent,
      netBalance:      totalIncome - totalSpent,
      openingBalance:  yearOpeningBalance,
      closingBalance:  yearOpeningBalance + totalIncome - totalSpent,
    },
    monthlyGrid,
    donByType:     donByType.map(r => ({ type: r._id || 'Others', total: r.total, count: r.count })),
    expByCategory: expByCat.map(r => ({ category: r._id || 'Miscellaneous', total: r.total, count: r.count })),
    topVendors:    expByVendor.map(r => ({ vendor: r._id || 'Unknown', total: r.total, count: r.count })),
  });
}

// ── Overall (all-time) Report ─────────────────────────────
// ?action=getOverallReport
async function getOverallReport() {
  const [donAgg, expAgg, donByType, expByCat, topVendors, byYear, otherInc, otherDebit, pendingDon] = await Promise.all([
    // All-time donation totals
    Donation.aggregate([
      { $group: {
          _id:           null,
          totalPledged:  { $sum: '$amount' },
          totalReceived: { $sum: '$received' },
          totalBalance:  { $sum: '$balance' },
          count:         { $sum: 1 },
      }},
    ]),
    // All-time expense totals
    Expense.aggregate([
      { $group: { _id: null, totalSpent: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // By donation type
    Donation.aggregate([
      { $group: { _id: '$donType', total: { $sum: '$received' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    // By expense category
    Expense.aggregate([
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    // Top vendors all-time
    Expense.aggregate([
      { $group: { _id: '$vendor', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 10 },
    ]),
    // Year-by-year summary
    Donation.aggregate([
      { $group: { _id: '$year', received: { $sum: '$received' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // All-time other income (credits: manual + vendor_settlement)
    Transaction.aggregate([
      { $match: { type: 'credit', refType: { $in: ['manual', 'vendor_settlement'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // All-time Transaction debits (vendor settlements + manual debits) — matches Cashbook
    Transaction.aggregate([
      { $match: { type: 'debit', refType: { $in: ['manual', 'vendor_settlement'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // Pending donations count + amount
    Donation.aggregate([
      { $match: { status: { $in: ['Pending', 'Partially Received'] } } },
      { $group: { _id: null, totalPending: { $sum: '$balance' }, count: { $sum: 1 } } },
    ]),
  ]);

  const d               = donAgg[0]  || { totalPledged: 0, totalReceived: 0, totalBalance: 0, count: 0 };
  const e               = expAgg[0]  || { totalSpent: 0, count: 0 };
  const otherTotal      = otherInc[0]?.total   ?? 0;
  const otherDebitTotal = otherDebit[0]?.total  ?? 0;
  const pending         = pendingDon[0] || { totalPending: 0, count: 0 };
  const totalIncome     = d.totalReceived + otherTotal;
  const totalOutflow    = e.totalSpent + otherDebitTotal;

  return ok({
    summary: {
      totalPledged:     d.totalPledged,
      totalReceived:    d.totalReceived,
      totalOtherIncome: otherTotal,
      totalIncome,
      totalBalance:     d.totalBalance,
      totalSpent:       e.totalSpent,
      netBalance:       totalIncome - totalOutflow,
      donCount:         d.count,
      expCount:         e.count,
      pendingAmount:    pending.totalPending,
      pendingCount:     pending.count,
    },
    byYear:        byYear.map(r => ({ year: r._id, received: r.received, count: r.count })),
    donByType:     donByType.map(r => ({ type: r._id || 'Others', total: r.total, count: r.count })),
    expByCategory: expByCat.map(r => ({ category: r._id || 'Misc', total: r.total, count: r.count })),
    topVendors:    topVendors.map(r => ({ vendor: r._id || 'Unknown', total: r.total, count: r.count })),
  });
}

/**
 * getLedger?year=2026&type=credit|debit&category=X
 * Returns transactions sorted by date ascending, with running balance.
 */
async function getLedger(p) {
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(Date.UTC(year, 0, 1));
  const to   = new Date(Date.UTC(year + 1, 0, 1));

  const filter = { date: { $gte: from, $lt: to } };
  if (p.type)     filter.type     = p.type;
  if (p.category) filter.category = p.category;

  const rows = await Transaction.find(filter).sort({ date: 1, txnNo: 1 }).lean();

  let balance = 0;
  const enriched = rows.map(r => {
    balance += r.type === 'credit' ? r.amount : -r.amount;
    return { ...r, runningBalance: balance };
  });

  const totalCredit = rows.filter(r => r.type === 'credit').reduce((s, r) => s + r.amount, 0);
  const totalDebit  = rows.filter(r => r.type === 'debit').reduce((s, r) => s + r.amount, 0);

  return ok({ year, totalCredit, totalDebit, netBalance: totalCredit - totalDebit, data: enriched.reverse() }); // newest first
}

/**
 * getCombinedLedger — unified view of donations + expenses + manual transactions
 *
 * Merges three sources into one chronological cash-book:
 *   Donation  (received > 0)  → credit
 *   Expense                   → debit
 *   Transaction               → credit or debit (manual / vendor payments)
 *
 * Query params:
 *   year     (default: current year)
 *   type     'credit' | 'debit' | '' (all)
 *   category filter (optional)
 *   search   partial match on party/description/refNo
 */
async function getCombinedLedger(p) {
  let from, to;
  if (p.from && p.to) {
    from = new Date(p.from);
    to   = new Date(p.to);
  } else {
    const year = parseInt(p.year || new Date().getFullYear());
    from = new Date(Date.UTC(year, 0, 1));
    to   = new Date(Date.UTC(year + 1, 0, 1));
  }

  // ── 1. Donations (received > 0) ──────────────────────────
  const donations = await Donation.find({
    date:     { $gte: from, $lt: to },
    received: { $gt: 0 },
  }).lean();

  const donRows = donations.map(d => ({
    _id:         d._id,
    refNo:       d.receiptNo,
    date:        d.date,
    type:        'credit',
    category:    isPoojaType(d.donType) ? 'Pooja Income' : 'Donation',
    party:       d.donor,
    description: d.donType + (d.poojaType ? ` — ${d.poojaType}` : '') + (d.notes ? ` (${d.notes})` : ''),
    amount:      d.received,
    mode:        d.mode || 'Cash',
    recordedBy:  d.receivedBy || '',
    source:      'donation',
  }));

  // ── 2. Expenses ──────────────────────────────────────────
  const expenses = await Expense.find({
    date: { $gte: from, $lt: to },
  }).lean();

  const expRows = expenses.map(e => ({
    _id:         e._id,
    refNo:       e.voucherNo,
    date:        e.date,
    type:        'debit',
    category:    'Expense',
    party:       e.vendor || '',
    description: e.description || e.category || '',
    amount:      e.amount,
    mode:        e.mode || 'Cash',
    recordedBy:  e.paidBy || '',
    source:      'expense',
  }));

  // ── 3. Manual transactions (asset sale, interest, vendor settlement, etc.) ──
  const manualTxns = await Transaction.find({
    date:    { $gte: from, $lt: to },
    refType: { $in: ['manual', 'vendor_settlement'] },
  }).lean();

  const txnRows = manualTxns.map(t => ({
    _id:         t._id,
    refNo:       t.txnNo,
    date:        t.date,
    type:        t.type,
    category:    t.category,
    party:       t.party || '',
    description: t.description || '',
    amount:      t.amount,
    mode:        t.mode || 'Cash',
    recordedBy:  t.recordedBy || '',
    source:      'transaction',
  }));

  // ── 4. Merge + sort by date asc ───────────────────────────
  let rows = [...donRows, ...expRows, ...txnRows];
  rows.sort((a, b) => new Date(a.date) - new Date(b.date) || a.refNo.localeCompare(b.refNo));

  // ── 5. Running balance ────────────────────────────────────
  let balance = 0;
  rows = rows.map(r => {
    balance += r.type === 'credit' ? r.amount : -r.amount;
    return { ...r, runningBalance: balance };
  });

  // ── 6. Apply filters (after balance) ─────────────────────
  if (p.type)     rows = rows.filter(r => r.type === p.type);
  if (p.category) rows = rows.filter(r => r.category === p.category);
  if (p.search) {
    const q = p.search.toLowerCase();
    rows = rows.filter(r =>
      r.party.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.refNo.toLowerCase().includes(q)
    );
  }

  // Return newest first for display
  const reversed = [...rows].reverse();

  const totalCredit = donRows.reduce((s, r) => s + r.amount, 0)
    + txnRows.filter(r => r.type === 'credit').reduce((s, r) => s + r.amount, 0);
  const totalDebit  = expRows.reduce((s, r) => s + r.amount, 0)
    + txnRows.filter(r => r.type === 'debit').reduce((s, r) => s + r.amount, 0);

  // ── Opening balance: sum of all transactions before `from` ─
  const [donBefore, expBefore, txnBefore] = await Promise.all([
    Donation.find({ date: { $lt: from }, received: { $gt: 0 } }).lean(),
    Expense.find({ date: { $lt: from } }).lean(),
    Transaction.find({ date: { $lt: from }, refType: { $in: ['manual', 'vendor_settlement'] } }).lean(),
  ]);
  const openingBalance =
    donBefore.reduce((s, d) => s + (d.received || 0), 0) +
    txnBefore.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0) -
    expBefore.reduce((s, e) => s + (e.amount || 0), 0) -
    txnBefore.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);

  return ok({
    from:           from.toISOString(),
    to:             to.toISOString(),
    openingBalance,
    totalCredit,
    totalDebit,
    closingBalance: openingBalance + totalCredit - totalDebit,
    netBalance:     totalCredit - totalDebit,
    count:          reversed.length,
    data:           reversed,
  });
}

// ── Private mapping helpers ───────────────────────────────
function mapDonation(d) {
  return {
    '#':            d.receiptNo,
    'Date':         fmtDate(d.date),
    'Donor Name':   d.donor,
    'Phone':        d.phone,
    'Total (₹)':    d.amount,
    'Received (₹)': d.received,
    'Balance (₹)':  d.balance,
    'Payment Mode': d.mode,
    'Received By':  d.receivedBy,
    'Purpose / Notes': d.notes,
    'Payment Status':  d.status,
    'Type':         d.donType,
    'Person Name':  d.personName,
    poojaType:      d.poojaType    || '',
    poojaVariant:   d.poojaVariant || '',
    poojaDate:      d.poojaDate ? fmtDate(d.poojaDate) : '',
    isPending:      d.status !== 'Received',
    _id:            d._id,
  };
}

function mapExpense(d) {
  return {
    '#':            d.voucherNo,
    'Date':         fmtDate(d.date),
    'Vendor/Payee': d.vendor,
    'Description':  d.description,
    'Category':     d.category,
    'Amount(₹)':    d.amount,
    'Mode':         d.mode,
    'Paid By':      d.paidBy,
    'Remarks':      d.remarks,
    'Type':         d.expType,
    _id:            d._id,
  };
}

// ── Custom Report ─────────────────────────────────────────
// ?action=getCustomReport&donTypes=Pooja,Donation&expTypes=Aadi+Festival&expCategories=...&notes=...&fromDate=2026-01-01&toDate=2026-12-31
async function getCustomReport(p) {
  const { donTypes, expTypes, expCategories, notes, fromDate, toDate } = p;

  // Date bounds (inclusive on both ends)
  const dateFilter = {};
  if (fromDate) dateFilter.$gte = new Date(fromDate);
  if (toDate)   dateFilter.$lte = new Date(new Date(toDate).setHours(23, 59, 59, 999));

  // ── Donation query ────────────────────────────────────────
  const donQuery = {};
  if (fromDate || toDate) donQuery.date = { ...dateFilter };
  if (donTypes) {
    const types = donTypes.split(',').map(t => t.trim()).filter(Boolean);
    if (types.length) donQuery.donType = { $in: types };
  }
  if (notes && notes.trim()) {
    donQuery.notes = { $regex: notes.trim(), $options: 'i' };
  }

  // ── Expense query ─────────────────────────────────────────
  const expQuery = {};
  if (fromDate || toDate) expQuery.date = { ...dateFilter };
  if (expTypes) {
    const types = expTypes.split(',').map(t => t.trim()).filter(Boolean);
    if (types.length) expQuery.expType = { $in: types };
  }
  if (expCategories) {
    const cats = expCategories.split(',').map(t => t.trim()).filter(Boolean);
    if (cats.length) expQuery.category = { $in: cats };
  }
  if (notes && notes.trim()) {
    expQuery.$or = [
      { description: { $regex: notes.trim(), $options: 'i' } },
      { remarks:     { $regex: notes.trim(), $options: 'i' } },
    ];
  }

  const [donations, expenses] = await Promise.all([
    Donation.find(donQuery).sort({ date: 1 }).lean(),
    Expense.find(expQuery).sort({ date: 1 }).lean(),
  ]);

  const donTotal = donations.reduce((s, d) => s + (d.received || 0), 0);
  const expTotal = expenses.reduce((s, e) => s + (e.amount  || 0), 0);

  return ok({
    donations: donations.map(mapDonation),
    expenses:  expenses.map(mapExpense),
    totals: {
      donCount: donations.length,
      expCount: expenses.length,
      donTotal,
      expTotal,
      net: donTotal - expTotal,
    },
  });
}

module.exports = {
  getMonthlyReport,
  getYearlyReport,
  getOverallReport,
  getLedger,
  getCombinedLedger,
  getCustomReport,
};
