require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── DB connect ────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, { autoSelectFamily: false })
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });

// ── Routes ────────────────────────────────────────────────
app.use('/', require('./routes/api'));

// ── Health ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SPT API running on port ${PORT}`));
