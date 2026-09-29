import { AppError } from '../domain/errors.js';

export interface UrlGuardOptions {
  /**
   * When true, localhost / private-network targets are allowed. This exists
   * ONLY for development, tests and the offline demo against local fixture
   * pages. It must never be enabled on a deployment you do not fully control.
   */
  allowPrivateTargets: boolean;
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal'];

interface IpRange {
  name: string;
  matches: (parts: number[]) => boolean;
}

const BLOCKED_IPV4_RANGES: IpRange[] = [
  { name: 'this-network (0.0.0.0/8)', matches: (p) => (p[0] ?? -1) === 0 },
  { name: 'private (10.0.0.0/8)', matches: (p) => (p[0] ?? -1) === 10 },
  {
    name: 'CGNAT (100.64.0.0/10)',
    matches: (p) => (p[0] ?? -1) === 100 && (p[1] ?? -1) >= 64 && (p[1] ?? -1) <= 127,
  },
  { name: 'loopback (127.0.0.0/8)', matches: (p) => (p[0] ?? -1) === 127 },
  {
    name: 'link-local (169.254.0.0/16)',
    matches: (p) => (p[0] ?? -1) === 169 && (p[1] ?? -1) === 254,
  },
  {
    name: 'private (172.16.0.0/12)',
    matches: (p) => (p[0] ?? -1) === 172 && (p[1] ?? -1) >= 16 && (p[1] ?? -1) <= 31,
  },
  {
    name: 'private (192.168.0.0/16)',
    matches: (p) => (p[0] ?? -1) === 192 && (p[1] ?? -1) === 168,
  },
  { name: 'multicast/reserved (>= 224.0.0.0)', matches: (p) => (p[0] ?? -1) >= 224 },
];

/**
 * Validates a user-supplied URL for monitoring.
 *
 * Only public http(s) URLs are allowed. The guard blocks localhost, common
 * internal hostnames, loopback/private/link-local IPv4 and IPv6 literals and
 * IPv4-mapped IPv6 addresses. DNS-level (rebinding) protection is out of scope
 * for v1 and documented as a limitation.
 *
 * Throws INVALID_URL for malformed input and URL_NOT_ALLOWED for blocked
 * targets.
 */
export function assertSafePublicUrl(input: string, options: UrlGuardOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new AppError('INVALID_URL', 'The provided value is not a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('INVALID_URL', 'Only http and https URLs are supported.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new AppError('INVALID_URL', 'URLs with embedded credentials are not allowed.');
  }

  if (options.allowPrivateTargets) {
    return parsed;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new AppError('URL_NOT_ALLOWED', blockedTargetMessage());
  }

  if (host.startsWith('[')) {
    // WHATWG URL keeps the brackets in hostname for IPv6 literals.
    const bare = host.endsWith(']') ? host.slice(1, -1) : host;
    if (isBlockedIpv6(bare)) {
      throw new AppError('URL_NOT_ALLOWED', blockedTargetMessage());
    }
  } else if (isIpv4(host)) {
    if (isBlockedIpv4(host)) {
      throw new AppError('URL_NOT_ALLOWED', blockedTargetMessage());
    }
  }

  return parsed;
}

export function isSafePublicUrl(input: string, options: UrlGuardOptions): boolean {
  try {
    assertSafePublicUrl(input, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classifies a parsed IP literal (IPv4 or IPv6) against the blocked ranges.
 * Used by the URL guard for literals and by the DNS guard for resolved
 * addresses.
 */
export function isBlockedIpAddress(ip: string): boolean {
  if (ip.includes(':')) {
    return isBlockedIpv6(ip);
  }
  return isBlockedIpv4(ip);
}

function blockedTargetMessage(): string {
  return (
    'Monitoring localhost, private-network or link-local targets is not allowed. ' +
    'This tool is intended for public web pages and resources you are authorized to access.'
  );
}

function isIpv4(host: string): boolean {
  return /^\d+(\.\d+)*$/.test(host);
}

function parseIpv4(host: string): number[] | null {
  const segments = host.split('.').map((segment) => Number.parseInt(segment, 10));
  if (segments.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return null;
  }
  if (segments.length === 4) {
    return segments;
  }
  if (segments.length === 0 || segments.length > 4) {
    return null;
  }
  // Tolerate shortened forms such as "127.1" (WHATWG URL usually normalizes
  // these already, this is defense in depth): pad with zeros before the last
  // group, e.g. 127.1 -> 127.0.0.1.
  const head = segments.slice(0, -1);
  const last = segments[segments.length - 1] ?? 0;
  const parts = [...head];
  while (parts.length < 3) {
    parts.push(0);
  }
  parts.push(last);
  return parts;
}

function isBlockedIpv4(host: string): boolean {
  const parts = parseIpv4(host);
  if (parts === null) {
    return false;
  }
  return BLOCKED_IPV4_RANGES.some((range) => range.matches(parts));
}

function isBlockedIpv6(host: string): boolean {
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const mappedV4 = mapped?.[1];
  if (mappedV4 !== undefined) {
    return isBlockedIpv4(mappedV4);
  }

  let groups: number[];
  const compressed = host.split('::');
  if (compressed.length === 2) {
    const headGroups = (compressed[0] ?? '')
      .split(':')
      .filter((part) => part.length > 0)
      .map(parseHexGroup);
    const tailGroups = (compressed[1] ?? '')
      .split(':')
      .filter((part) => part.length > 0)
      .map(parseHexGroup);
    if (headGroups.includes(null) || tailGroups.includes(null)) {
      return true; // unparsable — fail closed
    }
    const fill = 8 - (headGroups.length + tailGroups.length);
    if (fill < 0) {
      return true;
    }
    groups = [
      ...headGroups.map((g) => g ?? 0),
      ...Array<number>(fill).fill(0),
      ...tailGroups.map((g) => g ?? 0),
    ];
  } else if (compressed.length === 1) {
    const parsed = host.split(':').map(parseHexGroup);
    if (parsed.includes(null) || parsed.length !== 8) {
      return true; // unparsable or malformed — fail closed
    }
    groups = parsed.map((g) => g ?? 0);
  } else {
    return true; // multiple "::" — invalid — fail closed
  }

  const first = groups[0] ?? 0;
  const loopback = groups.every((g, i) => (i === 7 ? g === 1 : g === 0));
  const unspecified = groups.every((g) => g === 0);
  const uniqueLocal = (first & 0xfe00) === 0xfc00; // fc00::/7
  const linkLocal = (first & 0xffc0) === 0xfe80; // fe80::/10

  // IPv4-mapped ::ffff:0:0/96 — WHATWG URL canonicalizes to hex form
  // (::ffff:8.8.8.8 becomes ::ffff:808:808), so decode the embedded IPv4 and
  // apply the IPv4 rules to it.
  let v4Mapped = false;
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] ?? 0) === 0xffff) {
    const g6 = groups[6] ?? 0;
    const g7 = groups[7] ?? 0;
    const embeddedV4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    v4Mapped = isBlockedIpv4(embeddedV4);
  }

  return loopback || unspecified || uniqueLocal || linkLocal || v4Mapped;
}

function parseHexGroup(group: string): number | null {
  if (!/^[0-9a-f]{1,4}$/i.test(group)) {
    return null;
  }
  return Number.parseInt(group, 16);
}
