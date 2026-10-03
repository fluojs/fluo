export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '0',
} as const;

export function comparisonHeaders(configuration: string | undefined): Readonly<Record<string, string>> {
  return configuration === 'equivalent' ? SECURITY_HEADERS : {};
}
