const mongoose = require('mongoose');

const inKindSchema = new mongoose.Schema({
  receiptNo:   { type: String, required: true, unique: true, index: true },
  date:        { type: Date,   default: Date.now, index: true },
  donor:       { type: String, default: '' },
  itemDesc:    { type: String, default: '' },
  qty:         { type: String, default: '' },
  estValue:    { type: Number, default: 0 },
  category:    { type: String, default: '' },
  receivedBy:  { type: String, default: '' },
  status:      { type: String, default: 'In Stock' },
}, { timestamps: true });

module.exports = mongoose.model('InKind', inKindSchema);
