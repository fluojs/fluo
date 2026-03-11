import type { MaybePromise } from '@konekti/core';
import type { RequestScopeContainer } from '@konekti-internal/di';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface FrameworkRequest {
  method: HttpMethod | string;
  path: string;
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  query: Readonly<Record<string, string | string[] | undefined>>;
  cookies: Readonly<Record<string, string | undefined>>;
  params: Readonly<Record<string, string>>;
  body?: unknown;
  raw: unknown;
  signal?: AbortSignal;
}

export interface FrameworkResponse {
  statusCode?: number;
  headers: Record<string, string>;
  committed: boolean;
  setStatus(code: number): void;
  setHeader(name: string, value: string): void;
  redirect(status: number, location: string): void;
  send(body: unknown): MaybePromise<void>;
}

export interface Principal {
  subject: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims: Record<string, unknown>;
}

export interface RequestContext {
  request: FrameworkRequest;
  response: FrameworkResponse;
  requestId?: string;
  principal?: Principal;
  metadata: Record<string, unknown>;
  container: RequestScopeContainer;
}
