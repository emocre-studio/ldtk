import { HttpError } from '../errors.js';

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Validates that a route param is safe to use as a filesystem path segment.
 * Express percent-decodes params before handlers see them, so without this
 * check values like `..%2F..%2Fpwned` become `../../pwned` and can escape
 * the storage root. Throws HttpError(400, 'invalid_id', ...) if unsafe.
 */
export function safeSegment(name: string, kind: string): string {
  if (!SAFE_SEGMENT.test(name)) {
    // Sem ecoar `name`: refletir input do cliente na resposta é hábito ruim.
    throw new HttpError(
      400,
      'invalid_id',
      `Invalid ${kind}: expected letters, digits, hyphen or underscore`,
    );
  }
  return name;
}
