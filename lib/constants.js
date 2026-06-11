/**
 * constants.js — Single source of truth for all hardcoded temple literals.
 *
 * Import from here instead of scattering strings across routes, handlers,
 * and models. Update once → propagates everywhere.
 */

// ── Temple identity ──────────────────────────────────────────
const TEMPLE_NAME         = 'Sri Ponniamman Temple Trust (R)';
const TEMPLE_FOUNDED_YEAR = 1985;
const TEMPLE_PAN          = 'AAYTS1092E';
const TEMPLE_REG_NO       = '64/2013';
const TEMPLE_YT_URL       = 'https://youtube.com/@SriPonniammanTempleGundaleri';

// ── Auth / token defaults ────────────────────────────────────
// These are fallback defaults only — override via environment variables.
const API_TOKEN_DEFAULT      = 'SPTT@1985';
const WEBAUTHN_RP_NAME       = 'Sri Ponniamman Temple Trust';
const WEBAUTHN_RP_ID_DEFAULT = 'sureshvelu-92.github.io';

// ── Receipt / voucher year ────────────────────────────────────
// Used as the year prefix in receipt/voucher numbers (e.g. "2026/D/001").
// Dynamic so it auto-advances on Jan 1 without a code change.
const RCP_YEAR = String(new Date().getFullYear());

// ── Pooja types ───────────────────────────────────────────────
const POOJA_TYPES = [
  'Weekly Pooja',
  'Amavasai Pooja',
  'Pournami Pooja',
  'Birthday Pooja',
  'Anniversary Pooja',
];

// ── Donation cash types ───────────────────────────────────────
const DON_TYPES = ['Pooja', 'Aadi Festival', 'Temple Development', 'Others'];

// ── Expense / income types ────────────────────────────────────
const EXPENSE_TYPES     = ['Aadi Festival', 'Temple Operations', 'Temple Development', 'Others'];
const EXP_TYPE_TEMPLE_OPS = 'Temple Operations';
const EXP_TYPE_AADI       = 'Aadi Festival';

// ── Pooja variants and default rates ─────────────────────────
const POOJA_VARIANTS      = ['Regular', 'Special'];
const POOJA_RATES_DEFAULT = { Regular: 799, Special: 1499 };

// ── Payment modes ─────────────────────────────────────────────
const PAYMENT_MODES = ['Cash', 'UPI', 'Cheque', 'Bank Transfer'];

// ── Staff ─────────────────────────────────────────────────────
const STAFF = ['Sunil Kumar', 'Suresh Velu'];

// ── In-kind categories ────────────────────────────────────────
const INKIND_CATEGORIES = [
  'Pooja Materials', 'Flowers', 'Milk', 'Food', 'Cloth', 'Utensils', 'Miscellaneous',
];

module.exports = {
  TEMPLE_NAME,
  TEMPLE_FOUNDED_YEAR,
  TEMPLE_PAN,
  TEMPLE_REG_NO,
  TEMPLE_YT_URL,
  API_TOKEN_DEFAULT,
  WEBAUTHN_RP_NAME,
  WEBAUTHN_RP_ID_DEFAULT,
  RCP_YEAR,
  POOJA_TYPES,
  DON_TYPES,
  EXPENSE_TYPES,
  EXP_TYPE_TEMPLE_OPS,
  EXP_TYPE_AADI,
  POOJA_VARIANTS,
  POOJA_RATES_DEFAULT,
  PAYMENT_MODES,
  STAFF,
  INKIND_CATEGORIES,
};
