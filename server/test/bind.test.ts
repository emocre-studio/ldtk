import { describe, it, expect } from 'vitest';
import { resolveBindHost, isLoopback, exposureWarning } from '../src/bind.js';

describe('resolveBindHost', () => {
  it('defaults to loopback', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1');
    expect(resolveBindHost({ BIND_HOST: '' })).toBe('127.0.0.1');
  });

  it('uses BIND_HOST when set', () => {
    expect(resolveBindHost({ BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ BIND_HOST: '192.168.1.10' })).toBe('192.168.1.10');
  });
});

describe('isLoopback', () => {
  it('recognises loopback hosts', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
  });

  it('treats anything else as exposed', () => {
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(isLoopback('192.168.1.10')).toBe(false);
  });
});

describe('exposureWarning', () => {
  it('is silent on loopback', () => {
    expect(exposureWarning('127.0.0.1', 4000)).toBeNull();
  });

  it('warns about the missing authentication when exposed', () => {
    const msg = exposureWarning('0.0.0.0', 4000);
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain('autentica');
  });
});
