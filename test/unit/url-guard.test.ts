import { describe, expect, it } from 'vitest';
import { assertSafePublicUrl, isSafePublicUrl } from '../../src/utils/url-guard.js';

const STRICT = { allowPrivateTargets: false };
const PERMISSIVE = { allowPrivateTargets: true };

describe('assertSafePublicUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(assertSafePublicUrl('https://example.com/page', STRICT).hostname).toBe('example.com');
    expect(assertSafePublicUrl('http://example.com:8080/a?b=c', STRICT).hostname).toBe(
      'example.com',
    );
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertSafePublicUrl('ftp://example.com', STRICT)).toThrowError(/http/);
    expect(() => assertSafePublicUrl('file:///etc/passwd', STRICT)).toThrowError(/http/);
    expect(() => assertSafePublicUrl('javascript:alert(1)', STRICT)).toThrowError();
  });

  it('rejects malformed URLs', () => {
    expect(() => assertSafePublicUrl('not a url', STRICT)).toThrowError();
    expect(() => assertSafePublicUrl('', STRICT)).toThrowError();
  });

  it('rejects URLs with embedded credentials', () => {
    expect(() => assertSafePublicUrl('https://user:pass@example.com', STRICT)).toThrowError(
      /credentials/,
    );
  });

  it('blocks localhost and internal-looking hostnames', () => {
    const blocked = [
      'http://localhost/',
      'http://localhost:3000/health',
      'http://LOCALHOST:3000/',
      'http://foo.localhost/',
      'http://app.local/',
      'http://service.internal/',
      'http://host.localdomain/',
    ];
    for (const url of blocked) {
      expect(() => assertSafePublicUrl(url, STRICT), url).toThrowError();
    }
  });

  it('blocks loopback and private IPv4 literals', () => {
    const blocked = [
      'http://127.0.0.1/',
      'http://127.0.0.1:8931/page.html',
      'http://0.0.0.0/',
      'http://10.1.2.3/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.10/',
      'http://169.254.169.254/', // cloud metadata endpoint
      'http://100.64.0.1/',
      'http://224.0.0.1/',
    ];
    for (const url of blocked) {
      expect(() => assertSafePublicUrl(url, STRICT), url).toThrowError();
    }
  });

  it('allows public IPv4 addresses just outside private ranges', () => {
    const allowed = [
      'http://11.0.0.1/',
      'http://172.32.0.1/',
      'http://172.15.255.255/',
      'http://192.169.1.1/',
      'http://8.8.8.8/',
    ];
    for (const url of allowed) {
      expect(isSafePublicUrl(url, STRICT), url).toBe(true);
    }
  });

  it('blocks IPv6 loopback, unspecified, unique-local and link-local', () => {
    const blocked = [
      'http://[::1]/',
      'http://[::]/',
      'http://[fc00::1]/',
      'http://[fd12:3456:789a::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:192.168.0.1]/',
    ];
    for (const url of blocked) {
      expect(() => assertSafePublicUrl(url, STRICT), url).toThrowError();
    }
  });

  it('allows public IPv6 addresses', () => {
    expect(isSafePublicUrl('http://[2606:4700::1111]/', STRICT)).toBe(true);
    expect(isSafePublicUrl('http://[::ffff:8.8.8.8]/', STRICT)).toBe(true);
  });

  it('allowPrivateTargets=true permits local targets (dev/test/demo only)', () => {
    expect(assertSafePublicUrl('http://127.0.0.1:8931/page.html', PERMISSIVE).port).toBe('8931');
    expect(isSafePublicUrl('http://localhost:3000/health', PERMISSIVE)).toBe(true);
  });

  it('still enforces scheme and credential rules when private targets are allowed', () => {
    expect(() => assertSafePublicUrl('file:///etc/passwd', PERMISSIVE)).toThrowError();
    expect(() => assertSafePublicUrl('https://u:p@example.com', PERMISSIVE)).toThrowError();
  });
});
