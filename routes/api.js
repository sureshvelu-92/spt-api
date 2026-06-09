const router            = require('express').Router();
const Donation          = require('../models/Donation');
const Expense           = require('../models/Expense');
const InKind            = require('../models/InKind');
const AppConfig         = require('../models/AppConfig');
const Vendor            = require('../models/Vendor');
const VendorTransaction = require('../models/VendorTransaction');
const Transaction       = require('../models/Transaction');
const User              = require('../models/User');

const TOKEN = process.env.API_TOKEN || 'SPTT@1985';
const RCP_YEAR = '2026';

/** Returns true if the donType is a pooja/ceremony that uses vendor breakdown */
function isPoojaType(donType) {
  const t = (donType || '').toLowerCase();
  return t.includes('pooja') || t.includes('anniversary');
}

const ok  = (data) => ({ status: 'ok',    ...data });
const err = (msg)  => ({ status: 'error', message: msg });

// ── Auth middleware ───────────────────────────────────────
function auth(req, res, next) {
  const token = req.query.token || req.body.token || '';
  if (token !== TOKEN) return res.json(err('Unauthorized'));
  next();
}

// All actions via GET (matches existing PWA calls)
router.get('/', auth, async (req, res) => {
  const p = req.query;
  try {
    switch (p.action) {

      case 'ping':
        return res.json(ok({ message: 'Connected ✓', version: 1 }));

      case 'addDonation':     return res.json(await addDonation(p));
      case 'addPooja':        return res.json(await addPooja(p));
      case 'addInKindDonation': return res.json(await addInKind(p));
      case 'addExpense':      return res.json(await addExpense(p));
      case 'getReceipts':     return res.json(await getReceipts());
      case 'getInKindDonations': return res.json(await getInKind());
      case 'getExpenses':     return res.json(await getExpenses());
      case 'getLastSeq':      return res.json(await getLastSeq('donation'));
      case 'getLastInKindSeq': return res.json(await getLastSeq('inkind'));
      case 'getLastExpenseSeq': return res.json(await getLastSeq('expense'));
      case 'updateReceived':  return res.json(await updateReceived(p));
      case 'getAllData':       return res.json(await getAllData());
      case 'getMonthlyReport': return res.json(await getMonthlyReport(p));
      case 'getYearlyReport':  return res.json(await getYearlyReport(p));

      case 'getConfig':        return res.json(await getConfig());
      case 'updateConfig':     return res.json(await updateConfig(p));

      case 'getVendors':       return res.json(await getVendors());
      case 'addVendor':        return res.json(await addVendor(p));

      case 'getVendorPayables': return res.json(await getVendorPayables());
      case 'getVendorLedger':   return res.json(await getVendorLedger(p));
      case 'settleVendors':     return res.json(await settleVendors(p));

      case 'getSequences':      return res.json(await getSequences());
      case 'setSequence':       return res.json(await setSequence(p));

      case 'getLedger':             return res.json(await getLedger(p));
      case 'addTransaction':        return res.json(await addManualTransaction(p));
      case 'getCombinedLedger':     return res.json(await getCombinedLedger(p));
      case 'getCashHolders':        return res.json(await getCashHolders(p));

      case 'getPoojaSchedule':  return res.json(await getPoojaSchedule(p));
      case 'autoFillSchedule':  return res.json(await autoFillSchedule(p));
      case 'approvePooja':      return res.json(await approvePooja(p));
      case 'rejectPooja':       return res.json(await rejectPooja(p));

      case 'getUsers':          return res.json(await getUsers());
      case 'addUser':           return res.json(await addUser(p));
      case 'verifyPin':         return res.json(await verifyPin(p));
      case 'setPin':            return res.json(await setPin(p));

      // ── One-time repair: fix VendorTransaction dates to use poojaDate ──
      case 'fixVendorTxnDates': return res.json(await fixVendorTxnDates());

      default:
        return res.json(err('Unknown action'));
    }
  } catch (e) {
    console.error(e);
    return res.json(err(e.message));
  }
});

// Also support POST
router.post('/', auth, (req, res) => {
  req.query = { ...req.query, ...req.body };
  return router.handle(req, res);
});

// ── Handlers ─────────────────────────────────────────────

