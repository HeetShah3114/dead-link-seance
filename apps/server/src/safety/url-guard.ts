// URL safety (R1.2, R11.2).
//
// We never fetch the user's URL. It is only sent to the Wayback Machine as a query value.
// So the guard has two parts:
//  1. checkTargetUrl: reject input that names a private, loopback or local target, so the
//     app never resurrects (and publicly re-hosts) an internal page someone found in the archive.
//  2. assertArchiveUrl: every outbound request, including each redirect hop, must go to an
//     allow-listed archive host over https. This is what actually stops SSRF.
// No DNS lookup on the user's host: dead sites usually no longer resolve.

export type GuardReason =
  | 'not_a_url'
  | 'bad_scheme'
  | 'has_credentials'
  | 'too_long'
  | 'local_name'
  | 'private_address';

export type GuardResult = { ok: true; url: URL } | { ok: false; reason: GuardReason };

export const MAX_URL_LENGTH = 2048;

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

/** Parse dotted IPv4 (already normalized by the WHATWG URL parser) into 4 octets. */
function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

/** True for any IPv4 address that is not on the public internet. */
export function isNonPublicIPv4(o: number[]): boolean {
  const [a, b] = o as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0) || // IETF / TEST-NET-1
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51) || // TEST-NET-2
    (a === 203 && b === 0) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expand an IPv6 literal (no brackets) to 8 16-bit groups. */
function ipv6Groups(host: string): number[] | null {
  let h = host.toLowerCase();
  // Embedded IPv4 tail, e.g. ::ffff:1.2.3.4
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (tail) {
    const o = ipv4Octets(tail[1]!);
    if (!o) return null;
    h = h.slice(0, -tail[1]!.length) + `${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === '' ? [] : s.split(':').map((g) => parseInt(g, 16)));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array(Math.max(fill, 0)).fill(0), ...rest];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** True for any IPv6 address that is not global unicast on the public internet. */
export function isNonPublicIPv6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const allZeroTo5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (allZeroTo5 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if (allZeroTo5 && (g5 === 0xffff || g5 === 0)) {
    // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d)
    return isNonPublicIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if (g0 === 0x64 && g1 === 0xff9b) return isNonPublicIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]); // NAT64
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

/** Check a user-supplied site URL before any job is created. */
export function checkTargetUrl(input: unknown): GuardResult {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: 'not_a_url' };
  if (input.length > MAX_URL_LENGTH) return { ok: false, reason: 'too_long' };
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'not_a_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'bad_scheme' };
  if (url.username || url.password) return { ok: false, reason: 'has_credentials' };

  // The URL parser already normalizes 2130706433, 0x7f.1, 0177.0.0.1 etc. to dotted IPv4.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'not_a_url' };

  if (host.startsWith('[') && host.endsWith(']')) {
    const g = ipv6Groups(host.slice(1, -1));
    if (!g || isNonPublicIPv6(g)) return { ok: false, reason: 'private_address' };
    return { ok: true, url };
  }
  const v4 = ipv4Octets(host);
  if (v4) return isNonPublicIPv4(v4) ? { ok: false, reason: 'private_address' } : { ok: true, url };

  if (host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'local_name' };
  // Single-label names ("intranet", "router") only exist on private networks.
  if (!host.includes('.')) return { ok: false, reason: 'local_name' };
  return { ok: true, url };
}

/** Hosts the server may send requests to. Everything else is refused. */
export const ARCHIVE_HOSTS = new Set(['web.archive.org', 'archive.org']);

export class OutboundBlockedError extends Error {
  constructor(public readonly target: string) {
    super('Outbound request blocked: not an allow-listed archive URL');
    this.name = 'OutboundBlockedError';
  }
}

export function isArchiveUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && u.port === '' && ARCHIVE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertArchiveUrl(value: string): void {
  if (!isArchiveUrl(value)) throw new OutboundBlockedError(value);
}
