'use strict';

const mongoose      = require('mongoose');
const Donation      = require('../models/Donation');
const InKind        = require('../models/InKind');
const AppConfig     = require('../models/AppConfig');
const Transaction   = require('../models/Transaction');
const PoojaSchedule = require('../models/PoojaSchedule');
const { ok, err, createLedgerEntry, fmtDate, isPoojaType, RCP_YEAR } = require('../utils/helpers');
const { EXP_TYPE_AADI } = require('../lib/constants');

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
    receivedById: p.receivedById ? mongoose.Types.ObjectId.isValid(p.receivedById) ? p.receivedById : null : null,
    notes: p.notes || p.purpose || '',
    status,
    donType: p.donType || EXP_TYPE_AADI,
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
      const Transaction = require('../models/Transaction');
      // Guard against duplicates: donation uses upsert so the same receiptNo
      // can arrive multiple times (re-submit, retry). Only create one txn per receipt.
      const existingTxn = await Transaction.findOne({ refType: 'donation', refId: receiptNo }).lean();
      if (existingTxn) {
        // Update amount only if it changed (e.g. partial-to-full payment)
        if (existingTxn.amount !== received) {
          await Transaction.updateOne({ _id: existingTxn._id }, { $set: { amount: received } });
        }
      } else {
        const isPooja = isPoojaType(p.donType);
        await createLedgerEntry({
          date:        donDate,
          type:        'credit',
          category:    isPooja ? 'Pooja Income' : 'Donation',
          amount:      received,
          description: p.notes || p.purpose || (isPooja ? `${p.poojaType || p.donType}${p.poojaVariant ? ` (${p.poojaVariant})` : ''}` : ''),
          party:       p.donor || '',
          mode:        isPend ? '' : (p.mode || 'Cash'),
          refType:     'donation',
          refId:       receiptNo,
          recordedBy:  p.receivedBy || '',
          year,
        });
      }
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

async function addInKind(p) {
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

async function getReceipts(p = {}) {
  const limit   = parseInt(p.limit)  || 0;
  const page    = parseInt(p.page)   || 1;
  const skip    = limit ? (page - 1) * limit : 0;
  const filter  = {};
  if (p.donType) filter.donType = p.donType;
  if (p.year)    { const y = parseInt(p.year); filter.date = { $gte: new Date(Date.UTC(y, 0, 1)), $lt: new Date(Date.UTC(y + 1, 0, 1)) }; }
  const q     = Donation.find(filter).sort({ date: -1 });
  if (limit) q.skip(skip).limit(limit);
  const [rows, total] = await Promise.all([
    q.lean(),
    limit ? Donation.countDocuments(filter) : Promise.resolve(0),
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

  const addedAmt    = parseFloat(p.received) || 0;
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

async function getYearlyDonations(p = {}) {
  const year = parseInt(p.year) || new Date().getFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end   = new Date(Date.UTC(year + 1, 0, 1));
  const rows  = await Donation.find({ date: { $gte: start, $lt: end } }).sort({ date: 1 }).lean();
  return ok({ data: rows.map(mapDonation), year, count: rows.length });
}

async function getAllData() {
  const Expense = require('../models/Expense');
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

// ── Mapping helpers ───────────────────────────────────────
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

module.exports = {
  addDonation,
  addInKind,
  getReceipts,
  getYearlyDonations,
  getRecentDonations,
  getInKind,
  getLastSeq,
  updateReceived,
  getAllData,
  mapDonation,
  mapInKind,
  mapExpense,
};