async function addDonation(p) {
  const year = new Date().getFullYear();
  const seq  = p.receiptNo
    ? null
    : await AppConfig.nextSeq('donation');
  const receiptNo = p.receiptNo || `${RCP_YEAR}/D/${seq}`;

  const amount   = parseFloat(p.amount) || 0;
  const received = p.received !== undefined ? parseFloat(p.received) : amount;
  const balance  = amount - received;
  const isPend   = p.isPending === 'true';
  const status   = isPend ? 'Pending'
    : (p.status || (received >= amount ? 'Received'
      : received > 0 ? 'Partially Received' : 'Pending'));

  const donDate = p.date ? new Date(p.date) : new Date();

  const donationDoc = {
    receiptNo, date: donDate,
    donor: p.donor || '', phone: p.phone || '',
    amount, received, balance,
    mode: isPend ? '' : (p.mode || 'Cash'),
    receivedBy:   p.receivedBy   || '',
    receivedById: p.receivedById ? require('mongoose').Types.ObjectId.isValid(p.receivedById) ? p.receivedById : null : null,
    notes: p.notes || p.purpose || '',
    status, isPending: isPend,
    donType: p.donType || 'Aadi Festival',
    personName: p.personName || '',
    poojaType:    p.poojaType    || '',
    poojaVariant: p.poojaVariant || '',
    poojaDate:    p.poojaDate ? new Date(p.poojaDate) : null,
  };

  // Upsert on receiptNo — safe to re-submit same receipt without duplicating
  await Donation.findOneAndUpdate(
    { receiptNo },
    { $set: donationDoc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // ── General Ledger: credit entry when money is actually received ──
  if (received > 0) {
    try {
      const txnSeq = await AppConfig.nextSeq('txn');
      const txnNo  = `${RCP_YEAR}/TXN/${txnSeq}`;
      const isPooja = isPoojaType(p.donType);
      await Transaction.create({
        txnNo, date: donDate, type: 'credit',
        category: isPooja ? 'Pooja Income' : 'Donation',
        amount:   received,
        description: p.notes || p.purpose || (isPooja ? `${p.poojaType || p.donType}${p.poojaVariant ? ` (${p.poojaVariant})` : ''}` : ''),
        party:    p.donor || '',
        mode:     isPend ? '' : (p.mode || 'Cash'),
        refType:  'donation', refId: receiptNo,
        recordedBy: p.receivedBy || '',
        year,
      });
    } catch (e) { console.error('Ledger credit error (non-fatal):', e.message); }
  }

  // ── Vendor Ledger: create credit entries from AppConfig breakdown ──
  // Only run for donations that carry a specific poojaType + variant from the breakdown config
  if (p.poojaType && p.poojaVariant) {
    try {
      const cfg        = await AppConfig.get();
      const variantKey = p.poojaVariant === 'Special' ? 'special' : 'regular';
      const breakdown  = cfg.poojaBreakdown?.[variantKey] || [];
      if (breakdown.length) {
        const personSuffix = p.personName ? ` | ${p.personName}` : '';
        const description  = `${p.poojaType} (${p.poojaVariant}) — ${receiptNo}${personSuffix}`;
        // Use poojaDate (scheduled date) as the transaction date if available
        const txnDate = p.poojaDate ? new Date(p.poojaDate) : donDate;
        const txns = breakdown.map(line => ({
          vendorName: line.vendorName,
          vendorId:   line.vendorId   || null,
          date:       txnDate,
          description,
          item:       line.item || '',
          credit:     line.amount || 0,
          debit:      0,
          refType:    'pooja',
          refId:      receiptNo,
          poojaName:  p.poojaType,
          variant:    p.poojaVariant,
          isSettled:  false,
        }));
        await VendorTransaction.insertMany(txns);
      }
    } catch (e) {
      console.error('Vendor ledger error (non-fatal):', e.message);
    }
  }

  return ok({ receiptNo, seq });
}

/**
 * addPooja — run a pooja from temple fund (no donor, no receipt)
 *
 * Required: poojaType, poojaVariant
 * Optional: date, notes, recordedBy
 *
 * Creates:
 *   1. VendorTransaction credits  (breakdown payables)
 *   2. Expense entry              (temple fund covers total cost)
 *   3. Transaction debit          (general ledger)
 */
async function addPooja(p) {
  if (!p.poojaType)    return err('poojaType required');
  if (!p.poojaVariant) return err('poojaVariant required');

  const poojaDate  = p.date ? new Date(p.date) : new Date();
  const cfg        = await AppConfig.get();
  const variantKey = p.poojaVariant === 'Special' ? 'special' : 'regular';
  const breakdown  = cfg.poojaBreakdown?.[variantKey] || [];

  if (!breakdown.length) return err('No pooja breakdown configured in AppConfig');

  const totalCost  = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const label      = `${p.poojaType} (${p.poojaVariant}) — Temple Fund`;

  // ── 1. Expense entry ─────────────────────────────────────
  const expSeq    = await AppConfig.nextSeq('expense');
  const voucherNo = `${RCP_YEAR}/EXP/${expSeq}`;
  await Expense.create({
    voucherNo,
    date:        poojaDate,
    vendor:      'Temple Fund',
    description: label,
    category:    'Puja & Rituals',
    expType:     'Temple Operations',
    amount:      totalCost,
    mode:        p.mode || 'Cash',
    paidBy:      p.recordedBy || '',
    remarks:     p.notes || '',
    year:        poojaDate.getFullYear(),
  });

  // ── 2. Transaction debit (general ledger) ────────────────
  try {
    const txnSeq = await AppConfig.nextSeq('txn');
    const txnNo  = `${RCP_YEAR}/TXN/${txnSeq}`;
    await Transaction.create({
      txnNo, date: poojaDate, type: 'debit',
      category:    'Expense',
      amount:      totalCost,
      description: label,
      party:       'Temple Fund',
      mode:        p.mode || 'Cash',
      refType:     'expense', refId: voucherNo,
      recordedBy:  p.recordedBy || '',
      year:        poojaDate.getFullYear(),
    });
  } catch (e) { console.error('Ledger debit error (non-fatal):', e.message); }

  // ── 3. VendorTransaction credits (payables) ──────────────
  const vtxns = breakdown.map(line => ({
    vendorName:  line.vendorName,
    vendorId:    line.vendorId || null,
    date:        poojaDate,
    description: label,
    item:        line.item || '',
    credit:      line.amount || 0,
    debit:       0,
    refType:     'pooja',
    refId:       voucherNo,      // expense voucher is the reference
    poojaName:   p.poojaType,
    variant:     p.poojaVariant,
    isSettled:   false,
  }));
  await VendorTransaction.insertMany(vtxns);

  return ok({
    voucherNo,
    poojaType:   p.poojaType,
    poojaVariant: p.poojaVariant,
    totalCost,
    breakdown:   breakdown.length,
  });
}

async function addInKind(p) {
  const year = new Date().getFullYear();
  const seq  = p.receiptNo ? null : await AppConfig.nextSeq('inkind');
  const receiptNo = p.receiptNo || `${RCP_YEAR}/IK/${seq}`;

  await InKind.create({
    receiptNo, date: p.date ? new Date(p.date) : new Date(),
    donor: p.donor || '', itemDesc: p.itemDesc || '',
    qty: p.qty || '', estValue: parseFloat(p.estValue) || 0,
    category: p.category || '', receivedBy: p.receivedBy || '',
    status: 'In Stock',
  });
  return ok({ receiptNo, seq });
}

async function addExpense(p) {
  const year    = new Date().getFullYear();
  const seq     = p.voucherNo ? null : await AppConfig.nextSeq('expense');
  const voucherNo = p.voucherNo || `${RCP_YEAR}/EX/${seq}`;
  const expDate = p.date ? new Date(p.date) : new Date();
  const amount  = parseFloat(p.amount) || 0;

  await Expense.create({
    voucherNo, date: expDate,
    vendor: p.vendor || '', description: p.description || '',
    category: p.category || '', amount,
    mode: p.mode || 'Cash',
    paidBy:   p.paidBy   || '',
    paidById: p.paidById ? require('mongoose').Types.ObjectId.isValid(p.paidById) ? p.paidById : null : null,
    remarks: p.remarks || '', expType: p.expType || 'Aadi Festival',
  });

  // ── General Ledger: auto debit entry ──
  try {
    const txnSeq = await AppConfig.nextSeq('txn');
    await Transaction.create({
      txnNo:       `${RCP_YEAR}/TXN/${txnSeq}`,
      date:        expDate,
      type:        'debit',
      category:    'Expense',
      amount,
      description: p.description || '',
      party:       p.vendor || '',
      mode:        p.mode || 'Cash',
      refType:     'expense',
      refId:       voucherNo,
      recordedBy:  p.paidBy || '',
      remarks:     p.remarks || '',
      year,
    });
  } catch (e) { console.error('Ledger debit error (non-fatal):', e.message); }

  return ok({ voucherNo, seq });
}

async function getReceipts() {
  const rows = await Donation.find().sort({ date: -1 }).lean();
  return ok({ data: rows.map(mapDonation) });
}

async function getInKind() {
  const rows = await InKind.find().sort({ date: -1 }).lean();
  return ok({ data: rows.map(mapInKind) });
}

async function getExpenses() {
  const rows = await Expense.find().sort({ date: -1 }).lean();
  return ok({ data: rows.map(mapExpense) });
}

async function getLastSeq(type) {
  const cfg = await AppConfig.get();
  const field = `${type}Seq`;
  return ok({ seq: cfg[field] ?? 0 });
}

async function updateReceived(p) {
  // Support lookup by _id or receiptNo
  const query = p.id
    ? { _id: p.id }
    : { receiptNo: p.receiptNo };

  const existing = await Donation.findOne(query).lean();
  if (!existing) return err('Donation not found');

  const addedAmt   = parseFloat(p.received) || 0;
  const newReceived = (existing.received || 0) + addedAmt;
  const newBalance  = (existing.amount  || 0) - newReceived;
  const newStatus   = newBalance <= 0 ? 'Received'
    : newReceived > 0 ? 'Partially Received' : 'Pending';

  const update = {
    received:   newReceived,
    balance:    Math.max(0, newBalance),
    status:     newStatus,
    isPending:  newStatus !== 'Received',
    mode:       p.mode || existing.mode || 'Cash',
  };
  if (p.receivedBy) update.receivedBy = p.receivedBy;

  const doc = await Donation.findOneAndUpdate(query, { $set: update }, { new: true });
  if (!doc) return err('Update failed');
  return ok({ receiptNo: doc.receiptNo, status: doc.status });
}

async function getAllData() {
  const [donations, inkind, expenses] = await Promise.all([
    Donation.find().sort({ date: -1 }).lean(),
    InKind.find().sort({ date: -1 }).lean(),
    Expense.find().sort({ date: -1 }).lean(),
  ]);
  return ok({
    donations: donations.map(mapDonation),
    inkind:    inkind.map(mapInKind),
    expenses:  expenses.map(mapExpense),
  });
}

// ── Monthly Report ────────────────────────────────────────
// ?action=getMonthlyReport&year=2026&month=6
async function getMonthlyReport(p) {
  const year  = parseInt(p.year  || new Date().getFullYear());
  const month = parseInt(p.month || new Date().getMonth() + 1); // 1-based

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to   = new Date(Date.UTC(year, month, 1));

  const [donAgg, expAgg, donRows, expRows, otherIncAgg] = await Promise.all([
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
    // Other income (manual Transaction credits: interest, asset sale, scrap, etc.)
    Transaction.aggregate([
      { $match: { date: { $gte: from, $lt: to }, type: 'credit', refType: { $in: ['manual'] } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const dSumRaw = donAgg[0] || { totalPledged: 0, totalReceived: 0, totalBalance: 0, count: 0, byType: [] };
  const eSumRaw = expAgg[0] || { totalSpent: 0, count: 0, byCategory: [], byVendor: [] };

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

  const totalIncome = dSumRaw.totalReceived + otherIncomeTotal;

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
    netBalance: totalIncome - eSumRaw.totalSpent,
  });
}

// ── Yearly Report ─────────────────────────────────────────
// ?action=getYearlyReport&year=2026
async function getYearlyReport(p) {
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(Date.UTC(year, 0, 1));
  const to   = new Date(Date.UTC(year + 1, 0, 1));

  const [donMonthly, expMonthly, donByType, expByCat, expByVendor, otherIncMonthly] = await Promise.all([
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
  ]);

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build 12-month grid
  const donMap    = Object.fromEntries(donMonthly.map(r => [r._id, r]));
  const expMap    = Object.fromEntries(expMonthly.map(r => [r._id, r]));
  const otherMap  = Object.fromEntries((otherIncMonthly || []).map(r => [r._id, r.total]));

  const monthlyGrid = Array.from({ length: 12 }, (_, i) => {
    const m   = i + 1;
    const don = donMap[m] || { pledged: 0, received: 0, balance: 0, count: 0 };
    const exp = expMap[m] || { spent: 0, count: 0 };
    const other = otherMap[m] || 0;
    const totalIncome = don.received + other;
    return {
      month:       MONTH_NAMES[m],
      monthNo:     m,
      pledged:     don.pledged,
      received:    don.received,
      otherIncome: other,
      totalIncome,
      balance:     don.balance,
      donCount:    don.count,
      spent:       exp.spent,
      expCount:    exp.count,
      net:         totalIncome - exp.spent,
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
    },
    monthlyGrid,
    donByType:   donByType.map(r => ({ type: r._id || 'Others', total: r.total, count: r.count })),
    expByCategory: expByCat.map(r => ({ category: r._id || 'Miscellaneous', total: r.total, count: r.count })),
    topVendors:  expByVendor.map(r => ({ vendor: r._id || 'Unknown', total: r.total, count: r.count })),
  });
}

// ── Map to PWA-compatible shape ───────────────────────────
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB',
    { day:'2-digit', month:'short', year:'numeric' });
}

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
    poojaType:      d.poojaType   || '',
    poojaVariant:   d.poojaVariant || '',
    poojaDate:      d.poojaDate ? fmtDate(d.poojaDate) : '',
    isPending:      d.isPending,
    _id:            d._id,
  };
}

function mapInKind(d) {
  return {
    '#':             d.receiptNo,
    'Date':          fmtDate(d.date),
    'Donor Name':    d.donor,
    'Item Description': d.itemDesc,
    'Qty':           d.qty,
    'Est. Value (₹)': d.estValue,
    'Category':      d.category,
    'Received By':   d.receivedBy,
    'Status':        d.status,
    _id:             d._id,
  };
}

function mapExpense(d) {
  return {
    '#':          d.voucherNo,
    'Date':       fmtDate(d.date),
    'Vendor/Payee': d.vendor,
    'Description': d.description,
    'Category':   d.category,
    'Amount(₹)':  d.amount,
    'Mode':       d.mode,
    'Paid By':    d.paidBy,
    'Remarks':    d.remarks,
    'Type':       d.expType,
    _id:          d._id,
  };
}

// ── AppConfig ─────────────────────────────────────────────

async function getConfig() {
  const cfg = await AppConfig.get();
  return ok({ data: cfg });
}

async function updateConfig(p) {
  // Fields that are JSON arrays
  const listFields = [
    'donationCashTypes', 'poojaTypes', 'inkindCategories',
    'expenseTypes', 'expenseCategories', 'templeDevCategories',
    'paymentModes', 'defaultReceivers',
  ];
  // Fields that are JSON objects
  const jsonFields = ['poojaRates', 'poojaBreakdown'];

  const update = {};
  for (const [k, v] of Object.entries(p)) {
    if (['action', 'token'].includes(k)) continue;
    if (listFields.includes(k)) {
      try { update[k] = JSON.parse(v); } catch { update[k] = v.split(',').map(s => s.trim()); }
    } else if (jsonFields.includes(k)) {
      try { update[k] = JSON.parse(v); } catch { /* ignore malformed JSON */ }
    } else {
      update[k] = v;
    }
  }
  const cfg = await AppConfig.findByIdAndUpdate('config', { $set: update }, { new: true, upsert: true });
  return ok({ data: cfg });
}

// ── Vendors ───────────────────────────────────────────────

async function getVendors() {
  const vendors = await Vendor.find({ isActive: true }).sort({ name: 1 }).lean();
  return ok({ data: vendors });
}

async function addVendor(p) {
  const vendor = await Vendor.create({
    name:            p.name,
    displayName:     p.displayName || p.name,
    type:            p.type || 'Other',
    phone:           p.phone || '',
    upiId:           p.upiId || '',
    accountNo:       p.accountNo || '',
    ifscCode:        p.ifscCode || '',
    bankName:        p.bankName || '',
    defaultCategory: p.defaultCategory || '',
    notes:           p.notes || '',
  });
  return ok({ data: vendor });
}

// ── Vendor Payables ───────────────────────────────────────

/**
 * getVendorPayables
 * Returns each vendor's outstanding balance (sum of unsettled credits).
 */
async function getVendorPayables() {
  const rows = await VendorTransaction.aggregate([
    { $match: { refType: 'pooja', isSettled: false } },
    { $group: {
        _id:       '$vendorName',
        balance:   { $sum: '$credit' },
        txnCount:  { $sum: 1 },
        oldest:    { $min: '$date' },
        latest:    { $max: '$date' },
    }},
    { $match: { balance: { $gt: 0 } } },
    { $sort: { _id: 1 } },
  ]);
  return ok({ data: rows.map(r => ({
    vendorName: r._id,
    balance:    r.balance,
    txnCount:   r.txnCount,
    since:      fmtDate(r.oldest),
    lastPooja:  fmtDate(r.latest),
  })) });
}

/**
 * getVendorLedger?vendorName=Saravana
 * Returns all transactions (credits + debits) for a vendor, newest first.
 */
async function getVendorLedger(p) {
  if (!p.vendorName) return err('vendorName required');
  const rows = await VendorTransaction.find({ vendorName: p.vendorName })
    .sort({ date: -1 }).lean();

  // running balance (oldest → newest)
  let runningBalance = 0;
  const enriched = [...rows].reverse().map(r => {
    runningBalance += (r.credit || 0) - (r.debit || 0);
    return { ...r, runningBalance };
  }).reverse();

  const totalOwed = rows
    .filter(r => r.refType === 'pooja' && !r.isSettled)
    .reduce((s, r) => s + (r.credit || 0), 0);

  return ok({ vendorName: p.vendorName, totalOwed, data: enriched });
}

/**
 * settleVendors
 * Params: vendorName, amount, paidBy, mode (optional), date (optional), remarks (optional)
 *
 * 1. Marks all unsettled pooja credits for this vendor as settled
 * 2. Creates an Expense entry (expType: Temple Operations)
 * 3. Creates a VendorTransaction debit entry linking back to the expense
 */
async function settleVendors(p) {
  if (!p.vendorName) return err('vendorName required');
  if (!p.amount)     return err('amount required');
  if (!p.paidBy)     return err('paidBy required');

  const amount   = parseFloat(p.amount) || 0;
  const settleDate = p.date ? new Date(p.date) : new Date();
  const settledBy  = p.paidBy;

  // 1. Create expense entry
  const expYear = settleDate.getFullYear();
  const expSeq  = await AppConfig.nextSeq('expense');
  const voucherNo = `${RCP_YEAR}/EX/${expSeq}`;

  await Expense.create({
    voucherNo,
    date:        settleDate,
    vendor:      p.vendorName,
    description: p.remarks || `Vendor payment — ${p.vendorName}`,
    category:    'Puja & Rituals',
    amount,
    mode:        p.mode || 'Cash',
    paidBy:      settledBy,
    remarks:     p.remarks || '',
    expType:     'Temple Operations',
  });

  // 2. Mark all unsettled pooja credits as settled
  await VendorTransaction.updateMany(
    { vendorName: p.vendorName, refType: 'pooja', isSettled: false },
    {
      isSettled:     true,
      settledAt:     settleDate,
      settledBy,
      settlementRef: voucherNo,
    }
  );

  // 3. Create debit entry in vendor ledger
  await VendorTransaction.create({
    vendorName:    p.vendorName,
    date:          settleDate,
    description:   `Settlement — ${voucherNo}`,
    item:          'Payment',
    credit:        0,
    debit:         amount,
    refType:       'settlement',
    refId:         voucherNo,
    isSettled:     true,
    settledAt:     settleDate,
    settledBy,
    settlementRef: voucherNo,
  });

  return ok({ voucherNo, vendorName: p.vendorName, amountPaid: amount });
}

// ── Sequences (now live in AppConfig) ────────────────────

async function getSequences() {
  const cfg = await AppConfig.get();
  return ok({
    donation: cfg.donationSeq ?? 0,
    inkind:   cfg.inkindSeq   ?? 0,
    expense:  cfg.expenseSeq  ?? 0,
    txn:      cfg.txnSeq      ?? 0,
  });
}

/**
 * setSequence?type=donation&seq=155
 * Sets the counter so the NEXT receipt will be seq+1
 */
async function setSequence(p) {
  const type = p.type;
  const seq  = parseInt(p.seq) || 0;
  const validTypes = { donation: 'donationSeq', inkind: 'inkindSeq', expense: 'expenseSeq', txn: 'txnSeq' };
  if (!validTypes[type]) return err('type must be donation|inkind|expense|txn');
  await AppConfig.findByIdAndUpdate('config', { $set: { [validTypes[type]]: seq } }, { upsert: true });
  return ok({ type, seq });
}

// ── General Ledger ────────────────────────────────────────

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
 * addTransaction — manual ledger entry (asset sale, interest, scrap, refund, etc.)
 * Required: type, category, amount, description
 */
async function addManualTransaction(p) {
  if (!p.type)        return err('type (credit|debit) required');
  if (!p.category)    return err('category required');
  if (!p.amount)      return err('amount required');

  const year   = new Date().getFullYear();
  const txnSeq = await AppConfig.nextSeq('txn');
  const txnNo  = `${RCP_YEAR}/TXN/${txnSeq}`;

  const txn = await Transaction.create({
    txnNo,
    date:        p.date ? new Date(p.date) : new Date(),
    type:        p.type,
    category:    p.category,
    amount:      parseFloat(p.amount) || 0,
    description: p.description || '',
    party:       p.party || '',
    mode:        p.mode || 'Cash',
    refType:     'manual',
    refId:       '',
    recordedBy:  p.recordedBy || '',
    remarks:     p.remarks || '',
    year,
  });
  return ok({ txnNo, data: txn });
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
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(Date.UTC(year, 0, 1));
  const to   = new Date(Date.UTC(year + 1, 0, 1));

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
  if (p.type)   rows = rows.filter(r => r.type === p.type);
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

  return ok({
    year,
    totalCredit,
    totalDebit,
    netBalance: totalCredit - totalDebit,
    count:      reversed.length,
    data:       reversed,
  });
}

/**
 * getCashHolders — shows how much each person has collected (ALL modes)
 *
 * Logic:
 *   Collected = sum of Donation.received (all modes) grouped by receivedBy
 *             + other income Transactions added to grand total
 *   Remitted  = sum of Expense.amount WHERE paidBy = person
 */
async function getCashHolders(p) {
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(Date.UTC(year,     0, 1));
  const to   = new Date(Date.UTC(year + 1, 0, 1));

  // All donations collected per person — irrespective of mode
  const collected = await Donation.aggregate([
    {
      $match: {
        date:       { $gte: from, $lt: to },
        received:   { $gt: 0 },
        receivedBy: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id:      '$receivedBy',
        userId:   { $first: '$receivedById' },
        total:    { $sum: '$received' },
        count:    { $sum: 1 },
        lastDate: { $max: '$date' },
      },
    },
    { $sort: { total: -1 } },
  ]);

  // Other income transactions (interest, asset sale, misc)
  const otherIncome = await Transaction.aggregate([
    {
      $match: {
        date:     { $gte: from, $lt: to },
        type:     'credit',
        category: { $nin: ['Donation', 'Pooja Income'] },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const otherIncomeTotal = otherIncome[0]?.total || 0;

  // Expenses paid out per person
  const remitted = await Expense.aggregate([
    {
      $match: {
        date:   { $gte: from, $lt: to },
        paidBy: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id:           '$paidBy',
        totalRemitted: { $sum: '$amount' },
      },
    },
  ]);

  // Individual donation rows per person
  const donationRows = await Donation.find({
    date:       { $gte: from, $lt: to },
    received:   { $gt: 0 },
    receivedBy: { $nin: [null, ''] },
  }).sort({ date: 1 }).lean();

  // Individual expense rows per person
  const expenseRows = await Expense.find({
    date:   { $gte: from, $lt: to },
    paidBy: { $nin: [null, ''] },
  }).sort({ date: 1 }).lean();

  // Group rows by person name
  const donByPerson  = {};
  for (const d of donationRows) {
    const n = d.receivedBy;
    if (!donByPerson[n]) donByPerson[n] = [];
    donByPerson[n].push({
      date:      fmtDate(d.date),
      donor:     d.donor,
      amount:    d.received,
      mode:      d.mode,
      receiptNo: d.receiptNo,
    });
  }

  const expByPerson = {};
  for (const e of expenseRows) {
    const n = e.paidBy;
    if (!expByPerson[n]) expByPerson[n] = [];
    expByPerson[n].push({
      date:        fmtDate(e.date),
      vendor:      e.vendor,
      description: e.description,
      amount:      e.amount,
      mode:        e.mode,
      voucherNo:   e.voucherNo,
    });
  }

  const remitMap = Object.fromEntries(remitted.map(r => [r._id, r.totalRemitted]));

  const holders = collected.map(r => {
    const name           = r._id || 'Unknown';
    const totalCollected = r.total;
    const totalRemitted  = remitMap[name] || 0;
    const cashInHand     = totalCollected - totalRemitted;
    return {
      name,
      userId:         r.userId || null,
      totalCollected,
      totalRemitted,
      cashInHand,
      count:          r.count,
      lastCollection: r.lastDate,
      incomeList:     donByPerson[name]  || [],
      expenseList:    expByPerson[name]  || [],
    };
  });

  const grandTotal = holders.reduce((s, h) => s + h.cashInHand, 0) + otherIncomeTotal;

  return ok({ year, holders, grandTotal, otherIncomeTotal });
}
// ── Pooja Schedule ────────────────────────────────────────

/**
 * Lunar phase calculation (IST-aware)
 * Reference new moon: 2025-01-29 12:36 UTC
 * Synodic month: 29.530588853 days
 */
const SYNODIC_MS      = 29.530588853 * 24 * 60 * 60 * 1000;
const REF_NEW_MOON_MS = new Date('2025-01-29T12:36:00Z').getTime();
const IST_OFFSET_MS   = 5.5 * 60 * 60 * 1000;

function lunarPhases(year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1)).getTime();
  const to   = new Date(Date.UTC(year, month,     1)).getTime();
  const amavasai = [], pournami = [];
  const startCycle = Math.floor((from - REF_NEW_MOON_MS) / SYNODIC_MS);

  for (let i = startCycle - 1; i <= startCycle + 3; i++) {
    // New moon (Amavasai)
    const nmIst = new Date(REF_NEW_MOON_MS + i * SYNODIC_MS + IST_OFFSET_MS);
    const nmDay = new Date(Date.UTC(nmIst.getUTCFullYear(), nmIst.getUTCMonth(), nmIst.getUTCDate()));
    if (nmDay.getTime() >= from && nmDay.getTime() < to) amavasai.push(nmDay);

    // Full moon (Pournami)
    const fmIst = new Date(REF_NEW_MOON_MS + (i + 0.5) * SYNODIC_MS + IST_OFFSET_MS);
    const fmDay = new Date(Date.UTC(fmIst.getUTCFullYear(), fmIst.getUTCMonth(), fmIst.getUTCDate()));
    if (fmDay.getTime() >= from && fmDay.getTime() < to) pournami.push(fmDay);
  }
  return { amavasai, pournami };
}

function weeklyPoojaDays(year, month) {
  // Tuesday=2, Friday=5, Sunday=0
  const TARGETS = new Set([0, 2, 5]);
  const days = [];
  const end  = new Date(Date.UTC(year, month, 1));
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (TARGETS.has(d.getUTCDay())) days.push(new Date(d));
  }
  return days;
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function isoDate(d) { return d.toISOString().split('T')[0]; }

async function getPoojaSchedule(p) {
  const year  = parseInt(p.year  || new Date().getFullYear());
  const month = parseInt(p.month || (new Date().getMonth() + 1));

  const { amavasai, pournami } = lunarPhases(year, month);
  const weekly = weeklyPoojaDays(year, month);

  // Build expected schedule
  const entries = [];
  for (const d of weekly) {
    entries.push({ date: d, poojaType: 'Weekly Pooja', dayLabel: DAY_NAMES[d.getUTCDay()] });
  }
  for (const d of amavasai) {
    entries.push({ date: d, poojaType: 'Amavasai Pooja', dayLabel: 'Amavasai' });
  }
  for (const d of pournami) {
    entries.push({ date: d, poojaType: 'Pournami Pooja', dayLabel: 'Pournami' });
  }
  entries.sort((a, b) => a.date - b.date);

  // Query all pooja donations for the month
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to   = new Date(Date.UTC(year, month,     1));
  const POOJA_TYPES = ['Weekly Pooja', 'Amavasai Pooja', 'Pournami Pooja',
                       'Birthday Pooja', 'Anniversary Pooja'];

  const donations = await Donation.find({
    donType: { $in: POOJA_TYPES },
    $or: [
      { poojaDate: { $gte: from, $lt: to } },
      { date:      { $gte: from, $lt: to }, poojaDate: { $in: [null, ''] } },
    ],
  }).lean();

  // Match donations to scheduled slots (Weekly / Amavasai / Pournami)
  const matchedDonationIds = new Set();
  const schedule = entries.map(entry => {
    const entryIso = isoDate(entry.date);
    const match = donations.find(d => {
      const effDate = d.poojaDate ? isoDate(new Date(d.poojaDate)) : isoDate(new Date(d.date));
      return effDate === entryIso && d.donType === entry.poojaType;
    });
    if (match) matchedDonationIds.add(match._id.toString());

    let status = 'unfunded';
    if (match) {
      if (!match.isTempleFunded) {
        status = 'donor_funded';
      } else if (match.approvalStatus === 'pending') {
        status = 'pending_approval';
      } else if (match.approvalStatus === 'rejected') {
        status = 'unfunded';   // treat rejected as unfunded so it can be re-filled
      } else {
        status = 'temple_funded';
      }
    }

    return {
      date:           entryIso,
      dayLabel:       entry.dayLabel,
      poojaType:      entry.poojaType,
      status,
      donorName:      match?.donor     || null,
      receiptNo:      match?.receiptNo || null,
      donationId:     match?._id?.toString() || null,
      variant:        match?.poojaVariant || null,
      approvalStatus: match?.approvalStatus || null,
    };
  });

  // Add Birthday / Anniversary / other special poojas as extra entries
  const EXTRA_TYPES = ['Birthday Pooja', 'Anniversary Pooja'];
  for (const d of donations) {
    if (!EXTRA_TYPES.includes(d.donType)) continue;
    if (matchedDonationIds.has(d._id.toString())) continue; // already matched

    const effDate = d.poojaDate ? isoDate(new Date(d.poojaDate)) : isoDate(new Date(d.date));
    let status = 'donor_funded';
    if (d.isTempleFunded) {
      status = d.approvalStatus === 'pending'  ? 'pending_approval'
             : d.approvalStatus === 'rejected' ? 'unfunded'
             : 'temple_funded';
    }
    const effDay = new Date(effDate + 'T00:00:00Z');
    schedule.push({
      date:           effDate,
      dayLabel:       DAY_NAMES[effDay.getUTCDay()],
      poojaType:      d.donType,
      status,
      donorName:      d.donor     || null,
      receiptNo:      d.receiptNo || null,
      donationId:     d._id.toString(),
      variant:        d.poojaVariant || null,
      approvalStatus: d.approvalStatus || null,
    });
  }

  // Sort the full schedule by date
  schedule.sort((a, b) => a.date.localeCompare(b.date));

  const counts = {
    total:           schedule.length,
    donorFunded:     schedule.filter(s => s.status === 'donor_funded').length,
    templeFunded:    schedule.filter(s => s.status === 'temple_funded').length,
    pendingApproval: schedule.filter(s => s.status === 'pending_approval').length,
    unfunded:        schedule.filter(s => s.status === 'unfunded').length,
  };

  return ok({ year, month, schedule, counts });
}

async function autoFillSchedule(p) {
  const year    = parseInt(p.year  || new Date().getFullYear());
  const month   = parseInt(p.month || (new Date().getMonth() + 1));
  const variant = (p.variant === 'Special') ? 'Special' : 'Regular';

  const sched    = await getPoojaSchedule({ year: String(year), month: String(month) });
  // Only auto-fill slots that are today or in the past (not future poojas)
  const todayIso = isoDate(new Date());
  const unfunded = sched.schedule.filter(s => s.status === 'unfunded' && s.date <= todayIso);

  if (unfunded.length === 0) return ok({ created: 0, message: 'All poojas already covered' });

  const cfg        = await AppConfig.get();
  const variantKey = variant === 'Special' ? 'special' : 'regular';
  const breakdown  = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost  = breakdown.reduce((s, l) => s + (l.amount || 0), 0);

  const created = [];
  for (const entry of unfunded) {
    const poojaDateObj = new Date(entry.date + 'T00:00:00Z');
    const seq      = await AppConfig.nextSeq('donation');
    const receiptNo = `${RCP_YEAR}/TF/${seq}`;

    // Create Donation record as PENDING APPROVAL — no Expense/VendorTxns yet
    const donDoc = {
      receiptNo,
      date:           poojaDateObj,
      poojaDate:      poojaDateObj,
      donor:          'Temple Fund',
      phone:          '',
      amount:         totalCost,
      received:       0,           // not counted until approved
      balance:        totalCost,
      mode:           '',
      status:         'Pending',
      isPending:      true,
      donType:        entry.poojaType,
      poojaType:      entry.poojaType,
      poojaVariant:   variant,
      isTempleFunded: true,
      approvalStatus: 'pending',   // ← awaiting admin approval
      notes:          `${entry.dayLabel} — Pending approval (${variant})`,
      receivedBy:     p.recordedBy || 'Auto',
      year,
    };

    await Donation.findOneAndUpdate(
      { receiptNo },
      { $set: donDoc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    created.push({ date: entry.date, poojaType: entry.poojaType, receiptNo });
  }

  return ok({ created: created.length, details: created });
}

/**
 * approvePooja — admin approves a pending temple-funded pooja
 * Creates Expense + VendorTransactions + Transaction debit
 */
async function approvePooja(p) {
  if (!p.id && !p.receiptNo) return err('id or receiptNo required');
  if (!p.approvedBy)         return err('approvedBy required');

  const query = p.id ? { _id: p.id } : { receiptNo: p.receiptNo };
  const don   = await Donation.findOne(query).lean();
  if (!don)                           return err('Donation not found');
  if (!don.isTempleFunded)            return err('Not a temple-funded pooja');
  if (don.approvalStatus === 'approved') return err('Already approved');
  if (don.approvalStatus === 'rejected') return err('Rejected — cannot approve');

  const poojaDateObj = don.poojaDate || don.date;
  const variant      = don.poojaVariant || 'Regular';
  const variantKey   = variant === 'Special' ? 'special' : 'regular';
  const cfg          = await AppConfig.get();
  const breakdown    = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost    = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const dayLabel     = don.notes?.split(' — ')[0] || '';
  const label        = `${don.poojaType} (${variant}) — Temple Fund | ${dayLabel}`;
  const year         = new Date(poojaDateObj).getFullYear();

  // ── 1. Expense record ────────────────────────────────────
  const expSeq    = await AppConfig.nextSeq('expense');
  const voucherNo = `${RCP_YEAR}/EXP/${expSeq}`;

  await Expense.create({
    voucherNo,
    date:        poojaDateObj,
    vendor:      'Temple Fund',
    description: label,
    category:    'Puja & Rituals',
    expType:     'Temple Operations',
    amount:      totalCost,
    mode:        'Cash',
    paidBy:      p.approvedBy,
    remarks:     `Approved by ${p.approvedBy} — ${don.receiptNo}`,
    year,
  });

  // ── 2. VendorTransaction credits ─────────────────────────
  if (breakdown.length) {
    const vtxns = breakdown.map(line => ({
      vendorName:  line.vendorName,
      vendorId:    line.vendorId || null,
      date:        poojaDateObj,
      description: label,
      item:        line.item || '',
      credit:      line.amount || 0,
      debit:       0,
      refType:     'pooja',
      refId:       voucherNo,
      poojaName:   don.poojaType,
      variant,
      isSettled:   false,
    }));
    await VendorTransaction.insertMany(vtxns);
  }

  // ── 3. General ledger debit ───────────────────────────────
  try {
    const txnSeq = await AppConfig.nextSeq('txn');
    await Transaction.create({
      txnNo:       `${RCP_YEAR}/TXN/${txnSeq}`,
      date:        poojaDateObj,
      type:        'debit',
      category:    'Expense',
      amount:      totalCost,
      description: label,
      party:       'Temple Fund',
      mode:        'Cash',
      refType:     'expense',
      refId:       voucherNo,
      recordedBy:  p.approvedBy,
      year,
    });
  } catch (e) { console.error('Ledger debit error (non-fatal):', e.message); }

  // ── 4. Mark Donation as approved ─────────────────────────
  await Donation.findOneAndUpdate(query, {
    $set: {
      approvalStatus: 'approved',
      approvedBy:     p.approvedBy,
      approvedAt:     new Date(),
      status:         'Received',
      isPending:      false,
      received:       totalCost,
      balance:        0,
      mode:           'Cash',
      notes:          `${dayLabel} — Approved by ${p.approvedBy} (${variant})`,
    },
  });

  return ok({ receiptNo: don.receiptNo, voucherNo, vendorTxns: breakdown.length });
}

async function rejectPooja(p) {
  if (!p.id && !p.receiptNo) return err('id or receiptNo required');
  const query = p.id ? { _id: p.id } : { receiptNo: p.receiptNo };
  const don   = await Donation.findOne(query).lean();
  if (!don)                              return err('Donation not found');
  if (!don.isTempleFunded)               return err('Not a temple-funded pooja');
  if (don.approvalStatus !== 'pending')  return err('Not in pending state');

  await Donation.findOneAndUpdate(query, {
    $set: {
      approvalStatus: 'rejected',
      rejectedReason: p.reason || '',
      status:         'Pending',
    },
  });

  return ok({ receiptNo: don.receiptNo });
}

// ── Users ─────────────────────────────────────────────────

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

/**
 * fixVendorTxnDates — one-time repair
 * For each pooja VendorTransaction linked to a donation receipt (refId = YYYY/D/NNN),
 * update the transaction date to the donation's poojaDate if it differs.
 */
async function fixVendorTxnDates() {
  const txns = await VendorTransaction.find({ refType: 'pooja', refId: /\/D\// }).lean();
  let updated = 0;
  const seen  = new Set();
  for (const txn of txns) {
    if (seen.has(txn.refId)) continue;
    seen.add(txn.refId);
    const don = await Donation.findOne({ receiptNo: txn.refId }).lean();
    if (!don?.poojaDate) continue;
    const poojaDateISO = don.poojaDate.toISOString().split('T')[0];
    const txnDateISO   = txn.date.toISOString().split('T')[0];
    if (poojaDateISO === txnDateISO) continue;
    await VendorTransaction.updateMany(
      { refId: txn.refId, refType: 'pooja' },
      { $set: { date: don.poojaDate } }
    );
    updated++;
  }
  return ok({ checked: seen.size, updated, message: `Updated ${updated} group(s)` });
}

module.exports = router;
