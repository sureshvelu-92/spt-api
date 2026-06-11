'use strict';

const mongoose    = require('mongoose');
const Expense     = require('../models/Expense');
const AppConfig   = require('../models/AppConfig');
const { ok, err, createLedgerEntry, fmtDate, RCP_YEAR } = require('../utils/helpers');
const { EXP_TYPE_AADI } = require('../lib/constants');

async function addExpense(p) {
  const year      = new Date().getFullYear();
  const seq       = p.voucherNo ? null : await AppConfig.nextSeq('expense');
  const voucherNo = p.voucherNo || `${RCP_YEAR}/EX/${seq}`;
  const expDate   = p.date ? new Date(p.date) : new Date();
  const amount    = parseFloat(p.amount) || 0;

  await Expense.create({
    voucherNo, date: expDate,
    vendor: p.vendor || '', description: p.description || '',
    category: p.category || '', amount,
    mode: p.mode || 'Cash',
    paidBy:   p.paidBy   || '',
    paidById: p.paidById ? mongoose.Types.ObjectId.isValid(p.paidById) ? p.paidById : null : null,
    remarks: p.remarks || '', expType: p.expType || EXP_TYPE_AADI,
  });

  // ── General Ledger: auto debit entry ──
  try {
    await createLedgerEntry({
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

async function getExpenses() {
  const rows = await Expense.find().sort({ date: -1 }).lean();
  return ok({ data: rows.map(mapExpense) });
}

async function getYearlyExpenses(p = {}) {
  const year  = parseInt(p.year) || new Date().getFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end   = new Date(Date.UTC(year + 1, 0, 1));
  const rows  = await Expense.find({ date: { $gte: start, $lt: end } }).sort({ date: 1 }).lean();
  return ok({ data: rows.map(mapExpense), year, count: rows.length });
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

module.exports = {
  addExpense,
  getExpenses,
  getYearlyExpenses,
  mapExpense,
};
