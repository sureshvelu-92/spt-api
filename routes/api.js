'use strict';

const router = require('express').Router();
const { ok, err } = require('../utils/helpers');

// ── Domain handlers ───────────────────────────────────────
const donations = require('../handlers/donations');
const expenses  = require('../handlers/expenses');
const vendors   = require('../handlers/vendors');
const poojas    = require('../handlers/poojas');
const reports   = require('../handlers/reports');
const auth      = require('../handlers/auth');
const finance   = require('../handlers/finance');

const TOKEN = process.env.API_TOKEN || 'SPTT@1985';

// ── Auth middleware ───────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.query.token || req.body.token || '';
  if (token !== TOKEN) return res.json(err('Unauthorized'));
  next();
}

// All actions via GET (matches existing PWA calls)
router.get('/', authMiddleware, async (req, res) => {
  const p = req.query;
  try {
    switch (p.action) {

      case 'ping':
        return res.json(ok({ message: 'Connected ✓', version: 1 }));

      // ── Donations ──────────────────────────────────────
      case 'addDonation':        return res.json(await donations.addDonation(p));
      case 'addPooja':           return res.json(await poojas.addPooja(p));
      case 'addInKindDonation':  return res.json(await donations.addInKind(p));
      case 'getReceipts':        return res.json(await donations.getReceipts(p));
      case 'getRecentDonations': return res.json(await donations.getRecentDonations(p));
      case 'getInKindDonations': return res.json(await donations.getInKind());
      case 'getLastSeq':         return res.json(await donations.getLastSeq('donation'));
      case 'getLastInKindSeq':   return res.json(await donations.getLastSeq('inkind'));
      case 'getLastExpenseSeq':  return res.json(await donations.getLastSeq('expense'));
      case 'updateReceived':     return res.json(await donations.updateReceived(p));
      case 'getAllData':          return res.json(await donations.getAllData());

      // ── Expenses ───────────────────────────────────────
      case 'addExpense':          return res.json(await expenses.addExpense(p));
      case 'getExpenses':         return res.json(await expenses.getExpenses());
      case 'getYearlyExpenses':   return res.json(await expenses.getYearlyExpenses(p));
      case 'getYearlyDonations':  return res.json(await donations.getYearlyDonations(p));

      // ── Reports ────────────────────────────────────────
      case 'getMonthlyReport': return res.json(await reports.getMonthlyReport(p));
      case 'getYearlyReport':  return res.json(await reports.getYearlyReport(p));
      case 'getOverallReport': return res.json(await reports.getOverallReport());
      case 'getLedger':        return res.json(await reports.getLedger(p));
      case 'getCombinedLedger': return res.json(await reports.getCombinedLedger(p));

      // ── Finance / Config ───────────────────────────────
      case 'getConfig':         return res.json(await finance.getConfig());
      case 'updateConfig':      return res.json(await finance.updateConfig(p));
      case 'getSequences':      return res.json(await finance.getSequences());
      case 'setSequence':       return res.json(await finance.setSequence(p));
      case 'addTransaction':    return res.json(await finance.addManualTransaction(p));
      case 'getCashHolders':    return res.json(await finance.getCashHolders(p));
      case 'getBudget':         return res.json(await finance.getBudget(p));
      case 'saveBudget':        return res.json(await finance.saveBudget(p));
      case 'addBudgetItem':     return res.json(await finance.addBudgetItem(p));
      case 'updateBudgetItem':  return res.json(await finance.updateBudgetItem(p));
      case 'deleteBudgetItem':  return res.json(await finance.deleteBudgetItem(p));

      // ── Vendors ────────────────────────────────────────
      case 'getVendors':        return res.json(await vendors.getVendors());
      case 'addVendor':         return res.json(await vendors.addVendor(p));
      case 'getVendorPayables': return res.json(await vendors.getVendorPayables());
      case 'getVendorLedger':   return res.json(await vendors.getVendorLedger(p));
      case 'settleVendors':     return res.json(await vendors.settleVendors(p));

      // ── Pooja Schedule ─────────────────────────────────
      case 'getPoojaSchedule':  return res.json(await poojas.getPoojaSchedule(p));
      case 'autoFillSchedule':  return res.json(await poojas.autoFillSchedule(p));
      case 'approvePooja':      return res.json(await poojas.approvePooja(p));
      case 'rejectPooja':       return res.json(await poojas.rejectPooja(p));
      case 'markTempleFunded':  return res.json(await poojas.markTempleFunded(p));
      case 'markPoojaComplete': return res.json(await poojas.markPoojaComplete(p));
      case 'sponsorPooja':      return res.json(await poojas.sponsorPooja(p));
      case 'setPoojaDate':      return res.json(await poojas.setPoojaDate(p));
      case 'backfillPoojaDates': return res.json(await poojas.backfillPoojaDates());

      // ── One-time repair ────────────────────────────────
      case 'fixVendorTxnDates': return res.json(await poojas.fixVendorTxnDates());

      // ── Auth / Users ───────────────────────────────────
      case 'getUsers':               return res.json(await auth.getUsers());
      case 'addUser':                return res.json(await auth.addUser(p));
      case 'verifyPin':              return res.json(await auth.verifyPin(p));
      case 'setPin':                 return res.json(await auth.setPin(p));
      case 'webauthnRegisterOptions': return res.json(await auth.webauthnRegisterOptions(p));
      case 'webauthnRegisterVerify':  return res.json(await auth.webauthnRegisterVerify(p));
      case 'webauthnAuthOptions':     return res.json(await auth.webauthnAuthOptions(p));
      case 'webauthnAuthVerify':      return res.json(await auth.webauthnAuthVerify(p));

      default:
        return res.json(err('Unknown action'));
    }
  } catch (e) {
    console.error(e);
    return res.json(err(e.message));
  }
});

// Also support POST — merge body into query then re-dispatch as GET
router.post('/', authMiddleware, (req, res, next) => {
  req.query = { ...req.query, ...req.body };
  req.method = 'GET';
  router.handle(req, res, next);
});

module.exports = router;
