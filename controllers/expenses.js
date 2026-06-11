'use strict';
const svc = require('../services/expenses');
exports.addExpense        = (req, res) => svc.addExpense(req.query).then(r => res.json(r));
exports.getExpenses       = (req, res) => svc.getExpenses(req.query).then(r => res.json(r));
exports.getYearlyExpenses = (req, res) => svc.getYearlyExpenses(req.query).then(r => res.json(r));
