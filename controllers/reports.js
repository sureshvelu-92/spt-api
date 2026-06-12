'use strict';
const svc = require('../services/reports');
exports.getMonthlyReport  = (req, res) => svc.getMonthlyReport(req.query).then(r => res.json(r));
exports.getYearlyReport   = (req, res) => svc.getYearlyReport(req.query).then(r => res.json(r));
exports.getOverallReport  = (req, res) => svc.getOverallReport().then(r => res.json(r));
exports.getLedger         = (req, res) => svc.getLedger(req.query).then(r => res.json(r));
exports.getCombinedLedger = (req, res) => svc.getCombinedLedger(req.query).then(r => res.json(r));
exports.getCustomReport   = (req, res) => svc.getCustomReport(req.query).then(r => res.json(r));
