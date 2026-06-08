const mongoose = require('mongoose');

const sequenceSchema = new mongoose.Schema({
  _id:  { type: String, required: true }, // 'donation' | 'inkind' | 'expense'
  seq:  { type: Number, default: 0 },
  year: { type: Number, default: new Date().getFullYear() },
});

sequenceSchema.statics.nextSeq = async function (type, year) {
  const doc = await this.findByIdAndUpdate(
    type,
    { $inc: { seq: 1 }, $set: { year } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Sequence', sequenceSchema);
