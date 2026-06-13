'use strict';

const router = require('express').Router();
const { ok, err } = require('../utils/helpers');
const { API_TOKEN_DEFAULT } = require('../lib/constants');

// ── Domain controllers ────────────────────────────────────
const donations = require('../controllers/donations');
const expenses  = require('../controllers/expenses');
const vendors   = require('../controllers/vendors');
const poojas    = require('../controllers/poojas');
const reports   = require('../controllers/reports');
const auth      = require('../controllers/auth');
const finance        = require('../controllers/finance');
const reimbursements = require('../handlers/reimbursements');

const TOKEN = process.env.API_TOKEN || API_TOKEN_DEFAULT;

// ── Auth middleware ───────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.query.token || req.body.token || '';
  if (token !== TOKEN) return res.json(err('Unauthorized'));
  next();
}

// All actions via GET (matches existing PWA calls)
router.get('/', authMiddleware, async (req, res) => {
  try {
    switch (req.query.action) {

      case 'ping':
        return res.json(ok({ message: 'Connected ✓', version: 1 }));

      // ── Donations ──────────────────────────────────────
      case 'addDonation':        return donations.addDonation(req, res);
      case 'addPooja':           return poojas.addPooja(req, res);
      case 'addInKindDonation':  return donations.addInKindDonation(req, res);
      case 'getReceipts':        return donations.getReceipts(req, res);
      case 'getRecentDonations': return donations.getRecentDonations(req, res);
      case 'getInKindDonations': return donations.getInKindDonations(req, res);
      case 'getLastSeq':         return donations.getLastSeq(req, res);
      case 'getLastInKindSeq':   return donations.getLastInKindSeq(req, res);
      case 'getLastExpenseSeq':  return donations.getLastExpenseSeq(req, res);
      case 'updateReceived':     return donations.updateReceived(req, res);
      case 'getAllData':          return donations.getAllData(req, res);

      // ── Expenses ───────────────────────────────────────
      case 'addExpense':          return expenses.addExpense(req, res);
      case 'getExpenses':         return expenses.getExpenses(req, res);
      case 'getYearlyExpenses':   return expenses.getYearlyExpenses(req, res);
      case 'getYearlyDonations':  return donations.getYearlyDonations(req, res);

      // ── Reports ────────────────────────────────────────
      case 'getMonthlyReport':  return reports.getMonthlyReport(req, res);
      case 'getYearlyReport':   return reports.getYearlyReport(req, res);
      case 'getOverallReport':  return reports.getOverallReport(req, res);
      case 'getLedger':         return reports.getLedger(req, res);
      case 'getCombinedLedger': return reports.getCombinedLedger(req, res);
      case 'getCustomReport':   return reports.getCustomReport(req, res);

      // ── Finance / Config ───────────────────────────────
      case 'getConfig':         return finance.getConfig(req, res);
      case 'updateConfig':      return finance.updateConfig(req, res);
      case 'getSequences':      return finance.getSequences(req, res);
      case 'setSequence':       return finance.setSequence(req, res);
      case 'addTransaction':    return finance.addTransaction(req, res);
      case 'getCashHolders':    return finance.getCashHolders(req, res);
      case 'getBudget':         return finance.getBudget(req, res);
      case 'saveBudget':        return finance.saveBudget(req, res);
      case 'addBudgetItem':     return finance.addBudgetItem(req, res);
      case 'updateBudgetItem':  return finance.updateBudgetItem(req, res);
      case 'deleteBudgetItem':  return finance.deleteBudgetItem(req, res);

      // ── Vendors ────────────────────────────────────────
      case 'getVendors':        return vendors.getVendors(req, res);
      case 'addVendor':         return vendors.addVendor(req, res);
      case 'getVendorPayables': return vendors.getVendorPayables(req, res);
      case 'getVendorLedger':   return vendors.getVendorLedger(req, res);
      case 'settleVendors':     return vendors.settleVendors(req, res);

      // ── Pooja Schedule ─────────────────────────────────
      case 'getPoojaSchedule':   return poojas.getPoojaSchedule(req, res);
      case 'autoFillSchedule':   return poojas.autoFillSchedule(req, res);
      case 'approvePooja':       return poojas.approvePooja(req, res);
      case 'rejectPooja':        return poojas.rejectPooja(req, res);
      case 'markTempleFunded':   return poojas.markTempleFunded(req, res);
      case 'markPoojaComplete':  return poojas.markPoojaComplete(req, res);
      case 'sponsorPooja':       return poojas.sponsorPooja(req, res);
      case 'setPoojaDate':       return poojas.setPoojaDate(req, res);
      case 'backfillPoojaDates': return poojas.backfillPoojaDates(req, res);

      // ── One-time repair ────────────────────────────────
      case 'fixVendorTxnDates': return poojas.fixVendorTxnDates(req, res);

      // ── Reimbursements ─────────────────────────────────
      case 'getReimbursements':    return res.json(await reimbursements.getReimbursements(req.query));
      case 'addReimbursement':     return res.json(await reimbursements.addReimbursement(req.query, req.body));
      case 'deleteReimbursement':  return res.json(await reimbursements.deleteReimbursement(req.query));

      // ── Auth / Users ───────────────────────────────────
      case 'getUsers':                return auth.getUsers(req, res);
      case 'addUser':                 return auth.addUser(req, res);
      case 'verifyPin':               return auth.verifyPin(req, res);
      case 'setPin':                  return auth.setPin(req, res);
      case 'webauthnRegisterOptions': return auth.webauthnRegisterOptions(req, res);
      case 'webauthnRegisterVerify':  return auth.webauthnRegisterVerify(req, res);
      case 'webauthnAuthOptions':     return auth.webauthnAuthOptions(req, res);
      case 'webauthnAuthVerify':      return auth.webauthnAuthVerify(req, res);

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
