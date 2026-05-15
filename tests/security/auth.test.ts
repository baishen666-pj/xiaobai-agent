import { describe, it, expect } from 'vitest';
import { safeEqualSecret, isLocalDirectRequest, createAuthChecker } from '../../src/security/auth.js';

describe('safeEqualSecret', () => {
  it('returns true for equal strings', () => {
    expect(safeEqualSecret('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(safeEqualSecret('hello', 'world')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(safeEqualSecret('short', 'much-longer-string')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(safeEqualSecret('', '')).toBe(true);
    expect(safeEqualSecret('', 'a')).toBe(false);
  });
});

describe('isLocalDirectRequest', () => {
  function mockReq(remoteAddress: string, host: string) {
    return {
      socket: { remoteAddress },
      headers: { host },
    } as any;
  }

  it('identifies localhost IPv4 requests', () => {
    expect(isLocalDirectRequest(mockReq('127.0.0.1', 'localhost:3001'))).toBe(true);
  });

  it('identifies localhost IPv6 requests', () => {
    expect(isLocalDirectRequest(mockReq('::1', '[::1]:3001'))).toBe(true);
  });

  it('rejects remote requests', () => {
    expect(isLocalDirectRequest(mockReq('192.168.1.1', 'example.com'))).toBe(false);
  });

  it('rejects localhost IP with non-local Host header', () => {
    expect(isLocalDirectRequest(mockReq('127.0.0.1', 'evil.com:3001'))).toBe(false);
  });
});

describe('createAuthChecker', () => {
  it('allows all when no auth configured', () => {
    const check = createAuthChecker({});
    expect(check({ socket: { remoteAddress: '192.168.1.1' }, headers: {} } as any)).toBe(true);
  });

  it('validates Bearer token', () => {
    const check = createAuthChecker({ token: 'my-secret-token' });
    const req = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { authorization: 'Bearer my-secret-token' },
    } as any;
    expect(check(req)).toBe(true);
  });

  it('rejects wrong token', () => {
    const check = createAuthChecker({ token: 'my-secret-token' });
    const req = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { authorization: 'Bearer wrong-token' },
    } as any;
    expect(check(req)).toBe(false);
  });

  it('allows localhost without auth', () => {
    const check = createAuthChecker({ token: 'my-secret-token' });
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost:3001' },
    } as any;
    expect(check(req)).toBe(true);
  });

  it('validates Basic password', () => {
    const check = createAuthChecker({ password: 'mypassword' });
    const encoded = Buffer.from('user:mypassword').toString('base64');
    const req = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { authorization: `Basic ${encoded}` },
    } as any;
    expect(check(req)).toBe(true);
  });
});
