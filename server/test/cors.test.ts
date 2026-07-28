import { describe, it, expect } from 'vitest';
import { parseOrigins, isOriginAllowed } from '../src/cors.js';

describe('parseOrigins', () => {
  it('returns null when unset or empty', () => {
    expect(parseOrigins(undefined)).toBeNull();
    expect(parseOrigins('')).toBeNull();
    expect(parseOrigins('   ')).toBeNull();
  });

  it('splits on commas and trims', () => {
    expect(parseOrigins('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('drops empty entries', () => {
    expect(parseOrigins('https://a.com,,')).toEqual(['https://a.com']);
  });
});

describe('isOriginAllowed', () => {
  it('allows requests without an Origin header (not a browser)', () => {
    expect(isOriginAllowed(undefined, null)).toBe(true);
    expect(isOriginAllowed(undefined, ['https://a.com'])).toBe(true);
  });

  it('default policy allows localhost on any port', () => {
    expect(isOriginAllowed('http://localhost:8100', null)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3000', null)).toBe(true);
    expect(isOriginAllowed('https://localhost', null)).toBe(true);
  });

  it('default policy rejects non-local origins', () => {
    expect(isOriginAllowed('https://evil.com', null)).toBe(false);
    // hostname deve bater exatamente: não basta conter "localhost"
    expect(isOriginAllowed('https://localhost.evil.com', null)).toBe(false);
  });

  it('explicit list matches exactly', () => {
    const list = ['https://app.com'];
    expect(isOriginAllowed('https://app.com', list)).toBe(true);
    expect(isOriginAllowed('https://other.com', list)).toBe(false);
    expect(isOriginAllowed('http://localhost:8100', list)).toBe(false);
  });

  it('malformed origin is rejected under the default policy', () => {
    expect(isOriginAllowed('not-a-url', null)).toBe(false);
  });
});
