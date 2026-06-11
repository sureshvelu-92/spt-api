'use strict';

// Mock dependencies that helpers.js requires at the module level
jest.mock('../../models/AppConfig', () => ({ nextSeq: jest.fn().mockResolvedValue(1) }));
jest.mock('../../models/Transaction', () => ({ create: jest.fn() }));
jest.mock('../../lib/constants', () => ({ RCP_YEAR: '2026' }));

const { ok, err, fmtDate, isPoojaType, toUtcDate } = require('../../utils/helpers');

describe('helpers — ok()', () => {
  it('returns status ok with spread data', () => {
    expect(ok({ foo: 'bar' })).toEqual({ status: 'ok', foo: 'bar' });
  });

  it('works with empty data', () => {
    expect(ok({})).toEqual({ status: 'ok' });
  });
});

describe('helpers — err()', () => {
  it('returns status error with message', () => {
    expect(err('bad')).toEqual({ status: 'error', message: 'bad' });
  });

  it('preserves the message string exactly', () => {
    expect(err('Something went wrong')).toEqual({ status: 'error', message: 'Something went wrong' });
  });
});

describe('helpers — fmtDate()', () => {
  it('formats a date and contains Jun and 2026', () => {
    const result = fmtDate(new Date('2026-06-01'));
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/2026/);
  });

  it('returns empty string for falsy input', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate('')).toBe('');
  });
});

describe('helpers — isPoojaType()', () => {
  it('returns true for "Weekly Pooja"', () => {
    expect(isPoojaType('Weekly Pooja')).toBe(true);
  });

  it('returns true for "Anniversary Pooja"', () => {
    expect(isPoojaType('Anniversary Pooja')).toBe(true);
  });

  it('returns true for strings containing "pooja" (case-insensitive)', () => {
    expect(isPoojaType('Birthday POOJA')).toBe(true);
  });

  it('returns false for "Temple Development"', () => {
    expect(isPoojaType('Temple Development')).toBe(false);
  });

  it('returns false for "Aadi Festival"', () => {
    expect(isPoojaType('Aadi Festival')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPoojaType('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPoojaType(null)).toBe(false);
    expect(isPoojaType(undefined)).toBe(false);
  });
});

describe('helpers — toUtcDate()', () => {
  it('returns a Date object at UTC midnight', () => {
    const result = toUtcDate('2026-06-15');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(5); // 0-indexed, June = 5
    expect(result.getUTCDate()).toBe(15);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });

  it('normalises a Date object to UTC midnight', () => {
    const result = toUtcDate(new Date('2026-01-01T10:30:00Z'));
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCDate()).toBe(1);
  });
});
