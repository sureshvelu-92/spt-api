'use strict';

const AppConfig   = require('../models/AppConfig');
const Transaction = require('../models/Transaction');
const { RCP_YEAR: _RCP_YEAR } = require('../lib/constants');

// Re-export so existing callers that require RCP_YEAR from helpers still work.
const RCP_YEAR = _RCP_YEAR;

// ── Response wrappers ─────────────────────────────────────
const ok  = (data) => ({ status: 'ok',    ...data });
const err = (msg)  => ({ status: 'error', message: msg });

// ── Sequence helper ───────────────────────────────────────
async function nextSeq(type) {
  return AppConfig.nextSeq(type);
}

// ── UTC date normalization ────────────────────────────────
/**
 * Normalize a date string or Date object to midnight UTC.
 * Used so that pooja dates stored in MongoDB always land on
 * the calendar day intended, regardless of server timezone.
 */
function toUtcDate(dateStr) {
  const d = new Date(dateStr);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ── General ledger entry creator ──────────────────────────
/**
 * createLedgerEntry — wraps Transaction.create with a generated txnNo.
 *
 * @param {object} params
 *   type        'credit' | 'debit'
 *   category    string
 *   amount      number
 *   description string
 *   party       string
 *   mode        string  (default 'Cash')
 *   refType     string
 *   refId       string
 *   recordedBy  string
 *   remarks     string  (optional)
 *   date        Date    (default: now)
 *   year        number  (default: current year)
 */
async function createLedgerEntry(params) {
  const txnSeq = await AppConfig.nextSeq('txn');
  const txnNo  = `${RCP_YEAR}/TXN/${txnSeq}`;
  const year   = params.year || new Date().getFullYear();
  return Transaction.create({
    txnNo,
    date:        params.date        || new Date(),
    type:        params.type,
    category:    params.category,
    amount:      params.amount,
    description: params.description || '',
    party:       params.party       || '',
    mode:        params.mode        || 'Cash',
    refType:     params.refType,
    refId:       params.refId       || '',
    recordedBy:  params.recordedBy  || '',
    remarks:     params.remarks     || '',
    year,
  });
}

// ── Date formatter (for client display) ──────────────────
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── isPoojaType ───────────────────────────────────────────
function isPoojaType(donType) {
  const t = (donType || '').toLowerCase();
  return t.includes('pooja') || t.includes('anniversary');
}

module.exports = { ok, err, nextSeq, toUtcDate, createLedgerEntry, fmtDate, isPoojaType, RCP_YEAR };
