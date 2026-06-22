import { describe, it, expect } from 'vitest';

const { validatePasswordStrength, checkAccountLockout } = require('../middleware/security');

describe('validatePasswordStrength', () => {
  it('rejects short passwords', () => {
    const result = validatePasswordStrength('Ab1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('least 8 characters'))).toBe(true);
  });

  it('rejects password without uppercase', () => {
    const result = validatePasswordStrength('abcdef1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
  });

  it('rejects password without special character', () => {
    const result = validatePasswordStrength('Abcdef12');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('special'))).toBe(true);
  });

  it('rejects password with sequential characters', () => {
    const result = validatePasswordStrength('Abcdef1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sequential'))).toBe(true);
  });

  it('rejects password with repeated characters', () => {
    const result = validatePasswordStrength('Aaaabcdef1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('repeated'))).toBe(true);
  });

  it('accepts valid password', () => {
    const result = validatePasswordStrength('ValidP@ss1');
    expect(result.valid).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(validatePasswordStrength(null).valid).toBe(false);
    expect(validatePasswordStrength(undefined).valid).toBe(false);
  });
});

describe('checkAccountLockout', () => {
  it('returns not locked when lockedUntil is null', () => {
    const result = checkAccountLockout({ lockedUntil: null });
    expect(result.locked).toBe(false);
  });

  it('returns not locked when lock has expired', () => {
    const past = new Date(Date.now() - 60 * 1000);
    const result = checkAccountLockout({ lockedUntil: past });
    expect(result.locked).toBe(false);
  });

  it('returns locked with remaining minutes when lock is active', () => {
    const future = new Date(Date.now() + 30 * 60 * 1000);
    const result = checkAccountLockout({ lockedUntil: future });
    expect(result.locked).toBe(true);
    expect(result.remainingMinutes).toBeGreaterThan(0);
  });
});
