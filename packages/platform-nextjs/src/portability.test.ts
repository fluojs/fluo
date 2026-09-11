import { type CreateApplicationOptions, FluoFactory } from '@fluojs/runtime';
import { WebRuntimeHttpAdapterPortabilityHarness } from '@fluojs/testing/web-runtime-adapter-portability';
import { describe, it } from 'vitest';

import { type NextAdapterOptions, NextHttpApplicationAdapter } from './index.js';

type BootstrapOptions = Omit<CreateApplicationOptions, 'adapter'> & NextAdapterOptions;

const portability = WebRuntimeHttpAdapterPortabilityHarness.create<BootstrapOptions>({
  async bootstrap(rootModule, { maxBodySize, rawBody, ...options }) {
    const adapter = NextHttpApplicationAdapter.create({ maxBodySize, rawBody });
    const app = await FluoFactory.create(rootModule, { ...options, adapter });
    await app.listen();

    return {
      close: () => app.close(),
      dispatch: adapter.fetch,
    };
  },
  createConditionalRequestBootstrapOptions: (options) => options,
  createErrorRepresentationBootstrapOptions: (options) => options,
  name: 'Next.js',
});

describe('Next.js Web adapter portability', () => {
  it('preserves query arrays and decoding', () =>
    portability.assertPreservesQueryArraysAndDecoding());

  it('preserves malformed cookie values', () =>
    portability.assertPreservesMalformedCookieValues());

  it('preserves independent response cookies', () =>
    portability.assertSupportsPortableResponseCookies());

  it('preserves JSON and text raw bodies', () =>
    portability.assertPreservesRawBodyForJsonAndText());

  it('preserves exact raw bytes for byte-sensitive payloads', () =>
    portability.assertPreservesExactRawBodyBytesForByteSensitivePayloads());

  it('excludes raw bodies from multipart requests', () =>
    portability.assertExcludesRawBodyForMultipart());

  it('preserves SSE response framing', () =>
    portability.assertSupportsSseStreaming());

  it('preserves single byte ranges', () =>
    portability.assertSupportsSingleByteRanges());

  it('preserves conditional request responses', () =>
    portability.assertSupportsConditionalRequests());

  it('preserves HTTP error representations', () =>
    portability.assertSupportsHttpErrorRepresentations());

  it('does not commit error representations after request abort', () =>
    portability.assertDoesNotCommitAbortedHttpErrorRepresentations());
});
