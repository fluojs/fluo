import type { Middleware } from './types.js';

export interface CorsOptions {
  allowCredentials?: boolean;
  allowHeaders?: string[];
  allowMethods?: string[];
  allowOrigin?: string | string[] | ((origin: string | undefined) => string | undefined);
  exposeHeaders?: string[];
  maxAge?: number;
}

function resolveOrigin(options: CorsOptions, requestOrigin: string | undefined): string | undefined {
  if (typeof options.allowOrigin === 'function') {
    return options.allowOrigin(requestOrigin);
  }

  if (Array.isArray(options.allowOrigin)) {
    if (!requestOrigin) {
      return undefined;
    }

    return options.allowOrigin.includes(requestOrigin) ? requestOrigin : undefined;
  }

  return options.allowOrigin ?? '*';
}

function setHeaderIfValue(
  response: { setHeader(name: string, value: string | string[]): void },
  name: string,
  value?: string,
): void {
  if (value) {
    response.setHeader(name, value);
  }
}

export function createCorsMiddleware(options: CorsOptions = {}): Middleware {
  if (options.allowCredentials === true && options.allowOrigin === '*') {
    throw new Error(
      'CORS misconfiguration: allowCredentials cannot be true when allowOrigin is "*". Specify explicit origins instead.',
    );
  }

  const allowMethods = options.allowMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

  return {
    async handle(context, next) {
      const requestOriginHeader = context.request.headers.origin;
      const requestOrigin = Array.isArray(requestOriginHeader) ? requestOriginHeader[0] : requestOriginHeader;
      const origin = resolveOrigin(options, requestOrigin);

      if (origin) {
        context.response.setHeader('Access-Control-Allow-Origin', origin);
      }

      setHeaderIfValue(context.response, 'Access-Control-Allow-Methods', allowMethods.join(', '));
      setHeaderIfValue(context.response, 'Access-Control-Allow-Headers', options.allowHeaders?.join(', '));
      setHeaderIfValue(context.response, 'Access-Control-Expose-Headers', options.exposeHeaders?.join(', '));
      setHeaderIfValue(
        context.response,
        'Access-Control-Allow-Credentials',
        options.allowCredentials ? 'true' : undefined,
      );
      setHeaderIfValue(
        context.response,
        'Access-Control-Max-Age',
        options.maxAge !== undefined ? String(options.maxAge) : undefined,
      );

      if (origin && origin !== '*') {
        const existingVary = context.response.headers['vary'] ?? context.response.headers['Vary'];
        const varyValues = existingVary ? (Array.isArray(existingVary) ? existingVary : String(existingVary).split(',').map((v) => v.trim())) : [];
        if (!varyValues.some((v) => v.toLowerCase() === 'origin')) {
          varyValues.push('Origin');
        }
        context.response.setHeader('Vary', varyValues.join(', '));
      }

      if (context.request.method === 'OPTIONS') {
        context.response.setStatus(204);
        await context.response.send(undefined);
        return;
      }

      await next();
    },
  };
}
