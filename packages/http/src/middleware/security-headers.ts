import type { Middleware } from '../types.js';

export interface SecurityHeadersOptions {
  contentSecurityPolicy?: string | false;
  crossOriginOpenerPolicy?: string | false;
  referrerPolicy?: string | false;
  strictTransportSecurity?: string | false;
  xContentTypeOptions?: false;
  xFrameOptions?: string | false;
  xXssProtection?: string | false;
}

const DEFAULTS = {
  contentSecurityPolicy: "default-src 'self'",
  crossOriginOpenerPolicy: 'same-origin',
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: 'max-age=15552000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'SAMEORIGIN',
  xXssProtection: '0',
} as const;

export function createSecurityHeadersMiddleware(options: SecurityHeadersOptions = {}): Middleware {
  const csp = 'contentSecurityPolicy' in options ? options.contentSecurityPolicy : DEFAULTS.contentSecurityPolicy;
  const coop = 'crossOriginOpenerPolicy' in options ? options.crossOriginOpenerPolicy : DEFAULTS.crossOriginOpenerPolicy;
  const referrer = 'referrerPolicy' in options ? options.referrerPolicy : DEFAULTS.referrerPolicy;
  const hsts = 'strictTransportSecurity' in options ? options.strictTransportSecurity : DEFAULTS.strictTransportSecurity;
  const xcto = 'xContentTypeOptions' in options ? options.xContentTypeOptions : DEFAULTS.xContentTypeOptions;
  const xfo = 'xFrameOptions' in options ? options.xFrameOptions : DEFAULTS.xFrameOptions;
  const xxp = 'xXssProtection' in options ? options.xXssProtection : DEFAULTS.xXssProtection;

  const applyHeaders = (response: Parameters<Middleware['handle']>[0]['response']) => {
    if (csp) {
      response.setHeader('Content-Security-Policy', csp);
    }

    if (coop) {
      response.setHeader('Cross-Origin-Opener-Policy', coop);
    }

    if (referrer) {
      response.setHeader('Referrer-Policy', referrer);
    }

    if (hsts) {
      response.setHeader('Strict-Transport-Security', hsts);
    }

    if (xcto) {
      response.setHeader('X-Content-Type-Options', xcto);
    }

    if (xfo) {
      response.setHeader('X-Frame-Options', xfo);
    }

    if (xxp) {
      response.setHeader('X-XSS-Protection', xxp);
    }
  };

  return {
    async handle(context, next) {
      applyHeaders(context.response);
      await next();
    },
  };
}
