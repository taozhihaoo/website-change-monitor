import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors.js';
import {
  assertPublicDnsResolution,
  type HostResolver,
} from '../../src/utils/dns-guard.js';
import { isBlockedIpAddress } from '../../src/utils/url-guard.js';

function resolverFrom(
  v4: string[] | ((hostname: string) => Promise<string[]>),
  v6: string[] = [],
): HostResolver {
  const resolve4 =
    typeof v4 === 'function' ? v4 : async () => v4;
  return { resolve4, resolve6: async () => v6 };
}

async function expectBlocked(
  resolver: HostResolver,
  hostname = 'target.example.com',
): Promise<void> {
  await expect(assertPublicDnsResolution(hostname, { resolver })).rejects.toMatchObject({
    code: 'URL_NOT_ALLOWED',
  });
}

describe('DNS-level SSRF guard (mock resolver, fully offline)', () => {
  it('blocks hostnames resolving to loopback IPv4', async () => {
    await expectBlocked(resolverFrom(['127.0.0.1']));
    await expectBlocked(resolverFrom(['127.8.8.8']));
  });

  it('blocks hostnames resolving to private / link-local / CGNAT IPv4', async () => {
    await expectBlocked(resolverFrom(['10.1.2.3']));
    await expectBlocked(resolverFrom(['192.168.0.20']));
    await expectBlocked(resolverFrom(['172.16.9.9']));
    await expectBlocked(resolverFrom(['169.254.169.254'])); // cloud metadata
    await expectBlocked(resolverFrom(['100.64.0.7']));
    await expectBlocked(resolverFrom(['0.0.0.0']));
  });

  it('blocks hostnames resolving to loopback / private IPv6', async () => {
    await expectBlocked(resolverFrom([], ['::1']));
    await expectBlocked(resolverFrom([], ['fd12::1']));
    await expectBlocked(resolverFrom([], ['fe80::1']));
  });

  it('allows hostnames resolving to public addresses only', async () => {
    await expect(
      assertPublicDnsResolution('ok.example.com', {
        resolver: resolverFrom(['93.184.216.34']),
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertPublicDnsResolution('ok.example.com', {
        resolver: resolverFrom([], ['2606:4700::1111']),
      }),
    ).resolves.toBeUndefined();
  });

  it('checks ALL A/AAAA records — one private address blocks the host', async () => {
    await expectBlocked(resolverFrom(['93.184.216.34', '10.0.0.1']));
    await expectBlocked(resolverFrom(['93.184.216.34'], ['fd00::5']));
  });

  it('maps resolution failure to a safe DNS_ERROR without resolver internals', async () => {
    const failing: HostResolver = {
      resolve4: async () => {
        throw new Error('query ENOTFOUND private.example.com');
      },
      resolve6: async () => {
        throw new Error('query ENOTFOUND private.example.com');
      },
    };
    const err = await assertPublicDnsResolution('private.example.com', {
      resolver: failing,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('DNS_ERROR');
    expect((err as AppError).message).not.toContain('ENOTFOUND');
    expect((err as AppError).message).not.toContain('private.example.com');
  });

  it('treats resolver timeout (rejected lookup) like any resolution failure', async () => {
    const slow: HostResolver = {
      resolve4: () =>
        new Promise<string[]>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Lookup timed out')), 20);
        }),
      resolve6: async () => [],
    };
    await expect(assertPublicDnsResolution('slow.example.com', { resolver: slow })).rejects.toMatchObject(
      { code: 'DNS_ERROR' },
    );
  });

  it('treats empty record sets as unresolvable', async () => {
    await expect(
      assertPublicDnsResolution('empty.example.com', { resolver: resolverFrom([]) }),
    ).rejects.toMatchObject({ code: 'DNS_ERROR' });
  });

  describe('isBlockedIpAddress dispatcher', () => {
    it('dispatches IPv4 and IPv6 literals', () => {
      expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
      expect(isBlockedIpAddress('192.168.1.1')).toBe(true);
      expect(isBlockedIpAddress('8.8.8.8')).toBe(false);
      expect(isBlockedIpAddress('::1')).toBe(true);
      expect(isBlockedIpAddress('fe80::1')).toBe(true);
      expect(isBlockedIpAddress('2606:4700::1111')).toBe(false);
      expect(isBlockedIpAddress('::ffff:127.0.0.1')).toBe(true);
    });
  });
});
