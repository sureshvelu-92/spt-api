const router            = require('express').Router();
const Donation          = require('../models/Donation');
const Expense           = require('../models/Expense');
const InKind            = require('../models/InKind');
const AppConfig         = require('../models/AppConfig');
const Vendor            = require('../models/Vendor');
const VendorTransaction = require('../models/VendorTransaction');
const Transaction       = require('../models/Transaction');
const User              = require('../models/User');
const PoojaSchedule     = require('../models/PoojaSchedule');
const Budget            = require('../models/Budget');

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
      case 'getReceipts':     return res.json(await getReceipts(p));
      case 'getRecentDonations': return res.json(await getRecentDonations(p));
      case 'getInKindDonations': return res.json(await getInKind());
      case 'getExpenses':     return res.json(await getExpenses());
      case 'getLastSeq':      return res.json(await getLastSeq('donation'));
      case 'getLastInKindSeq': return res.json(await getLastSeq('inkind'));
      case 'getLastExpenseSeq': return res.json(await getLastSeq('expense'));
      case 'updateReceived':  return res.json(await updateReceived(p));
      case 'getAllData':       return res.json(await getAllData());
      case 'getMonthlyReport': return res.json(await getMonthlyReport(p));
      case 'getYearlyReport':  return res.json(await getYearlyReport(p));
      case 'getOverallReport': return res.json(await getOverallReport());

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
      case 'approvePooja':       return res.json(await approvePooja(p));
      case 'rejectPooja':        return res.json(await rejectPooja(p));
      case 'markTempleFunded':   return res.json(await markTempleFunded(p));
      case 'markPoojaComplete':  return res.json(await markPoojaComplete(p));

      case 'getUsers':          return res.json(await getUsers());
      case 'addUser':           return res.json(await addUser(p));
      case 'verifyPin':         return res.json(await verifyPin(p));
      case 'setPin':            return res.json(await setPin(p));

      case 'getBudget':         return res.json(await getBudget(p));
      case 'saveBudget':        return res.json(await saveBudget(p));
      case 'addBudgetItem':     return res.json(await addBudgetItem(p));
      case 'updateBudgetItem':  return res.json(await updateBudgetItem(p));
      case 'deleteBudgetItem':  return res.json(await deleteBudgetItem(p));

      // ── One-time repair: fix VendorTransaction dates to use poojaDate ──
      case 'fixVendorTxnDates': return res.json(await fixVendorTxnDates());

      case 'setPoojaDate':       return res.json(await setPoojaDate(p));
      case 'backfillPoojaDates': return res.json(await backfillPoojaDates());

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
    status,
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

  // NOTE: Vendor transactions are created later via markPoojaComplete ("Pooja Done" button)
  // They are NOT created at donation time.

  // ── Link / update PoojaSchedule slot ─────────────────────
  if (p.poojaType && p.poojaVariant) {
    try {
      const effDate = donationDoc.poojaDate || donDate;
      const utcDate = new Date(Date.UTC(
        effDate.getUTCFullYear(), effDate.getUTCMonth(), effDate.getUTCDate()
      ));
      // Multiple poojas can coexist on the same day (Weekly + Birthday + Amavasai etc.)
      // Unique key is (poojaDate + poojaType + personName) — allows two Birthdays for different people
      const personKey = p.personName || '';

      // Find existing slot for this exact pooja
      const existingSlot = await PoojaSchedule.findOne({
        poojaDate:  utcDate,
        poojaType:  p.poojaType,
        personName: personKey,
      });

      const donDoc = await Donation.findOne({ receiptNo });
      const slotData = {
        status:         'donor_funded',
        poojaVariant:   p.poojaVariant,
        personName:     personKey,
        donationId:     donDoc._id,
        receiptNo,
        isTempleFunded: false,
        approvalStatus: null,
      };

      let scheduleId;
      if (existingSlot) {
        await PoojaSchedule.updateOne({ _id: existingSlot._id }, { $set: slotData });
        scheduleId = existingSlot._id;
      } else {
        const dow = utcDate.getUTCDay();
        const dayType = dow === 2 ? 'Tuesday' : dow === 5 ? 'Friday' : dow === 0 ? 'Sunday' : 'Special';
        const newSlot = await PoojaSchedule.findOneAndUpdate(
          { poojaDate: utcDate, poojaType: p.poojaType, personName: personKey },
          { $set: {
            poojaDate: utcDate,
            year:  utcDate.getUTCFullYear(),
            month: utcDate.getUTCMonth() + 1,
            dayType,
            poojaType: p.poojaType,
            ...slotData,
          }},
          { upsert: true, new: true }
        );
        scheduleId = newSlot._id;
      }
      // Backlink scheduleId on donation
      await Donation.updateOne({ receiptNo }, { $set: { poojaScheduleId: scheduleId } });
    } catch (e) {
      console.error('PoojaSchedule link error (non-fatal):', e.message);
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

async function getReceipts(p = {}) {
  const limit = parseInt(p.limit) || 0;
  const page  = parseInt(p.page)  || 1;
  const skip  = limit ? (page - 1) * limit : 0;
  const q     = Donation.find().sort({ date: -1 });
  if (limit) q.skip(skip).limit(limit);
  const [rows, total] = await Promise.all([
    q.lean(),
    limit ? Donation.countDocuments() : Promise.resolve(0),
  ]);
  return ok({ data: rows.map(mapDonation), total: total || rows.length, page, limit });
}

async function getRecentDonations(p = {}) {
  const limit = parseInt(p.limit) || 5;
  const rows  = await Donation.find().sort({ date: -1 }).limit(limit).lean();
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

// ── Overall (all-time) Report ─────────────────────────────
// ?action=getOverallReport
async function getOverallReport() {
  const [donAgg, expAgg, donByType, expByCat, topVendors, byYear, otherInc, pendingDon] = await Promise.all([
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
    // All-time other income
    Transaction.aggregate([
      { $match: { type: 'credit', refType: { $in: ['manual'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // Pending donations count + amount
    Donation.aggregate([
      { $match: { status: { $in: ['Pending', 'Partially Received'] } } },
      { $group: { _id: null, totalPending: { $sum: '$balance' }, count: { $sum: 1 } } },
    ]),
  ]);

  const d          = donAgg[0]  || { totalPledged: 0, totalReceived: 0, totalBalance: 0, count: 0 };
  const e          = expAgg[0]  || { totalSpent: 0, count: 0 };
  const otherTotal = otherInc[0]?.total ?? 0;
  const pending    = pendingDon[0] || { totalPending: 0, count: 0 };
  const totalIncome = d.totalReceived + otherTotal;

  return ok({
    summary: {
      totalPledged:    d.totalPledged,
      totalReceived:   d.totalReceived,
      totalOtherIncome: otherTotal,
      totalIncome,
      totalBalance:    d.totalBalance,
      totalSpent:      e.totalSpent,
      netBalance:      totalIncome - e.totalSpent,
      donCount:        d.count,
      expCount:        e.count,
      pendingAmount:   pending.totalPending,
      pendingCount:    pending.count,
    },
    byYear: byYear.map(r => ({ year: r._id, received: r.received, count: r.count })),
    donByType:    donByType.map(r => ({ type: r._id || 'Others', total: r.total, count: r.count })),
    expByCategory: expByCat.map(r => ({ category: r._id || 'Misc', total: r.total, count: r.count })),
    topVendors:   topVendors.map(r => ({ vendor: r._id || 'Unknown', total: r.total, count: r.count })),
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
    isPending:      d.status !== 'Received',   // computed from status — not stored
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

  // 1. All donations collected per person
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

  // 2. Individual donation rows per person
  const donationRows = await Donation.find({
    date:       { $gte: from, $lt: to },
    received:   { $gt: 0 },
    receivedBy: { $nin: [null, ''] },
  }).sort({ date: 1 }).lean();

  // 3. FIXED: Other income transactions aggregation (Separate objects for $match and $group)
  const otherIncomeGrouped = await Transaction.aggregate([
    {
      $match: {
        date:     { $gte: from, $lt: to },
        type:     'credit',
        category: { $nin: ['Donation', 'Pooja Income'] },
        recordedBy: { $nin: [null, ''] }
      }
    },
    {
      $group: {
        _id:      '$recordedBy',
        total:    { $sum: '$amount' },
        count:    { $sum: 1 },
        lastDate: { $max: '$date' }
      }
    }
  ]);

  // FIXED: Fetch raw rows for individual listing maps
  const otherIncomeRows = await Transaction.find({
    date:     { $gte: from, $lt: to },
    type:     'credit',
    category: { $nin: ['Donation', 'Pooja Income'] },
    recordedBy: { $nin: [null, ''] }
  }).sort({ date: 1 }).lean();

  // Calculate other income total dynamically from rows safely
  const otherIncomeTotal = otherIncomeRows.reduce((sum, t) => sum + (t.amount || 0), 0);

  // 4. Expenses paid out per person
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

  // Individual expense rows per person
  const expenseRows = await Expense.find({
    date:   { $gte: from, $lt: to },
    paidBy: { $nin: [null, ''] },
  }).sort({ date: 1 }).lean();

  // Group donation rows by person name
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

  // --- FIXED: INJECT OTHER INCOME INTO THE ASSIGNED PERSON'S LIST MAP ---
  for (const t of otherIncomeRows) {
    const n = t.recordedBy;
    if (!donByPerson[n]) donByPerson[n] = [];
    donByPerson[n].push({
      date:      fmtDate(t.date),
      donor:     `[${t.category || 'Other Income'}] ${t.party || t.description || ''}`,
      amount:    t.amount,
      mode:      t.mode || 'N/A',
      receiptNo: t.txnNo || t._id.toString(),
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

  const otherIncomeMap = Object.fromEntries(otherIncomeGrouped.map(g => [g._id, g]));
  const remitMap       = Object.fromEntries(remitted.map(r => [r._id, r.totalRemitted]));

  // Find all unique names across donations, other incomes, and expenses to avoid omitting anyone
  const allNames = new Set([
    ...collected.map(r => r._id),
    ...otherIncomeGrouped.map(g => g._id),
    ...remitted.map(e => e._id)
  ].filter(name => name !== null && name !== ''));

  // Build the complete combined holders list
  const holders = Array.from(allNames).map(name => {
    const donStats = collected.find(r => r._id === name);
    const incStats = otherIncomeMap[name];

    const totalDonation    = donStats ? donStats.total : 0;
    const totalOtherIncome = incStats ? incStats.total : 0;

    const totalCollected = totalDonation + totalOtherIncome;
    const totalRemitted  = remitMap[name] || 0;
    const cashInHand     = totalCollected - totalRemitted;

    const count = (donStats?.count || 0) + (incStats?.count || 0);
    const lastCollection = (donStats?.lastDate > incStats?.lastDate) 
      ? donStats.lastDate 
      : (incStats?.lastDate || donStats?.lastDate || null);

    return {
      name,
      userId:         donStats?.userId || null,
      totalCollected,
      totalRemitted,
      cashInHand,
      count,
      lastCollection,
      incomeList:     donByPerson[name]  || [],
      expenseList:    expByPerson[name]  || [],
    };
  }).sort((a, b) => b.totalCollected - a.totalCollected);

  const grandTotal = holders.reduce((s, h) => s + h.cashInHand, 0);

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

/**
 * getPoojaSchedule — reads from PoojaSchedule collection (populated by migration).
 * Falls back to computing from lunar/weekly helpers if no DB rows exist for that month.
 */
async function getPoojaSchedule(p) {
  const year  = parseInt(p.year  || new Date().getFullYear());
  const month = parseInt(p.month || (new Date().getMonth() + 1));

  // ── Try reading from PoojaSchedule collection first ──────
  let dbRows = await PoojaSchedule.find({ year, month })
    .sort({ poojaDate: 1 })
    .lean();

  // ── If no rows exist, generate on-the-fly and upsert ─────
  if (!dbRows.length) {
    const { amavasai, pournami } = lunarPhases(year, month);
    const weekly = weeklyPoojaDays(year, month);

    // Days that already have Amavasai/Pournami — weekly pooja not needed on those days
    const specialDates = new Set([
      ...amavasai.map(isoDate),
      ...pournami.map(isoDate),
    ]);

    // Also check for existing Birthday/Anniversary slots on weekly days
    const existingSpecial = await PoojaSchedule.find({
      year, month,
      poojaType: { $in: ['Birthday Pooja', 'Anniversary Pooja'] },
    }).select('poojaDate').lean();
    for (const r of existingSpecial) specialDates.add(isoDate(new Date(r.poojaDate)));

    const slots = [];
    for (const d of weekly) {
      if (specialDates.has(isoDate(d))) continue; // special pooja takes priority
      const dow = d.getUTCDay();
      slots.push({ poojaDate: d, year, month,
        dayType: dow === 2 ? 'Tuesday' : dow === 5 ? 'Friday' : 'Sunday',
        poojaType: 'Weekly Pooja' });
    }
    for (const d of amavasai) {
      slots.push({ poojaDate: d, year, month, dayType: 'Amavasai', poojaType: 'Amavasai Pooja' });
    }
    for (const d of pournami) {
      slots.push({ poojaDate: d, year, month, dayType: 'Pournami', poojaType: 'Pournami Pooja' });
    }

    for (const slot of slots) {
      await PoojaSchedule.findOneAndUpdate(
        { poojaDate: slot.poojaDate, poojaType: slot.poojaType },
        { $setOnInsert: { ...slot, status: 'unfunded' } },
        { upsert: true, new: true }
      );
    }

    // Remove any Weekly Pooja slots that clash with special poojas
    if (specialDates.size > 0) {
      const specialDateObjs = [...specialDates].map(s => new Date(s + 'T00:00:00Z'));
      await PoojaSchedule.deleteMany({
        year, month,
        poojaType: 'Weekly Pooja',
        poojaDate: { $in: specialDateObjs },
        status: 'unfunded',  // only remove if no donor/temple linked
      });
    }

    dbRows = await PoojaSchedule.find({ year, month }).sort({ poojaDate: 1 }).lean();
  } else {
    // DB rows already exist — still enforce: no Weekly Pooja on days that have a
    // Birthday/Anniversary/Amavasai/Pournami slot (handles data that pre-dates this rule).
    const SUPERSEDES = new Set(['Birthday Pooja','Anniversary Pooja','Amavasai Pooja','Pournami Pooja']);
    const supersedingDates = new Set(
      dbRows.filter(r => SUPERSEDES.has(r.poojaType)).map(r => isoDate(new Date(r.poojaDate)))
    );
    if (supersedingDates.size > 0) {
      const dateObjs = [...supersedingDates].map(s => new Date(s + 'T00:00:00Z'));
      await PoojaSchedule.deleteMany({
        year, month,
        poojaType: 'Weekly Pooja',
        poojaDate: { $in: dateObjs },
        status:    'unfunded',
      });
      // Remove from in-memory rows so the caller sees the cleaned list
      dbRows = dbRows.filter(r =>
        !(r.poojaType === 'Weekly Pooja' && supersedingDates.has(isoDate(new Date(r.poojaDate))))
      );
    }
  }

  // ── Enrich with vendor transaction presence ───────────────
  const receiptNos = dbRows.filter(r => r.receiptNo).map(r => r.receiptNo);
  const vtxnRefs   = receiptNos.length
    ? await VendorTransaction.distinct('refId', { refId: { $in: receiptNos }, refType: 'pooja' })
    : [];
  const vtxnSet = new Set(vtxnRefs);

  // ── Also enrich with donor name from Donation ────────────
  const donIds = dbRows.filter(r => r.donationId).map(r => r.donationId);
  const donors = donIds.length
    ? await Donation.find({ _id: { $in: donIds } }, 'donor').lean()
    : [];
  const donorMap = Object.fromEntries(donors.map(d => [d._id.toString(), d.donor]));

  const schedule = dbRows.map(row => {
    const dateIso   = isoDate(new Date(row.poojaDate));
    const donorName = row.donationId ? (donorMap[row.donationId.toString()] || null) : null;
    return {
      _id:            row._id.toString(),
      date:           dateIso,
      dayLabel:       row.dayType,
      poojaType:      row.poojaType,
      poojaVariant:   row.poojaVariant || null,
      personName:     row.personName   || null,
      status:         row.status,
      donorName,
      receiptNo:      row.receiptNo    || null,
      donationId:     row.donationId?.toString() || null,
      approvalStatus: row.approvalStatus || null,
      hasVendorTxn:   row.receiptNo ? vtxnSet.has(row.receiptNo)
                    : row.expenseVoucherNo ? vtxnSet.has(row.expenseVoucherNo)
                    : false,
    };
  });

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
  const todayIso = isoDate(new Date());

  // Get unfunded slots from PoojaSchedule that are today or past
  const unfundedSlots = await PoojaSchedule.find({
    year, month,
    status:   'unfunded',
    poojaDate: { $lte: new Date(todayIso + 'T23:59:59Z') },
  }).lean();

  if (!unfundedSlots.length) return ok({ created: 0, message: 'All past/today poojas covered' });

  const cfg        = await AppConfig.get();
  const variantKey = variant === 'Special' ? 'special' : 'regular';
  const breakdown  = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost  = breakdown.reduce((s, l) => s + (l.amount || 0), 0);

  const created = [];
  for (const slot of unfundedSlots) {
    const poojaDateObj = new Date(slot.poojaDate);
    const seq          = await AppConfig.nextSeq('donation');
    const receiptNo    = `${RCP_YEAR}/TF/${seq}`;

    // 1. Create minimal Donation (financial placeholder, pending approval)
    const don = await Donation.findOneAndUpdate(
      { receiptNo },
      { $set: {
        receiptNo,
        date:           poojaDateObj,
        poojaDate:      poojaDateObj,
        donor:          'Temple Fund',
        amount:         totalCost,
        received:       0,
        balance:        totalCost,
        mode:           '',
        status:         'Pending',
        donType:        slot.poojaType,
        poojaType:      slot.poojaType,
        poojaVariant:   variant,
        isTempleFunded: true,
        approvalStatus: 'pending',
        notes:          `${slot.dayType} — Pending approval (${variant})`,
        receivedBy:     p.recordedBy || 'Auto',
        year,
        poojaScheduleId: slot._id,
      }},
      { upsert: true, new: true }
    );

    // 2. Update PoojaSchedule slot
    await PoojaSchedule.updateOne(
      { _id: slot._id },
      { $set: {
        status:         'pending_approval',
        approvalStatus: 'pending',
        poojaVariant:   variant,
        donationId:     don._id,
        receiptNo,
        isTempleFunded: true,
      }}
    );

    created.push({ date: isoDate(poojaDateObj), poojaType: slot.poojaType, receiptNo });
  }

  return ok({ created: created.length, details: created });
}

/**
 * approvePooja — admin approves a pending temple-funded pooja
 * Looks up PoojaSchedule by id or via Donation, creates Expense + VendorTransactions
 */
async function approvePooja(p) {
  if (!p.id && !p.receiptNo && !p.scheduleId) return err('id, receiptNo or scheduleId required');
  if (!p.approvedBy) return err('approvedBy required');

  // Find the schedule slot
  let slot;
  if (p.scheduleId) {
    slot = await PoojaSchedule.findById(p.scheduleId).lean();
  } else {
    // Find via donation
    const donQuery = p.id ? { _id: p.id } : { receiptNo: p.receiptNo };
    const don = await Donation.findOne(donQuery).lean();
    if (!don) return err('Donation not found');
    slot = don.poojaScheduleId
      ? await PoojaSchedule.findById(don.poojaScheduleId).lean()
      : await PoojaSchedule.findOne({ receiptNo: don.receiptNo }).lean();
  }

  if (!slot)                               return err('PoojaSchedule slot not found');
  if (slot.status === 'donor_funded')      return err('Donor-funded — no approval needed');
  if (slot.status === 'temple_funded')     return err('Already approved');
  if (slot.approvalStatus !== 'pending')   return err('Not in pending state');

  const poojaDateObj = new Date(slot.poojaDate);
  const variant      = slot.poojaVariant || 'Regular';
  const variantKey   = variant === 'Special' ? 'special' : 'regular';
  const cfg          = await AppConfig.get();
  const breakdown    = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost    = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const label        = `${slot.poojaType} (${variant}) — Temple Fund | ${slot.dayType}`;
  const year         = poojaDateObj.getFullYear();

  // ── 1. Expense record ─────────────────────────────────────
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
    remarks:     `Approved by ${p.approvedBy} — ${slot.receiptNo}`,
    year,
  });

  // ── 2. VendorTransaction credits ──────────────────────────
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
      poojaName:   slot.poojaType,
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

  // ── 4. Update PoojaSchedule slot ─────────────────────────
  await PoojaSchedule.updateOne(
    { _id: slot._id },
    { $set: {
      status:           'temple_funded',
      approvalStatus:   'approved',
      approvedBy:       p.approvedBy,
      approvedAt:       new Date(),
      expenseVoucherNo: voucherNo,
    }}
  );

  // ── 5. Update linked Donation ─────────────────────────────
  if (slot.donationId) {
    await Donation.updateOne(
      { _id: slot.donationId },
      { $set: {
        approvalStatus: 'approved',
        approvedBy:     p.approvedBy,
        approvedAt:     new Date(),
        status:         'Received',
        received:       totalCost,
        balance:        0,
        mode:           'Cash',
      }}
    );
  }

  return ok({ receiptNo: slot.receiptNo, voucherNo, vendorTxns: breakdown.length });
}

async function rejectPooja(p) {
  if (!p.id && !p.receiptNo && !p.scheduleId) return err('id, receiptNo or scheduleId required');

  let slot;
  if (p.scheduleId) {
    slot = await PoojaSchedule.findById(p.scheduleId).lean();
  } else {
    const donQuery = p.id ? { _id: p.id } : { receiptNo: p.receiptNo };
    const don = await Donation.findOne(donQuery).lean();
    if (!don) return err('Donation not found');
    slot = don.poojaScheduleId
      ? await PoojaSchedule.findById(don.poojaScheduleId).lean()
      : await PoojaSchedule.findOne({ receiptNo: don.receiptNo }).lean();
  }

  if (!slot)                             return err('PoojaSchedule slot not found');
  if (slot.approvalStatus !== 'pending') return err('Not in pending state');

  // Update PoojaSchedule
  await PoojaSchedule.updateOne(
    { _id: slot._id },
    { $set: {
      status:         'unfunded',   // treat as unfunded so it can be re-filled
      approvalStatus: 'rejected',
      rejectedReason: p.reason || '',
    }}
  );

  // Update linked Donation
  if (slot.donationId) {
    await Donation.updateOne(
      { _id: slot.donationId },
      { $set: { approvalStatus: 'rejected', rejectedReason: p.reason || '' } }
    );
  }

  return ok({ receiptNo: slot.receiptNo, scheduleId: slot._id.toString() });
}

/**
 * markTempleFunded — mark an unfunded PoojaSchedule slot as temple-funded.
 * No donor required. Creates Expense + VendorTransaction entries immediately.
 *
 * Params: scheduleId, approvedBy, variant (optional, overrides slot variant)
 */
async function markTempleFunded(p) {
  if (!p.scheduleId) return err('scheduleId required');
  if (!p.approvedBy) return err('approvedBy required');

  const slot = await PoojaSchedule.findById(p.scheduleId).lean();
  if (!slot) return err('PoojaSchedule slot not found');
  if (slot.status === 'temple_funded')  return err('Already temple-funded');
  if (slot.status === 'donor_funded')   return err('Slot has a donor — use approvePooja instead');

  const poojaDateObj = new Date(slot.poojaDate);
  const variant      = p.variant || slot.poojaVariant || 'Regular';
  const variantKey   = variant === 'Special' ? 'special' : 'regular';
  const cfg          = await AppConfig.get();
  const breakdown    = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost    = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const label        = `${slot.poojaType} (${variant}) — Temple Fund | ${slot.dayType}`;
  const year         = poojaDateObj.getFullYear();

  // 1. Expense record
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
    year,
  });

  // 2. VendorTransaction credits
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
      poojaName:   slot.poojaType,
      variant,
      isSettled:   false,
    }));
    await VendorTransaction.insertMany(vtxns);
  }

  // 3. General ledger debit
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

  // 4. Update PoojaSchedule slot
  await PoojaSchedule.updateOne(
    { _id: slot._id },
    { $set: {
      status:           'temple_funded',
      isTempleFunded:   true,
      approvalStatus:   'approved',
      approvedBy:       p.approvedBy,
      approvedAt:       new Date(),
      poojaVariant:     variant,
      expenseVoucherNo: voucherNo,
    }}
  );

  return ok({ voucherNo, vendorTxns: breakdown.length, totalCost });
}

// ── Mark Pooja Complete (Pooja Done button) ───────────────
// Creates vendor transactions + expense when pooja is actually performed.
// If slot is unfunded → captures as temple-funded first.
// If slot is donor_funded → creates vendor txns against the receipt.
async function markPoojaComplete(p) {
  if (!p.scheduleId) return err('scheduleId required');
  if (!p.doneBy)     return err('doneBy required');

  const slot = await PoojaSchedule.findById(p.scheduleId).lean();
  if (!slot)                    return err('PoojaSchedule slot not found');
  if (slot.hasVendorTxn)        return err('Pooja already marked as done');
  if (slot.status === 'rejected') return err('Rejected slots cannot be completed');

  const poojaDateObj = new Date(slot.poojaDate);
  const variant      = p.variant || slot.poojaVariant || 'Regular';
  const variantKey   = variant === 'Special' ? 'special' : 'regular';
  const cfg          = await AppConfig.get();
  const breakdown    = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost    = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const year         = poojaDateObj.getFullYear();
  const personSuffix = slot.personName ? ` | ${slot.personName}` : '';

  let refId       = slot.receiptNo || '';
  let voucherNo   = '';
  const isTemple  = slot.status === 'unfunded' || slot.status === 'pending_approval' || slot.status === 'temple_funded';

  // If unfunded → promote to temple_funded
  if (slot.status === 'unfunded') {
    const expSeq = await AppConfig.nextSeq('expense');
    voucherNo    = `${RCP_YEAR}/EXP/${expSeq}`;
    const label  = `${slot.poojaType} (${variant}) — Temple Fund | ${slot.dayType}${personSuffix}`;

    await Expense.create({
      voucherNo,
      date:        poojaDateObj,
      vendor:      'Temple Fund',
      description: label,
      category:    'Puja & Rituals',
      expType:     'Temple Operations',
      amount:      totalCost,
      mode:        'Cash',
      paidBy:      p.doneBy,
      year,
    });

    try {
      const txnSeq = await AppConfig.nextSeq('txn');
      await Transaction.create({
        txnNo: `${RCP_YEAR}/TXN/${txnSeq}`, date: poojaDateObj,
        type: 'debit', category: 'Expense', amount: totalCost,
        description: label, party: 'Temple Fund', mode: 'Cash',
        refType: 'expense', refId: voucherNo, recordedBy: p.doneBy, year,
      });
    } catch (e) { console.error('Ledger debit error (non-fatal):', e.message); }

    await PoojaSchedule.updateOne({ _id: slot._id }, { $set: {
      status: 'temple_funded', isTempleFunded: true,
      approvalStatus: 'approved', approvedBy: p.doneBy, approvedAt: new Date(),
      poojaVariant: variant, expenseVoucherNo: voucherNo,
    }});
    refId = voucherNo;

  } else if (slot.status === 'pending_approval' || slot.status === 'temple_funded') {
    // Use or create expense voucherNo
    if (slot.expenseVoucherNo) {
      voucherNo = slot.expenseVoucherNo;
    } else {
      const expSeq = await AppConfig.nextSeq('expense');
      voucherNo    = `${RCP_YEAR}/EXP/${expSeq}`;
      const label  = `${slot.poojaType} (${variant}) — Temple Fund | ${slot.dayType}${personSuffix}`;
      await Expense.create({
        voucherNo, date: poojaDateObj, vendor: 'Temple Fund',
        description: label, category: 'Puja & Rituals', expType: 'Temple Operations',
        amount: totalCost, mode: 'Cash', paidBy: p.doneBy, year,
      });
      await PoojaSchedule.updateOne({ _id: slot._id }, { $set: {
        status: 'temple_funded', approvalStatus: 'approved',
        approvedBy: p.doneBy, approvedAt: new Date(), expenseVoucherNo: voucherNo,
      }});
    }
    refId = voucherNo;
  }

  // Create vendor transactions (for all statuses)
  let vendorTxns = 0;
  if (breakdown.length) {
    const label = `${slot.poojaType} (${variant}) — ${isTemple ? 'Temple Fund' : slot.receiptNo}${personSuffix}`;
    const vtxns = breakdown.map(line => ({
      vendorName:  line.vendorName,
      vendorId:    line.vendorId || null,
      date:        poojaDateObj,
      description: label,
      item:        line.item || '',
      credit:      line.amount || 0,
      debit:       0,
      refType:     'pooja',
      refId,
      poojaName:   slot.poojaType,
      variant,
      isSettled:   false,
    }));
    await VendorTransaction.insertMany(vtxns);
    vendorTxns = vtxns.length;
  }

  // Mark slot as having vendor txns
  await PoojaSchedule.updateOne({ _id: slot._id }, { $set: {
    hasVendorTxn: true,
    poojaVariant: variant,
  }});

  return ok({ vendorTxns, totalCost, refId });
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
 * backfillPoojaDates — migration script
 *
 * For every pooja/anniversary donation that has poojaDate = null,
 * set poojaDate = date (the donation entry date, i.e. the date the pooja was done).
 * Also syncs the date on any linked VendorTransactions (refId = receiptNo).
 *
 * Safe to run multiple times (idempotent — only touches null records).
 *
 * Call: GET /?action=backfillPoojaDates&token=SPTT@1985
 */
async function backfillPoojaDates() {
  const POOJA_TYPES = [
    'Weekly Pooja', 'Amavasai Pooja', 'Pournami Pooja',
    'Birthday Pooja', 'Anniversary Pooja',
  ];

  // Find all pooja donations with no poojaDate set
  const donations = await Donation.find({
    donType:   { $in: POOJA_TYPES },
    poojaDate: { $in: [null, ''] },
  }).lean();

  if (!donations.length) {
    return ok({ updated: 0, message: 'No donations to backfill' });
  }

  let donUpdated = 0;
  let txnUpdated = 0;

  for (const don of donations) {
    const poojaDate = don.date;   // use the existing donation date
    if (!poojaDate) continue;

    // Update donation
    await Donation.updateOne({ _id: don._id }, { $set: { poojaDate } });
    donUpdated++;

    // Update linked VendorTransactions (if any)
    const result = await VendorTransaction.updateMany(
      { refId: don.receiptNo, refType: 'pooja' },
      { $set: { date: poojaDate } }
    );
    txnUpdated += result.modifiedCount;
  }

  return ok({
    donationsChecked: donations.length,
    donationsUpdated: donUpdated,
    vendorTxnsUpdated: txnUpdated,
    message: `Backfilled ${donUpdated} donation(s), updated ${txnUpdated} vendor transaction(s)`,
  });
}

/**
 * setPoojaDate — update poojaDate on a donation (by id or receiptNo)
 * Also updates any linked VendorTransactions to use the new poojaDate
 */
async function setPoojaDate(p) {
  if (!p.poojaDate)        return err('poojaDate required (YYYY-MM-DD)');
  if (!p.id && !p.receiptNo) return err('id or receiptNo required');
  const query    = p.id ? { _id: p.id } : { receiptNo: p.receiptNo };
  const don      = await Donation.findOne(query).lean();
  if (!don)                return err('Donation not found');
  const newDate  = new Date(p.poojaDate + 'T00:00:00Z');
  await Donation.updateOne(query, { $set: { poojaDate: newDate } });
  // Also update VendorTransaction dates
  const updated = await VendorTransaction.updateMany(
    { refId: don.receiptNo, refType: 'pooja' },
    { $set: { date: newDate } }
  );
  return ok({ receiptNo: don.receiptNo, poojaDate: p.poojaDate, vendorTxnsUpdated: updated.modifiedCount });
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

// ── Budget ────────────────────────────────────────────────

// GET  ?action=getBudget&festival=Aadi Festival&year=2026
// GET  ?action=getBudget&year=2026  → all festivals for year
async function getBudget(p) {
  const query = {};
  if (p.year)     query.year     = parseInt(p.year);
  if (p.festival) query.festival = p.festival;
  const docs = await Budget.find(query).sort({ year: -1, festival: 1 }).lean();
  const data = docs.map(d => {
    const initial  = d.items.reduce((s, i) => s + (i.initialBudget  || 0), 0);
    const revised  = d.items.reduce((s, i) => s + (i.revisedBudget  || 0), 0);
    const advance  = d.items.reduce((s, i) => s + (i.advance        || 0), 0);
    return { ...d, totals: { initial, revised, advance, balance: revised - advance } };
  });
  return ok({ data });
}

// POST ?action=saveBudget  body: { festival, year, notes, items[] }
// Upserts the entire budget document for a festival+year
async function saveBudget(p) {
  if (!p.festival) return err('festival required');
  if (!p.year)     return err('year required');
  const year  = parseInt(p.year);
  const items = p.items ? JSON.parse(p.items) : [];
  const doc = await Budget.findOneAndUpdate(
    { festival: p.festival, year },
    { $set: { festival: p.festival, year, notes: p.notes || '', items, isFinalized: p.isFinalized === 'true' } },
    { upsert: true, new: true }
  );
  return ok({ data: doc });
}

// POST ?action=addBudgetItem  body: { festival, year, description, category, initialBudget, revisedBudget, advance, notes }
async function addBudgetItem(p) {
  if (!p.festival) return err('festival required');
  if (!p.year)     return err('year required');
  const year = parseInt(p.year);
  const item = {
    description:   p.description   || '',
    category:      p.category      || 'Miscellaneous',
    initialBudget: parseFloat(p.initialBudget  || 0),
    revisedBudget: parseFloat(p.revisedBudget  || p.initialBudget || 0),
    advance:       parseFloat(p.advance        || 0),
    notes:         p.notes || '',
  };
  const doc = await Budget.findOneAndUpdate(
    { festival: p.festival, year },
    { $push: { items: item }, $setOnInsert: { festival: p.festival, year } },
    { upsert: true, new: true }
  );
  return ok({ data: doc });
}

// POST ?action=updateBudgetItem  body: { festival, year, itemId, ...fields }
async function updateBudgetItem(p) {
  if (!p.festival || !p.year || !p.itemId) return err('festival, year, itemId required');
  const year = parseInt(p.year);
  const update = {};
  if (p.description   !== undefined) update['items.$.description']   = p.description;
  if (p.category      !== undefined) update['items.$.category']      = p.category;
  if (p.initialBudget !== undefined) update['items.$.initialBudget'] = parseFloat(p.initialBudget);
  if (p.revisedBudget !== undefined) update['items.$.revisedBudget'] = parseFloat(p.revisedBudget);
  if (p.advance       !== undefined) update['items.$.advance']       = parseFloat(p.advance);
  if (p.notes         !== undefined) update['items.$.notes']         = p.notes;
  await Budget.updateOne(
    { festival: p.festival, year, 'items._id': p.itemId },
    { $set: update }
  );
  return ok({ message: 'Updated' });
}

// POST ?action=deleteBudgetItem  body: { festival, year, itemId }
async function deleteBudgetItem(p) {
  if (!p.festival || !p.year || !p.itemId) return err('festival, year, itemId required');
  const year = parseInt(p.year);
  await Budget.updateOne(
    { festival: p.festival, year },
    { $pull: { items: { _id: p.itemId } } }
  );
  return ok({ message: 'Deleted' });
}

module.exports = router;
