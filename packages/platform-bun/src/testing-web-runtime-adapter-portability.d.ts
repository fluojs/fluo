declare module '@fluojs/testing/web-runtime-adapter-portability' {
  import type { HttpErrorRepresentationOptions, Middleware } from '@fluojs/http';
  import type { ModuleType } from '@fluojs/runtime';

  export type WebHttpErrorRepresentationBootstrapOptions = {
    readonly cors: false;
    readonly errorRepresentation: HttpErrorRepresentationOptions;
    readonly middleware: Middleware[];
  };

  type WebRuntimePortabilityAppLike = {
    close(): Promise<void>;
    dispatch(request: Request): Promise<Response>;
  };

  export interface WebRuntimeHttpAdapterPortabilityHarnessOptions<
    TBootstrapOptions extends object,
    TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
  > {
    bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
    createErrorRepresentationBootstrapOptions?: (
      options: WebHttpErrorRepresentationBootstrapOptions,
    ) => TBootstrapOptions;
    name: string;
  }

  export interface WebRuntimeHttpAdapterPortabilityHarness<
    TBootstrapOptions extends object,
    TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
  > {
    assertDoesNotCommitAbortedHttpErrorRepresentations(): Promise<void>;
    assertExcludesRawBodyForMultipart(): Promise<void>;
    assertPreservesExactRawBodyBytesForByteSensitivePayloads(): Promise<void>;
    assertPreservesMalformedCookieValues(): Promise<void>;
    assertPreservesQueryArraysAndDecoding(): Promise<void>;
    assertPreservesRawBodyForJsonAndText(): Promise<void>;
    assertSupportsHttpErrorRepresentations(): Promise<void>;
    assertSupportsPortableResponseCookies(): Promise<void>;
    assertSupportsSseStreaming(): Promise<void>;
  }

  export function createWebRuntimeHttpAdapterPortabilityHarness<
    TBootstrapOptions extends object,
    TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
  >(
    options: WebRuntimeHttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TApp>,
  ): WebRuntimeHttpAdapterPortabilityHarness<TBootstrapOptions, TApp>;
}
