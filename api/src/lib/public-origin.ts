import { isIP } from 'node:net';

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .toLowerCase()
    .replace(/^\[/u, '')
    .replace(/\]$/u, '')
    .replace(/\.+$/u, '');

  if (normalizedHostname === 'localhost' || normalizedHostname === '::1') {
    return true;
  }

  if (isIP(normalizedHostname) === 4) {
    return normalizedHostname.startsWith('127.');
  }

  // WHATWG URL canonicalizes IPv4-mapped loopback addresses to hexadecimal
  // IPv6 notation, e.g. ::ffff:127.0.0.1 -> ::ffff:7f00:1.
  const mappedLoopbackMatch = normalizedHostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (!mappedLoopbackMatch || isIP(normalizedHostname) !== 6) {
    return false;
  }

  const firstMappedOctet = Number.parseInt(mappedLoopbackMatch[1], 16) >> 8;
  return firstMappedOctet === 0x7f;
}

/**
 * Accept only an absolute HTTP(S) origin with no userinfo, path, query, or
 * fragment. The raw suffix check is intentional: URL normalizes dot segments
 * such as /./ and /%2e%2e to /, but those inputs are still paths and must not
 * be accepted where an origin is required.
 */
export function resolveBareHttpOrigin(value: string, errorMessage: string): string {
  // Do not let URL or String#trim normalize raw input before validation. A
  // bare origin has no leading/trailing whitespace, and controls are rejected
  // explicitly because WHATWG URL otherwise removes some of them.
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(errorMessage);
  }

  const rawValue = value;

  // WHATWG URL treats backslashes as HTTP path separators. Reject them before
  // parsing so an input that is not an origin cannot be normalized into one.
  if (rawValue.includes('\\')) {
    throw new Error(errorMessage);
  }

  let parsed: URL;

  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(errorMessage);
  }

  const schemeSeparator = rawValue.indexOf('://');
  const authorityStart = schemeSeparator + 3;
  const remainder = schemeSeparator >= 0 ? rawValue.slice(authorityStart) : '';
  const suffixOffset = remainder.search(/[/?#]/u);
  const authority = suffixOffset === -1 ? remainder : remainder.slice(0, suffixOffset);
  const suffix = suffixOffset === -1 ? '' : remainder.slice(suffixOffset);
  const defaultPort = parsed.protocol === 'http:' ? ':80' : ':443';
  const authorityWithoutDefaultPort = authority.toLowerCase().endsWith(defaultPort)
    ? authority.slice(0, -defaultPort.length).toLowerCase()
    : authority.toLowerCase();

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    schemeSeparator < 0 ||
    parsed.username ||
    parsed.password ||
    authority.includes('@') ||
    suffix.includes('?') ||
    suffix.includes('#') ||
    (suffix !== '' && suffix !== '/') ||
    // Reject raw authority spellings that WHATWG canonicalizes (for example
    // percent-encoded hosts, invisible Unicode characters, IDNs, or expanded
    // IPv6). Only case and an explicit default port may normalize here.
    authorityWithoutDefaultPort !== parsed.host.toLowerCase()
  ) {
    throw new Error(errorMessage);
  }

  return parsed.origin;
}
