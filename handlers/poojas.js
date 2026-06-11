'use strict';

const Donation          = require('../models/Donation');
const Expense           = require('../models/Expense');
const AppConfig         = require('../models/AppConfig');
const VendorTransaction = require('../models/VendorTransaction');
const Transaction       = require('../models/Transaction');
const PoojaSchedule     = require('../models/PoojaSchedule');
const { ok, err, createLedgerEntry, fmtDate, RCP_YEAR } = require('../utils/helpers');

// ── Lunar / Calendar helpers ──────────────────────────────

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

// ── Pooja Schedule handlers ───────────────────────────────

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

  const totalCost = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const label     = `${p.poojaType} (${p.poojaVariant}) — Temple Fund`;

  // ── 1. Expense entry ─────────────────────────────────────
  const expSeq    = await AppConfig.nextSeq('expense');
  const voucherNo = `${RCP_YEAR}/EX/${expSeq}`;
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
    await createLedgerEntry({
      date:        poojaDate,
      type:        'debit',
      category:    'Expense',
      amount:      totalCost,
      description: label,
      party:       'Temple Fund',
      mode:        p.mode || 'Cash',
      refType:     'expense',
      refId:       voucherNo,
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
    poojaType:    p.poojaType,
    poojaVariant: p.poojaVariant,
    totalCost,
    breakdown:    breakdown.length,
  });
}

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

  // hasVendorTxn is written directly to PoojaSchedule by markPoojaComplete — read it from there.

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
      hasVendorTxn:   !!row.hasVendorTxn,
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
    status:    'unfunded',
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

  // ── Update PoojaSchedule slot (Expense is deferred to markPoojaComplete) ──
  // Expense + vendor payments are only created when the admin clicks "Pooja Done".
  // Approval just marks the slot as temple_funded so it appears in the schedule.
  await PoojaSchedule.updateOne(
    { _id: slot._id },
    { $set: {
      status:         'temple_funded',
      approvalStatus: 'approved',
      approvedBy:     p.approvedBy,
      approvedAt:     new Date(),
    }}
  );

  // ── Update linked Donation ────────────────────────────────
  if (slot.donationId) {
    const cfg        = await AppConfig.get();
    const variantKey = (slot.poojaVariant === 'Special') ? 'special' : 'regular';
    const totalCost  = (cfg.poojaBreakdown?.[variantKey] || []).reduce((s, l) => s + (l.amount || 0), 0);
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

  return ok({ receiptNo: slot.receiptNo, vendorTxns: 0 });
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
 * No donor required. Creates Expense + Ledger debit entry.
 * VendorTransaction entries are created only when admin clicks "Pooja Done" (markPoojaComplete).
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

  // Expense + vendor payments are deferred to markPoojaComplete ("Pooja Done").
  // This function only marks the slot as temple-funded for scheduling purposes.
  const variant = p.variant || slot.poojaVariant || 'Regular';

  // Update PoojaSchedule slot
  await PoojaSchedule.updateOne(
    { _id: slot._id },
    { $set: {
      status:         'temple_funded',
      isTempleFunded: true,
      approvalStatus: 'approved',
      approvedBy:     p.approvedBy,
      approvedAt:     new Date(),
      poojaVariant:   variant,
    }}
  );

  return ok({ vendorTxns: 0 });
}

// ── Sponsor a Pooja ──────────────────────────────────────
// Record a sponsor name directly on the schedule slot.
// No donation record required — just sets personName + status donor_funded.
// Params: scheduleId, sponsorName, approvedBy
async function sponsorPooja(p) {
  if (!p.scheduleId)  return err('scheduleId required');
  if (!p.sponsorName || !p.sponsorName.trim()) return err('sponsorName required');
  const slot = await PoojaSchedule.findById(p.scheduleId);
  if (!slot) return err('Slot not found');
  if (slot.hasVendorTxn) return err('Pooja already completed');

  slot.personName     = p.sponsorName.trim();
  slot.status         = 'donor_funded';
  slot.isTempleFunded = false;
  slot.approvalStatus = 'approved';
  slot.approvedBy     = p.approvedBy || 'Admin';
  slot.approvedAt     = new Date();
  await slot.save();
  return ok({ message: 'Sponsor recorded' });
}

