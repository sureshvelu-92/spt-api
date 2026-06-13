'use strict';

const AppConfig   = require('../models/AppConfig');
const Transaction = require('../models/Transaction');
const Donation    = require('../models/Donation');
const Expense     = require('../models/Expense');
const Budget      = require('../models/Budget');
const { ok, err, createLedgerEntry, fmtDate, isPoojaType, RCP_YEAR } = require('../utils/helpers');

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

/**
 * addManualTransaction — manual ledger entry (asset sale, interest, scrap, refund, etc.)
 * Required: type, category, amount, description
 */
async function addManualTransaction(p) {
  if (!p.type)     return err('type (credit|debit) required');
  if (!p.category) return err('category required');
  if (!p.amount)   return err('amount required');

  const year = new Date().getFullYear();
  const txn  = await createLedgerEntry({
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
  return ok({ txnNo: txn.txnNo, data: txn });
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
    { upsert: true, new: true, lean: true }
  );
  const d = doc.toObject ? doc.toObject() : doc;
  const initial = d.items.reduce((s, i) => s + (i.initialBudget || 0), 0);
  const revised = d.items.reduce((s, i) => s + (i.revisedBudget || 0), 0);
  const advance = d.items.reduce((s, i) => s + (i.advance       || 0), 0);
  return ok({ data: { ...d, totals: { initial, revised, advance, balance: revised - advance } } });
}

// POST ?action=addBudgetItem  body: { budgetId, description, category, initialBudget, revisedBudget, advance, notes }
async function addBudgetItem(p) {
  if (!p.budgetId) return err('budgetId required');
  const item = {
    description:   p.description   || '',
    category:      p.category      || 'Miscellaneous',
    initialBudget: parseFloat(p.initialBudget  || 0),
    revisedBudget: parseFloat(p.revisedBudget  || p.initialBudget || 0),
    advance:       parseFloat(p.advance        || 0),
    notes:         p.notes || '',
  };
  const doc = await Budget.findByIdAndUpdate(
    p.budgetId,
    { $push: { items: item } },
    { new: true }
  );
  if (!doc) return err('Budget not found');
  const initial = doc.items.reduce((s, i) => s + (i.initialBudget || 0), 0);
  const revised = doc.items.reduce((s, i) => s + (i.revisedBudget || 0), 0);
  const advance = doc.items.reduce((s, i) => s + (i.advance       || 0), 0);
  return ok({ data: { ...doc.toObject(), totals: { initial, revised, advance, balance: revised - advance } } });
}

// POST ?action=updateBudgetItem  body: { budgetId, itemId, ...fields }
async function updateBudgetItem(p) {
  if (!p.budgetId || !p.itemId) return err('budgetId and itemId required');
  const update = {};
  if (p.description   !== undefined) update['items.$.description']   = p.description;
  if (p.category      !== undefined) update['items.$.category']      = p.category;
  if (p.initialBudget !== undefined) update['items.$.initialBudget'] = parseFloat(p.initialBudget);
  if (p.revisedBudget !== undefined) update['items.$.revisedBudget'] = parseFloat(p.revisedBudget);
  if (p.advance       !== undefined) update['items.$.advance']       = parseFloat(p.advance);
  if (p.notes         !== undefined) update['items.$.notes']         = p.notes;
  await Budget.updateOne(
    { _id: p.budgetId, 'items._id': p.itemId },
    { $set: update }
  );
  return ok({ message: 'Updated' });
}

// POST ?action=deleteBudgetItem  body: { budgetId, itemId }
async function deleteBudgetItem(p) {
  if (!p.budgetId || !p.itemId) return err('budgetId and itemId required');
  await Budget.updateOne(
    { _id: p.budgetId },
    { $pull: { items: { _id: p.itemId } } }
  );
  return ok({ message: 'Deleted' });
}

// ── Repair: reassign ALL txnNos in date order ─────────────
// Clears every existing txnNo, resets the sequence counter,
// then re-assigns sequential IDs sorted by date asc (then createdAt asc).
async function fixTransactionIds() {
  // 1. Fetch all transactions sorted by date then createdAt
  const all = await Transaction.find({}).sort({ date: 1, createdAt: 1 }).lean();

  if (all.length === 0) return ok({ fixed: 0, message: 'No transactions found' });

  // 2. Reset txnSeq counter to 0
  await AppConfig.findByIdAndUpdate(
    'config',
    { $set: { txnSeq: 0 } },
    { upsert: true }
  );

  // 3. Re-assign sequential IDs
  let fixed = 0;
  for (const doc of all) {
    const seq   = await AppConfig.nextSeq('txn');
    const year  = doc.year || new Date(doc.date || doc.createdAt).getFullYear() || new Date().getFullYear();
    const txnNo = `${year}/TXN/${seq}`;
    await Transaction.updateOne({ _id: doc._id }, { $set: { txnNo } });
    fixed++;
  }

  return ok({ fixed, message: `Re-assigned txnNo for all ${fixed} transaction(s) in date order` });
}

module.exports = {
  getConfig,
  updateConfig,
  getSequences,
  setSequence,
  addManualTransaction,
  getCashHolders,
  getBudget,
  saveBudget,
  addBudgetItem,
  updateBudgetItem,
  deleteBudgetItem,
  fixTransactionIds,
};
