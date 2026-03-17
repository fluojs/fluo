# security middleware

<p><strong><kbd>English</kbd></strong> <a href="./security-middleware.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current transport-level security middleware model in `@konekti/http`.

See also:

- `./http-runtime.md`
- `../../packages/http/README.md`

## current middleware families

### rate limiting

`RateLimitMiddleware` is transport-level middleware that:

- is exported from `@konekti/http`
- follows the standard middleware interface
- can resolve a request key through a custom resolver
- returns `429 Too Many Requests` with `Retry-After` when the limit is exceeded
- uses an in-process store by default, so it is not cluster-safe without a shared adapter

### security headers

`SecurityHeadersMiddleware` is transport-level middleware that:

- is exported from `@konekti/http`
- writes a default set of security-focused headers
- allows individual headers to be overridden or disabled
- never sets `X-Powered-By`

## default header set

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 0`
- `Strict-Transport-Security: max-age=15552000; includeSubDomains`
- `Content-Security-Policy: default-src 'self'`
- `Referrer-Policy: strict-origin-when-cross-origin`

## ownership boundaries

- these middleware live with the HTTP runtime package
- applications opt into them explicitly; they are not silently enabled by default
- rate limiting acts before route dispatch and does not know handler identities
- security headers should be applied regardless of handler outcome
