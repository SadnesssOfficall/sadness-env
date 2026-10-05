import { describe, expect, it } from 'vitest';
import { displayValue, isSecret, MASK, maskValue } from '../src/secrets.js';

describe('isSecret', () => {
  it('flags conventional secret names', () => {
    for (const key of [
      'JWT_SECRET',
      'GITHUB_TOKEN',
      'DB_PASSWORD',
      'STRIPE_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'PRIVATE_KEY',
      'API_KEY',
      'KEY',
      'SESSION_COOKIE',
      'SENTRY_DSN',
      'REDIS_PASS',
      'jwt_secret',
    ]) {
      expect(isSecret(key), key).toBe(true);
    }
  });

  it('leaves ordinary names alone', () => {
    for (const key of ['PORT', 'NODE_ENV', 'AUTHOR', 'KEYBOARD_LAYOUT', 'PASSTHROUGH', 'HOST']) {
      expect(isSecret(key), key).toBe(false);
    }
  });

  it('flags urls that carry a password', () => {
    expect(isSecret('DATABASE_URL', undefined, 'postgres://app:s3cret@db:5432/app')).toBe(true);
    expect(isSecret('DATABASE_URL', undefined, 'postgres://app@db:5432/app')).toBe(false);
    expect(isSecret('HOMEPAGE', undefined, 'https://example.com')).toBe(false);
    expect(isSecret('BROKEN', undefined, 'http://[::1')).toBe(false);
  });

  it('lets the schema override the heuristics in both directions', () => {
    expect(isSecret('PORT', { type: 'port', secret: true })).toBe(true);
    expect(isSecret('PUBLIC_KEY', { type: 'string', secret: false })).toBe(false);
    expect(isSecret('DATABASE_URL', { type: 'url', secret: false }, 'x://u:p@h')).toBe(false);
  });
});

describe('maskValue', () => {
  it('hides length and content', () => {
    expect(maskValue('a')).toBe(MASK);
    expect(maskValue('a-very-long-secret-value')).toBe(MASK);
  });

  it('distinguishes empty values', () => {
    expect(maskValue('')).toBe('(empty)');
  });
});

describe('displayValue', () => {
  it('quotes and escapes control characters', () => {
    expect(displayValue('a\nb\u001b[31m')).toBe('"a\\nb\\u001b[31m"');
  });

  it('escapes invisible and bidirectional characters', () => {
    expect(displayValue('a\u202eb\u200bc\u009bd\u007f')).toBe('"a\\u202eb\\u200bc\\u009bd\\u007f"');
  });

  it('truncates long values', () => {
    const shown = displayValue('x'.repeat(500));
    expect(shown.length).toBeLessThan(70);
    expect(shown.endsWith('…"')).toBe(true);
  });
});