// ── Mark Pooja Complete (Pooja Done button) ───────────────
//
// Business rule: per calendar day, vendors are paid ONCE at the highest variant
// (Special beats Regular). If another slot on the same day already has vendor
// txns, this slot is simply marked done with no additional txns.
//
// Params:
//   scheduleId   — PoojaSchedule _id
//   doneBy       — who clicked Done
//   variant      — override variant (optional)
//   onlyMarkDone — 'true' to mark done without creating vendor txns (used when
//                  another slot on the same day already holds the txns)
async function markPoojaComplete(p) {
  if (!p.scheduleId) return err('scheduleId required');
  if (!p.doneBy)     return err('doneBy required');

  const slot = await PoojaSchedule.findById(p.scheduleId).lean();
  if (!slot)                      return err('PoojaSchedule slot not found');
  if (slot.hasVendorTxn)          return err('Pooja already marked as done');
  if (slot.status === 'rejected') return err('Rejected slots cannot be completed');

  const poojaDateObj = new Date(slot.poojaDate);
  const year         = poojaDateObj.getFullYear();

  // ── Check if another slot on the SAME DAY already has vendor txns ──────────
  const dayStart = new Date(Date.UTC(poojaDateObj.getUTCFullYear(), poojaDateObj.getUTCMonth(), poojaDateObj.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86400000);
  const alreadyDoneToday = await PoojaSchedule.findOne({
    _id:          { $ne: slot._id },
    poojaDate:    { $gte: dayStart, $lt: dayEnd },
    hasVendorTxn: true,
  }).lean();

  // If another slot on the same day is already done → just mark this one done
  if (alreadyDoneToday || p.onlyMarkDone === 'true') {
    await PoojaSchedule.updateOne({ _id: slot._id }, { $set: { hasVendorTxn: true } });
    return ok({ vendorTxns: 0, totalCost: 0, refId: slot.receiptNo || '', skipped: true });
  }

  // ── Determine variant ────────────────────────────────────────────────────
  // Rule: temple-funded slots are always Regular.
  //       donor-funded slots use the donor's chosen variant (Regular or Special).
  //       If multiple donor-funded slots exist today, use the highest (Special wins).
  const isDonorFunded = slot.status === 'donor_funded';

  let variant;
  if (!isDonorFunded) {
    // Temple funded → always Regular
    variant = 'Regular';
  } else {
    // Donor funded — check if any donor-funded slot on this day chose Special
    const donorSlotsToday = await PoojaSchedule.find({
      poojaDate: { $gte: dayStart, $lt: dayEnd },
      status:    'donor_funded',
    }).lean();
    const hasSpecialDonor = donorSlotsToday.some(s => s.poojaVariant === 'Special');
    variant = hasSpecialDonor ? 'Special' : (p.variant || slot.poojaVariant || 'Regular');
  }
  const variantKey = variant === 'Special' ? 'special' : 'regular';

  const cfg          = await AppConfig.get();
  const breakdown    = cfg.poojaBreakdown?.[variantKey] || [];
  const totalCost    = breakdown.reduce((s, l) => s + (l.amount || 0), 0);
  const personSuffix = slot.personName ? ` | ${slot.personName}` : '';

  let refId     = slot.receiptNo || '';
  let voucherNo = '';
  const isTemple = slot.status === 'unfunded' || slot.status === 'pending_approval' || slot.status === 'temple_funded';

  // ── If unfunded → promote to temple_funded ────────────────────────────────
  if (slot.status === 'unfunded') {
    const expSeq = await AppConfig.nextSeq('expense');
    voucherNo    = `${RCP_YEAR}/EX/${expSeq}`;
    const label  = `${slot.poojaType} (${variant}) — Temple Fund | ${slot.dayType}${personSuffix}`;

    await Expense.create({
      voucherNo, date: poojaDateObj, vendor: 'Temple Fund',
      description: label, category: 'Puja & Rituals', expType: 'Temple Operations',
      amount: totalCost, mode: 'Cash', paidBy: p.doneBy, year,
    });

    try {
      await createLedgerEntry({
        date:        poojaDateObj,
        type:        'debit',
        category:    'Expense',
        amount:      totalCost,
        description: label,
        party:       'Temple Fund',
        mode:        'Cash',
        refType:     'expense',
        refId:       voucherNo,
        recordedBy:  p.doneBy,
        year,
      });
    } catch (e) { console.error('Ledger debit error (non-fatal):', e.message); }

    await PoojaSchedule.updateOne({ _id: slot._id }, { $set: {
      status: 'temple_funded', isTempleFunded: true,
      approvalStatus: 'approved', approvedBy: p.doneBy, approvedAt: new Date(),
      poojaVariant: variant, expenseVoucherNo: voucherNo,
    }});
    refId = voucherNo;

  } else if (slot.status === 'pending_approval' || slot.status === 'temple_funded') {
    if (slot.expenseVoucherNo) {
      voucherNo = slot.expenseVoucherNo;
    } else {
      const expSeq = await AppConfig.nextSeq('expense');
      voucherNo    = `${RCP_YEAR}/EX/${expSeq}`;
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

  // ── Create vendor transactions — once per day at highest rate ─────────────
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

  // ── Mark THIS slot done ───────────────────────────────────────────────────
  await PoojaSchedule.updateOne({ _id: slot._id }, { $set: {
    hasVendorTxn: true,
    poojaVariant: variant,
  }});

  return ok({ vendorTxns, totalCost, refId });
}

/**
 * setPoojaDate — update poojaDate on a donation (by id or receiptNo)
 * Also updates any linked VendorTransactions to use the new poojaDate
 */
async function setPoojaDate(p) {
  if (!p.poojaDate)          return err('poojaDate required (YYYY-MM-DD)');
  if (!p.id && !p.receiptNo) return err('id or receiptNo required');
  const query   = p.id ? { _id: p.id } : { receiptNo: p.receiptNo };
  const don     = await Donation.findOne(query).lean();
  if (!don)                  return err('Donation not found');
  const newDate = new Date(p.poojaDate + 'T00:00:00Z');
  await Donation.updateOne(query, { $set: { poojaDate: newDate } });
  // Also update VendorTransaction dates
  const VendorTransaction = require('../models/VendorTransaction');
  const updated = await VendorTransaction.updateMany(
    { refId: don.receiptNo, refType: 'pooja' },
    { $set: { date: newDate } }
  );
  return ok({ receiptNo: don.receiptNo, poojaDate: p.poojaDate, vendorTxnsUpdated: updated.modifiedCount });
}

/**
 * backfillPoojaDates — migration script
 *
 * For every pooja/anniversary donation that has poojaDate = null,
 * set poojaDate = date (the donation entry date, i.e. the date the pooja was done).
 * Also syncs the date on any linked VendorTransactions (refId = receiptNo).
 *
 * Safe to run multiple times (idempotent — only touches null records).
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

  const VendorTransaction = require('../models/VendorTransaction');

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
 * fixVendorTxnDates — one-time repair
 * For each pooja VendorTransaction linked to a donation receipt (refId = YYYY/D/NNN),
 * update the transaction date to the donation's poojaDate if it differs.
 */
async function fixVendorTxnDates() {
  const VendorTransaction = require('../models/VendorTransaction');
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

module.exports = {
  addPooja,
  getPoojaSchedule,
  autoFillSchedule,
  approvePooja,
  rejectPooja,
  markTempleFunded,
  markPoojaComplete,
  sponsorPooja,
  setPoojaDate,
  backfillPoojaDates,
  fixVendorTxnDates,
};
