import type { Dispatcher, FrameworkRequest, FrameworkResponse, HttpMethod, Middleware, Principal } from '@konekti/http';

export interface TestPrincipal {
  subject?: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TestRequest {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  principal?: TestPrincipal;
}

export interface TestRequestWithOptions extends TestRequest {
  principal?: TestPrincipal;
}

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface RequestBuilder {
  method(value: string): RequestBuilder;
  path(value: string): RequestBuilder;
  body(value: unknown): RequestBuilder;
  header(name: string, value: string): RequestBuilder;
  query(key: string, value: string | string[]): RequestBuilder;
  principal(value: TestPrincipal): RequestBuilder;
  send(): Promise<TestResponse>;
}

type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

interface FrameworkTestRequest extends FrameworkRequest {
  principal?: TestPrincipal;
}

type NormalizedTestPrincipal = {
  subject: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {};
}

function normalizePrincipal(principal?: TestPrincipal): Principal | undefined {
  if (!principal) {
    return undefined;
  }

  const {
    subject,
    issuer,
    audience,
    roles,
    scopes,
    claims: principalClaims,
    ...additionalClaims
  } = principal;

  const subjectValue =
    typeof subject === 'string'
      ? subject
      : typeof (additionalClaims as { id?: unknown }).id === 'string'
      ? String((additionalClaims as { id?: unknown }).id)
      : 'test';

  const normalizedClaims: NormalizedTestPrincipal = {
    subject: subjectValue,
    audience,
    claims: {
      ...toRecord(principalClaims),
      ...additionalClaims,
    },
  };

  if (issuer !== undefined) {
    normalizedClaims.issuer = issuer;
  }

  if (roles !== undefined) {
    normalizedClaims.roles = roles;
  }

  if (scopes !== undefined) {
    normalizedClaims.scopes = scopes;
  }

  return normalizedClaims;
}

export function createRequestBuilder(dispatcher: Dispatcher, request: TestRequestWithOptions): RequestBuilder {
  let current: TestRequestWithOptions = {
    method: request.method,
    path: request.path,
    body: request.body,
    headers: request.headers ? { ...request.headers } : undefined,
    query: request.query ? { ...request.query } : undefined,
    principal: request.principal,
  };

  return {
    method(value: string) {
      current = { ...current, method: value };
      return this;
    },
    path(value: string) {
      current = { ...current, path: value };
      return this;
    },
    body(value: unknown) {
      current = { ...current, body: value };
      return this;
    },
    header(name: string, value: string) {
      current = {
        ...current,
        headers: {
          ...(current.headers ?? {}),
          [name]: value,
        },
      };

      return this;
    },
    query(key: string, value: string | string[]) {
      current = {
        ...current,
        query: {
          ...(current.query ?? {}),
          [key]: value,
        },
      };

      return this;
    },
    principal(value: TestPrincipal) {
      current = { ...current, principal: value };
      return this;
    },
    async send() {
      return makeRequest(dispatcher, current);
    },
  };
}

export function createTestRequestContextMiddleware(): Middleware {
  return {
    async handle(context, next) {
      const request = context.request as FrameworkTestRequest;
      const principal = normalizePrincipal(request.principal);

      if (principal !== undefined) {
        context.requestContext.principal = principal;
      }

      await next();
    },
  };
}

function buildFrameworkRequest(req: TestRequestWithOptions): FrameworkTestRequest {
  const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
  const queryString = req.query
    ? '?' + new URLSearchParams(
        Object.entries(req.query).flatMap(([key, value]) =>
          Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]],
        ),
      ).toString()
    : '';

  return {
    method,
    path: req.path,
    url: req.path + queryString,
    headers: req.headers ?? {},
    query: req.query ?? {},
    cookies: {},
    params: {},
    body: req.body,
    raw: req,
    principal: req.principal,
  };
}

function buildFrameworkResponse(): { response: MutableFrameworkResponse; result: TestResponse } {
  const result: TestResponse = { status: 200, body: undefined, headers: {} };

  const response: MutableFrameworkResponse = {
    statusCode: undefined,
    headers: {},
    committed: false,

    setStatus(code: number) {
      result.status = code;
      this.statusCode = code;
      this.statusSet = true;
    },

    setHeader(name: string, value: string) {
      result.headers[name] = value;
      this.headers[name] = value;
    },

    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('location', location);
      this.committed = true;
    },

    async send(body: unknown) {
      result.body = body;
      this.committed = true;
    },

    statusSet: false,
  };

  return { response, result };
}

export async function makeRequest(dispatcher: Dispatcher, req: TestRequestWithOptions): Promise<TestResponse> {
  const frameworkRequest = buildFrameworkRequest(req);
  const { response, result } = buildFrameworkResponse();

  await dispatcher.dispatch(frameworkRequest, response);

  return result;
}
