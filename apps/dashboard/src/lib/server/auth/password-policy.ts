// P-2 (Grok + Codex security review, 2026-09-01). Registration and password
// reset accepted any 8-character string, including "password". Two problems:
// no floor against the most-abused passwords, and bcrypt silently ignores bytes
// past its 72-byte boundary, so two long passwords that share a 72-byte prefix
// authenticate interchangeably. This is the single validation used by both the
// register and reset endpoints.
//
// The denylist is intentionally lightweight (no heavy dependency / wordlist
// asset): the 8-char floor already removes the shortest guesses, so this targets
// the common 8+ character passwords that a floor alone lets through. It is a
// floor, not a strength meter.

const MIN_LENGTH = 8;
// bcrypt truncates at 72 BYTES (not characters). Reject longer input so a
// truncation collision cannot happen; multibyte passphrases are measured in
// bytes, matching what bcrypt actually consumes.
const MAX_BYTES = 72;

// Common 8+ character passwords (lowercased). Kept small and inline on purpose.
const DENYLIST = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "123123123",
  "111111111",
  "000000000",
  "qwertyuiop",
  "qwerty123",
  "qwertyui",
  "1q2w3e4r",
  "1qaz2wsx",
  "zaq12wsx",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "welcome1",
  "welcome123",
  "admin123",
  "administrator",
  "letmein1",
  "letmein123",
  "monkey123",
  "dragon123",
  "trustno1",
  "superman",
  "batman123",
  "starwars",
  "whatever1",
  "abc12345",
  "abcd1234",
  "a1b2c3d4",
  "changeme",
  "changeme1",
  "secret123",
  "master123",
  "shadow123",
  "michael1",
  "jennifer",
  "computer1",
  "internet",
  "asdfghjkl",
  "asdf1234",
  "test1234",
  "testtest",
  "glassmkr",
  "glassmkr1",
]);

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// Returns an error MESSAGE when the password is unacceptable, or null when it
// passes. Callers map a non-null result to a 400.
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters`;
  }
  if (byteLength(password) > MAX_BYTES) {
    return `Password must be at most ${MAX_BYTES} bytes`;
  }
  if (DENYLIST.has(password.toLowerCase())) {
    return "That password is too common. Please choose a less predictable one.";
  }
  return null;
}
