import { Resolver } from 'node:dns/promises';
import { AppError } from '../domain/errors.js';
import { isBlockedIpAddress } from './url-guard.js';

export interface HostResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

/**
 * Second SSRF layer: resolves the hostname and rejects targets whose A/AAAA
 * records point at loopback, private, link-local, CGNAT or otherwise reserved
 * addresses. All returned addresses are checked (a host with one public and
 * one private IP is rejected — fail closed).
 *
 * Remaining limitation (documented in the README): the browser connects after
 * this check, so an attacker-controlled DNS server can still return different
 * answers per lookup (TOCTOU/rebinding). This layer closes the trivial
 * "public hostname → 127.0.0.1" gap, not adversarial DNS.
 */
export async function assertPublicDnsResolution(
  hostname: string,
  options: { resolver: HostResolver },
): Promise<void> {
  const settled = await Promise.allSettled([
    options.resolver.resolve4(hostname),
    options.resolver.resolve6(hostname),
  ]);

  const addresses: string[] = [];
  let anyLookupSucceeded = false;
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      anyLookupSucceeded = true;
      addresses.push(...result.value);
    }
  }

  // Resolver failure/timeout for the hostname as a whole: refuse with a safe
  // message (no resolver internals like ENOTFOUND leak into responses).
  if (!anyLookupSucceeded) {
    throw new AppError('DNS_ERROR', 'The target hostname could not be resolved.');
  }

  if (addresses.some((ip) => isBlockedIpAddress(ip))) {
    throw new AppError(
      'URL_NOT_ALLOWED',
      'The target hostname resolves to a private, loopback or otherwise reserved address.',
    );
  }
}

export function createSystemResolver(timeoutMs: number): HostResolver {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  return {
    resolve4: (hostname) => resolver.resolve4(hostname),
    resolve6: (hostname) => resolver.resolve6(hostname),
  };
}
