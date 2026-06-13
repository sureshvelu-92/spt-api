'use strict';

const Reimbursement = require('../models/Reimbursement');
const Sequence      = require('../models/Sequence');

const ok  = (data)  => ({ status: 'ok',    ...data });
const err = (msg)   => ({ status: 'error', message: msg });

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── GET reimbursements ────────────────────────────────────
async function getReimbursements(p) {
  const year = parseInt(p.year || new Date().getFullYear());
  const from = new Date(Date.UTC(year,     0, 1));
  const to   = new Date(Date.UTC(year + 1, 0, 1));

  const docs = await Reimbursement.find({ date: { $gte: from, $lt: to } })
    .sort({ date: -1 })
    .lean();

  const data = docs.map(d => ({
    _id:        d._id,
    reimbNo:    d.reimbNo,
    date:       fmtDate(d.date),
    rawDate:    d.date,
    fromUser:   d.fromUser,
    toUser:     d.toUser,
    amount:     d.amount,
    mode:       d.mode || 'Cash',
    notes:      d.notes,
    recordedBy: d.recordedBy,
    year:       d.year,
  }));

  return ok({ year, data });
}

// ── ADD reimbursement ─────────────────────────────────────
async function addReimbursement(p, body) {
  const b = body || p;
  if (!b.fromUser) return err('fromUser is required');
  if (!b.toUser)   return err('toUser is required');
  if (b.fromUser === b.toUser) return err('fromUser and toUser must be different');
  if (!b.amount || isNaN(Number(b.amount)) || Number(b.amount) <= 0)
    return err('Valid amount is required');

  const date = b.date ? new Date(b.date) : new Date();
  const year = date.getFullYear();

  const seq  = await Sequence.nextSeq('reimbursement', year);
  const reimbNo = `${year}/RB/${seq}`;

  const doc = await Reimbursement.create({
    reimbNo,
    date,
    fromUser:   b.fromUser,
    toUser:     b.toUser,
    amount:     Number(b.amount),
    mode:       b.mode || 'Cash',
    notes:      b.notes || '',
    recordedBy: b.recordedBy || '',
    year,
  });

  return ok({ reimbNo: doc.reimbNo, _id: doc._id });
}

// ── DELETE reimbursement ──────────────────────────────────
async function deleteReimbursement(p) {
  const { id } = p;
  if (!id) return err('id is required');
  await Reimbursement.findByIdAndDelete(id);
  return ok({ deleted: true });
}

module.exports = { getReimbursements, addReimbursement, deleteReimbursement };
