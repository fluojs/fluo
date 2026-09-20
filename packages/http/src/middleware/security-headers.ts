import type { FrameworkResponse, Middleware, MiddlewareSnapshotLike } from '../types.js';
import { isMiddlewareRouteConfig } from './middleware.js';

type SecurityHeadersApplier = (response: FrameworkResponse) => void;

const securityHeadersCapabilities = new WeakMap<object, {
  handle: Middleware['handle'];
  apply: SecurityHeadersApplier;
}>();

/**
 * Finds the header effect for an original, unmodified framework middleware instance.
 *
 * @param definition Middleware whose framework-owned capability should be inspected.
 * @returns The header effect, or undefined when the normal middleware chain is required.
 * @internal
 */
export function getSecurityHeadersApplier(definition: MiddlewareSnapshotLike): SecurityHeadersApplier | undefined {
  if (typeof definition !== 'object' || definition === null) {
    return undefined;
  }

  const capability = securityHeadersCapabilities.get(definition);
  if (!capability || isMiddlewareRouteConfig(definition)) {
    return undefined;
  }

  // Accessors, wrappers, copies and replaced handlers are user middleware, not this capability.
  return Object.getOwnPropertyDescriptor(definition, 'handle')?.value === capability.handle
    ? capability.apply
    : undefined;
}

/**
 * Describes the security headers options contract.
 */
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

/**
 * Create security headers middleware.
 *
 * @param options The options.
 * @returns The create security headers middleware result.
 */
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

  const middleware: Middleware = {
    async handle(context, next) {
      applyHeaders(context.response);
      await next();
    },
  };
  securityHeadersCapabilities.set(middleware, { apply: applyHeaders, handle: middleware.handle });
  return middleware;
}
