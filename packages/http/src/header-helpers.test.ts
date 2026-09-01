import { describe, expect, it } from 'vitest';

import {
  appendVaryHeader,
  buildContentDisposition,
  getRequestHeader,
  getResponseHeader,
  hasResponseHeader,
} from './index.js';
import type { FrameworkRequest, FrameworkResponse } from './types.js';

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

  it('preserves the first stored duplicate-case header value for public lookups', () => {
    const request = createRequest({
      Accept: '   ',
      aCcEpT: 'text/html',
    });

    expect(getRequestHeader(request, 'accept')).toBe('   ');
  });
});

describe('response metadata helpers', () => {
  it('reads response headers case-insensitively without flattening arrays or mutating response state', () => {
    const upstreamValues = ['trace-a', 'trace-b'];
    const response = createResponse();
    response.headers['X-Trace-Id'] = upstreamValues;
    response.statusCode = 202;
    response.statusSet = true;

    expect(getResponseHeader(response, 'x-trace-id')).toBe(upstreamValues);
    expect(getResponseHeader(response, 'X-TRACE-ID')).toBe(upstreamValues);
    expect(hasResponseHeader(response, 'x-trace-id')).toBe(true);
    expect(hasResponseHeader(response, 'x-missing')).toBe(false);
    expect(response).toMatchObject({
      committed: false,
      headers: { 'X-Trace-Id': upstreamValues },
      statusCode: 202,
      statusSet: true,
    });
  });

  it('returns undefined and false for blank or missing response header names', () => {
    const response = createResponse();
    response.headers.ETag = '"response-v1"';

    expect(getResponseHeader(response, '   ')).toBeUndefined();
    expect(hasResponseHeader(response, '   ')).toBe(false);
    expect(getResponseHeader(response, 'x-missing')).toBeUndefined();
    expect(hasResponseHeader(response, 'x-missing')).toBe(false);
  });
});

describe('buildContentDisposition', () => {
  it('creates deterministic quoted ASCII and UTF-8 filename parameters for attachment and inline responses', () => {
    expect(buildContentDisposition('attachment', 'résumé "2026"\\draft.txt')).toBe(
      `attachment; filename="r?sum? \\"2026\\"\\\\draft.txt"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%222026%22%5Cdraft.txt`,
    );
    expect(buildContentDisposition('inline', 'resume.txt')).toBe(
      `inline; filename="resume.txt"; filename*=UTF-8''resume.txt`,
    );
  });

  it('rejects carriage-return and line-feed filename injection before creating a header value', () => {
    expect(() => buildContentDisposition('attachment', 'report\r\nX-Injected: true')).toThrow(
      'Content-Disposition filenames cannot contain CR or LF characters.',
    );
    expect(() => buildContentDisposition('inline', 'report\nX-Injected: true')).toThrow(
      'Content-Disposition filenames cannot contain CR or LF characters.',
    );
  });
});

describe('appendVaryHeader', () => {
  it('adds unique vary fields while trimming empty tokens from scalars and arrays', () => {
    const response = createResponse();
    response.setHeader('Vary', ['Accept-Encoding,  ', ' Origin ', '', 'Accept-Encoding']);

    appendVaryHeader(response, 'origin', 'Accept', '', '  ');

    expect(response.headers.Vary).toBe('Accept-Encoding, Origin, Accept');
  });

  it('merges duplicate-case vary entries into one canonical header', () => {
    const response = createResponse();
    response.headers.Vary = 'Accept-Encoding';
    response.headers.vary = 'Origin';

    appendVaryHeader(response, 'Accept');

    expect(response.headers).toEqual({
      Vary: 'Accept-Encoding, Origin, Accept',
    });
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
