import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from './types.js';
import { appendVaryHeader, getRequestHeader } from './index.js';

function createRequest(
  headers: FrameworkRequest['headers'],
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path: '/headers',
    query: {},
    raw: {},
    url: '/headers',
  };
}

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('getRequestHeader', () => {
  it('reads request headers case-insensitively without flattening arrays', () => {
    const upstreamValues = ['trace-a', 'trace-b'];
    const request = createRequest({
      'X-Trace-Id': upstreamValues,
    });

    expect(getRequestHeader(request, 'x-trace-id')).toBe(upstreamValues);
    expect(getRequestHeader(request, 'X-TRACE-ID')).toBe(upstreamValues);
  });

  it('returns undefined for blank or missing header names', () => {
    const request = createRequest({
      accept: 'application/json',
    });

    expect(getRequestHeader(request, '   ')).toBeUndefined();
    expect(getRequestHeader(request, 'x-missing')).toBeUndefined();
  });
});

describe('appendVaryHeader', () => {
  it('adds unique vary fields while trimming empty tokens from scalars and arrays', () => {
    const response = createResponse();
    response.setHeader('Vary', ['Accept-Encoding,  ', ' Origin ', '', 'Accept-Encoding']);

    appendVaryHeader(response, 'origin', 'Accept', '', '  ');

    expect(response.headers.Vary).toBe('Accept-Encoding, Origin, Accept');
  });

  it('preserves a wildcard vary response without appending extra fields', () => {
    const response = createResponse();
    response.setHeader('vary', '*, Accept-Encoding');

    appendVaryHeader(response, 'Accept');

    expect(response.headers.vary).toBe('*');
  });

  it('collapses wildcard inputs to a bare wildcard vary header', () => {
    const response = createResponse();

    appendVaryHeader(response, 'Accept', '*', 'Origin');

    expect(response.headers.Vary).toBe('*');
  });
});
