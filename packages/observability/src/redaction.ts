/** Redaction.
 *
 * Secrets arrive in log lines from places nobody planned for: a provider error echoing a
 * header, a tool result quoting a config file, a stack trace with a URL in it. Redaction
 * therefore runs on the way *into* the log, not on the way out to a reader, and it matches
 * shapes rather than a list of known values — a value we have never seen is exactly the one
 * that leaks.
 */
export type RedactionRule = { name: string; pattern: RegExp; replacement: string };

/** Shape-based rules. Each keeps enough context to debug with and none of the secret. */
export const RULES: RedactionRule[] = [
  { name: 'authorization_header', pattern: /\b(authorization|proxy-authorization)\s*[:=]\s*\S+/gi, replacement: '$1: [redacted]' },
  { name: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, replacement: 'Bearer [redacted]' },
  { name: 'api_key_assignment', pattern: /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)S?)\s*[:=]\s*["']?[^\s"',}]+/gi, replacement: '$1=[redacted]' },
  { name: 'private_key_block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[redacted private key]' },
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[redacted aws key id]' },
  { name: 'url_credentials', pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, replacement: '$1[redacted]@' },
  { name: 'json_secret_field', pattern: /"(api_?key|token|secret|password|credential)"\s*:\s*"[^"]*"/gi, replacement: '"$1":"[redacted]"' },
  { name: 'long_opaque_token', pattern: /\b(sk|pk|ghp|gho|xox[abps])-[A-Za-z0-9_-]{16,}\b/g, replacement: '[redacted token]' },
];

export type RedactionResult = { text: string; matched: string[]; redactions: number };

export function redact(text: string, rules: RedactionRule[] = RULES): RedactionResult {
  let output = text;
  const matched: string[] = [];
  let redactions = 0;
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const before = output;
    output = output.replace(pattern, rule.replacement);
    if (output !== before) {
      matched.push(rule.name);
      redactions += (before.match(pattern) ?? []).length;
    }
  }
  return { text: output, matched, redactions };
}

/** Redact recursively before anything is serialised into a record. */
export function redactValue(value: unknown, rules: RedactionRule[] = RULES): unknown {
  if (typeof value === 'string') return redact(value, rules).text;
  if (Array.isArray(value)) return value.map(entry => redactValue(entry, rules));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactValue(entry, rules)]));
  }
  return value;
}

/** Proof for a caller that a specific value is nowhere in a record. */
export function containsSecret(haystack: string, canaries: string[]): string[] {
  return canaries.filter(canary => canary.length > 0 && haystack.includes(canary));
}
