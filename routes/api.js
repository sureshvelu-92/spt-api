const router            = require('express').Router();
const Donation          = require('../models/Donation');
const Expense           = require('../models/Expense');
const InKind            = require('../models/InKind');
const AppConfig         = require('../models/AppConfig');
const Vendor            = require('../models/Vendor');
const VendorTransaction = require('../models/VendorTransaction');
const Transaction       = require('../models/Transaction');

const TOKEN = process.env.API_TOKEN || 'SPTT@1985';
const RCP_YEAR = '2026';

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

      case 'getLedger':         return res.json(await getLedger(p));
      case 'addTransaction':    return res.json(await addManualTransaction(p));

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

  await Donation.create({
    receiptNo, date: donDate,
    donor: p.donor || '', phone: p.phone || '',
    amount, received, balance,
    mode: isPend ? '' : (p.mode || 'Cash'),
    receivedBy: p.receivedBy || '',
    notes: p.notes || p.purpose || '',
    status, isPending: isPend,
    donType: p.donType || 'Aadi Festival',
    personName: p.personName || '',
    poojaType:    p.poojaType    || '',
    poojaVariant: p.poojaVariant || '',
  });

  // ── General Ledger: credit entry when money is actually received ──
  if (received > 0) {
    try {
      const txnSeq = await AppConfig.nextSeq('txn');
      const txnNo  = `${RCP_YEAR}/TXN/${txnSeq}`;
      const isPooja = (p.donType || '') === 'Pooja';
      await Transaction.create({
        txnNo, date: donDate, type: 'credit',
        category: isPooja ? 'Pooja Income' : 'Donation',
        amount:   received,
        description: p.notes || p.purpose || (isPooja ? `${p.poojaType} (${p.poojaVariant})` : ''),
        party:    p.donor || '',
        mode:     isPend ? '' : (p.mode || 'Cash'),
        refType:  'donation', refId: receiptNo,
        recordedBy: p.receivedBy || '',
        year,
      });
    } catch (e) { console.error('Ledger credit error (non-fatal):', e.message); }
  }

  // ── Vendor Ledger: create credit entries from AppConfig breakdown ──
  if ((p.donType || '') === 'Pooja' && p.poojaType && p.poojaVariant) {
    try {
      const cfg        = await AppConfig.get();
      const variantKey = p.poojaVariant === 'Special' ? 'special' : 'regular';
      const breakdown  = cfg.poojaBreakdown?.[variantKey] || [];
      if (breakdown.length) {
        const description = `${p.poojaType} (${p.poojaVariant}) — ${receiptNo}`;
        const txns = breakdown.map(line => ({
          vendorName: line.vendorName,
          date:       donDate,
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
    mode: p.mode || 'Cash', paidBy: p.paidBy || '',
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
  const doc = await Donation.findOneAndUpdate(
    { receiptNo: p.receiptNo },
    {
      received: parseFloat(p.received) || 0,
      balance:  (parseFloat(p.amount) || 0) - (parseFloat(p.received) || 0),
      status:   p.status || 'Received',
      mode:     p.mode || 'Cash',
    },
    { new: true }
  );
  if (!doc) return err('Receipt not found: ' + p.receiptNo);
  return ok({ receiptNo: p.receiptNo });
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

  const from = new Date(year, month - 1, 1);
  const to   = new Date(year, month, 1);

  const [donAgg, expAgg, donRows, expRows] = await Promise.all([
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
    expenses: {
      totalSpent:  eSumRaw.totalSpent,
      count:       eSumRaw.count,
      byCategory:  expByCategory,
      byVendor:    expByVendor,
      rows:        expRows.map(mapExpense),
    },
    netBalance: dSumRaw.totalReceived - eSumRaw.totalSpent,
  });
}

// ── Yearly Report ─────────────────────────────────────────
// ?action=getYearlyReport&year=2026
async function getYearlyReport(p) {
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(year, 0, 1);
  const to   = new Date(year + 1, 0, 1);

  const [donMonthly, expMonthly, donByType, expByCat, expByVendor] = await Promise.all([
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
  ]);

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build 12-month grid
  const donMap = Object.fromEntries(donMonthly.map(r => [r._id, r]));
  const expMap = Object.fromEntries(expMonthly.map(r => [r._id, r]));
  const monthlyGrid = Array.from({ length: 12 }, (_, i) => {
    const m   = i + 1;
    const don = donMap[m] || { pledged: 0, received: 0, balance: 0, count: 0 };
    const exp = expMap[m] || { spent: 0, count: 0 };
    return {
      month:     MONTH_NAMES[m],
      monthNo:   m,
      pledged:   don.pledged,
      received:  don.received,
      balance:   don.balance,
      donCount:  don.count,
      spent:     exp.spent,
      expCount:  exp.count,
      net:       don.received - exp.spent,
    };
  });

  const totalReceived = monthlyGrid.reduce((s, r) => s + r.received, 0);
  const totalSpent    = monthlyGrid.reduce((s, r) => s + r.spent, 0);

  return ok({
    year,
    summary: {
      totalPledged:  monthlyGrid.reduce((s, r) => s + r.pledged, 0),
      totalReceived,
      totalBalance:  monthlyGrid.reduce((s, r) => s + r.balance, 0),
      totalSpent,
      netBalance:    totalReceived - totalSpent,
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
  const from = new Date(year, 0, 1);
  const to   = new Date(year + 1, 0, 1);

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

module.exports = router;
