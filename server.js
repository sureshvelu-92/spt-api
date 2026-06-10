require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');

const app = express();

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://sureshvelu-92.github.io',
    /^http:\/\/localhost(:\d+)?$/,       // local dev
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Cache-Control middleware ───────────────────────────────
// Read actions get a short stale-while-revalidate window so
// the browser/SWR can serve cached data instantly on repeat
// visits while the API re-fetches in the background.
// Write actions (POST) always bypass cache.
const READ_ACTIONS = new Set([
  'ping','getReceipts','getRecentDonations','getInKindDonations',
  'getExpenses','getMonthlyReport','getYearlyReport','getOverallReport',
  'getConfig','getVendors','getVendorPayables','getVendorLedger',
  'getLedger','getCombinedLedger','getCashHolders',
  'getPoojaSchedule','getBudget','getUsers','getSequences',
]);

app.use((req, res, next) => {
  const action = req.query.action;
  if (req.method === 'GET' && action && READ_ACTIONS.has(action)) {
    // stale-while-revalidate: serve cache instantly, refresh in background
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// ── DB connect ────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, { autoSelectFamily: false })
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });

// ── Routes ────────────────────────────────────────────────
app.use('/', require('./routes/api'));

// ── Health ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Global error handler ──────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[API Error]', err);
  res.status(500).json({ status: 'error', message: err.message ?? 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SPT API running on port ${PORT}`));
