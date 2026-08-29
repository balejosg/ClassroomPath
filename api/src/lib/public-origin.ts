/**
 * Accept only an absolute HTTP(S) origin with no userinfo, path, query, or
 * fragment. The raw suffix check is intentional: URL normalizes dot segments
 * such as /./ and /%2e%2e to /, but those inputs are still paths and must not
 * be accepted where an origin is required.
 */
export function resolveBareHttpOrigin(value: string, errorMessage: string): string {
  const rawValue = value.trim();
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

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    schemeSeparator < 0 ||
    parsed.username ||
    parsed.password ||
    authority.includes('@') ||
    suffix.includes('?') ||
    suffix.includes('#') ||
    (suffix !== '' && suffix !== '/')
  ) {
    throw new Error(errorMessage);
  }

  return parsed.origin;
}
