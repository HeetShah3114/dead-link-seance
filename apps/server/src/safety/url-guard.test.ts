import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkTargetUrl, isArchiveUrl, assertArchiveUrl, OutboundBlockedError } from './url-guard.js';

const reason = (u: unknown) => {
  const r = checkTargetUrl(u);
  return r.ok ? 'ok' : r.reason;
};

describe('checkTargetUrl', () => {
  it('accepts ordinary dead-site urls, including ones that no longer resolve', () => {
    for (const u of [
      'http://www.geocities.com/Hollywood/Hills/',
      'https://example.com/',
      'http://www.angelfire.com/ca/',
      'http://93.184.216.34/page.html',
      'http://[2606:4700::1111]/',
      'http://some-long-gone-domain-xyz.com/',
    ]) {
      expect(reason(u)).toBe('ok');
    }
  });

  it('rejects non-urls, bad schemes, credentials and huge input', () => {
    expect(reason(undefined)).toBe('not_a_url');
    expect(reason(42)).toBe('not_a_url');
    expect(reason('')).toBe('not_a_url');
    expect(reason('nonsense')).toBe('not_a_url');
    expect(reason('ftp://a.com/')).toBe('bad_scheme');
    expect(reason('file:///etc/passwd')).toBe('bad_scheme');
    expect(reason('javascript:alert(1)')).toBe('bad_scheme');
    expect(reason('http://user:pw@a.com/')).toBe('has_credentials');
    expect(reason(`http://a.com/${'x'.repeat(3000)}`)).toBe('too_long');
  });

  it('rejects local names', () => {
    for (const u of ['http://localhost/', 'http://LOCALHOST:8080/', 'http://app.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://intranet/', 'http://localhost./']) {
      expect(reason(u)).toBe('local_name');
    }
  });

  it('rejects private, loopback, link-local and metadata IPv4 in every spelling', () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://2130706433/', // 127.0.0.1 as an integer
      'http://0x7f.1/', // hex
      'http://0177.0.0.1/', // octal
      'http://127.1/', // short form
      'http://224.0.0.1/',
    ]) {
      expect(reason(u), u).toBe('private_address');
    }
  });

  it('allows public addresses right next to private ranges', () => {
    for (const u of ['http://172.15.0.1/', 'http://172.32.0.1/', 'http://100.63.0.1/', 'http://11.0.0.1/', 'http://192.169.0.1/']) {
      expect(reason(u), u).toBe('ok');
    }
  });

  it('rejects private and special IPv6, including IPv4-mapped forms', () => {
    for (const u of [
      'http://[::1]/',
      'http://[::]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[64:ff9b::a9fe:a9fe]/',
      'http://[ff02::1]/',
    ]) {
      expect(reason(u), u).toBe('private_address');
    }
  });

  it('property: every private IPv4, in dotted, integer or hex form, is rejected', () => {
    const privateV4 = fc.oneof(
      fc.tuple(fc.constant(10), fc.nat(255), fc.nat(255), fc.nat(255)),
      fc.tuple(fc.constant(127), fc.nat(255), fc.nat(255), fc.nat(255)),
      fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), fc.nat(255), fc.nat(255)),
      fc.tuple(fc.constant(192), fc.constant(168), fc.nat(255), fc.nat(255)),
      fc.tuple(fc.constant(169), fc.constant(254), fc.nat(255), fc.nat(255)),
      fc.tuple(fc.constant(100), fc.integer({ min: 64, max: 127 }), fc.nat(255), fc.nat(255)),
    );
    fc.assert(
      fc.property(privateV4, fc.constantFrom('dotted', 'int', 'hex'), ([a, b, c, d], form) => {
        const n = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
        const host = form === 'dotted' ? `${a}.${b}.${c}.${d}` : form === 'int' ? String(n) : `0x${n.toString(16)}`;
        return reason(`http://${host}/x`) === 'private_address';
      }),
    );
  });

  it('property: IPv4-mapped IPv6 of a private IPv4 is rejected', () => {
    fc.assert(
      fc.property(fc.nat(255), fc.nat(255), fc.nat(255), (b, c, d) => {
        return reason(`http://[::ffff:10.${b}.${c}.${d}]/`) === 'private_address' && reason(`http://[::ffff:127.${b}.${c}.${d}]/`) === 'private_address';
      }),
    );
  });

  it('property: never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.webUrl(), fc.anything()), (v) => {
        checkTargetUrl(v);
        return true;
      }),
    );
  });
});

describe('archive allow-list', () => {
  it('allows only https archive hosts', () => {
    expect(isArchiveUrl('https://web.archive.org/web/2003id_/http://a.com/')).toBe(true);
    expect(isArchiveUrl('https://archive.org/wayback/available?url=a.com')).toBe(true);
    for (const u of [
      'http://web.archive.org/web/2003/http://a.com/',
      'https://web.archive.org.evil.com/',
      'https://evil.com/web.archive.org',
      'https://user@web.archive.org/',
      'https://web.archive.org:8443/',
      'https://169.254.169.254/',
      'not a url',
    ]) {
      expect(isArchiveUrl(u), u).toBe(false);
    }
  });

  it('assertArchiveUrl throws OutboundBlockedError', () => {
    expect(() => assertArchiveUrl('http://127.0.0.1/')).toThrow(OutboundBlockedError);
    expect(() => assertArchiveUrl('https://web.archive.org/x')).not.toThrow();
  });
});
