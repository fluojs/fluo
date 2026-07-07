declare module '@fluojs/testing/web-runtime-adapter-portability' {
  import type { ModuleType } from '@fluojs/runtime';

  type WebRuntimePortabilityAppLike = {
    close(): Promise<void>;
    dispatch(request: Request): Promise<Response>;
  };

  export interface WebRuntimeHttpAdapterPortabilityHarnessOptions<
    TBootstrapOptions extends object,
    TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
  > {
    bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
    name: string;
  }

  export interface WebRuntimeHttpAdapterPortabilityHarness<
    TBootstrapOptions extends object,
    TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
  > {
    assertExcludesRawBodyForMultipart(): Promise<void>;
    assertPreservesExactRawBodyBytesForByteSensitivePayloads(): Promise<void>;
    assertPreservesMalformedCookieValues(): Promise<void>;
    assertPreservesQueryArraysAndDecoding(): Promise<void>;
    assertPreservesRawBodyForJsonAndText(): Promise<void>;
    assertSupportsSseStreaming(): Promise<void>;
  }

  export function createWebRuntimeHttpAdapterPortabilityHarness<
    TBootstrapOptions extends object,
    TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
  >(
    options: WebRuntimeHttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TApp>,
  ): WebRuntimeHttpAdapterPortabilityHarness<TBootstrapOptions, TApp>;
}
