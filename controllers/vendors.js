'use strict';
const svc = require('../services/vendors');
exports.getVendors        = (req, res) => svc.getVendors().then(r => res.json(r));
exports.addVendor         = (req, res) => svc.addVendor(req.query).then(r => res.json(r));
exports.getVendorPayables = (req, res) => svc.getVendorPayables().then(r => res.json(r));
exports.getVendorLedger   = (req, res) => svc.getVendorLedger(req.query).then(r => res.json(r));
exports.settleVendors     = (req, res) => svc.settleVendors(req.query).then(r => res.json(r));
