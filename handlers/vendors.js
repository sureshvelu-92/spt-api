'use strict';

const Vendor            = require('../models/Vendor');
const VendorTransaction = require('../models/VendorTransaction');
const Expense           = require('../models/Expense');
const AppConfig         = require('../models/AppConfig');
const { ok, err, fmtDate, RCP_YEAR } = require('../utils/helpers');
const { EXP_TYPE_TEMPLE_OPS } = require('../lib/constants');

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

  const amount     = parseFloat(p.amount) || 0;
  const settleDate = p.date ? new Date(p.date) : new Date();
  const settledBy  = p.paidBy;

  // 1. Create expense entry
  const expSeq    = await AppConfig.nextSeq('expense');
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
    expType:     EXP_TYPE_TEMPLE_OPS,
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

module.exports = {
  getVendors,
  addVendor,
  getVendorPayables,
  getVendorLedger,
  settleVendors,
};
