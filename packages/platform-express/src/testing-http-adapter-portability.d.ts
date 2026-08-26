declare module '@fluojs/testing/http-adapter-portability' {
  import type { HttpErrorRepresentationOptions, Middleware, RequestObserver } from '@fluojs/http';
  import type { ModuleType } from '@fluojs/runtime';

  type AppLike = {
    close(): Promise<void>;
    listen(): Promise<void>;
  };

  export interface HttpAdapterPortabilityHarnessOptions<
    TBootstrapOptions extends object,
    TRunOptions extends object,
    TApp extends AppLike = AppLike,
  > {
    bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
    createErrorRepresentationBootstrapOptions?: (options: {
      readonly cors: false;
      readonly errorRepresentation: HttpErrorRepresentationOptions;
      readonly middleware: Middleware[];
      readonly observers: RequestObserver[];
      readonly port: 0;
    }) => TBootstrapOptions;
    exactRawBodyByteContentType?: string;
    name: string;
    prepareExactRawBodyByteTest?: (app: TApp) => void | Promise<void>;
    run: (rootModule: ModuleType, options: TRunOptions) => Promise<TApp>;
  }

  export interface HttpAdapterPortabilityHarness<
    TBootstrapOptions extends object,
    TRunOptions extends object,
    TApp extends AppLike = AppLike,
  > {
    assertDoesNotCommitAbortedHttpErrorRepresentations(): Promise<void>;
    assertDefaultsMultipartTotalLimitToMaxBodySize(): Promise<void>;
    assertExcludesRawBodyForMultipart(): Promise<void>;
    assertPreservesExactRawBodyBytesForByteSensitivePayloads(): Promise<void>;
    assertPreservesFormattedResponseBytes(): Promise<void>;
    assertPreservesMalformedCookieValues(): Promise<void>;
    assertPreservesRawBodyForJsonAndText(): Promise<void>;
    assertRemovesShutdownSignalListenersAfterClose(): Promise<void>;
    assertReportsConfiguredHostInStartupLogs(): Promise<void>;
    assertReportsHttpsStartupUrl(https: { cert: string; key: string }): Promise<void>;
    assertSettlesStreamDrainWaitOnClose(): Promise<void>;
    assertSupportsHttpErrorRepresentations(): Promise<void>;
    assertSupportsConditionalRequests(): Promise<void>;
    assertSupportsSseStreaming(): Promise<void>;
  }

  export function createHttpAdapterPortabilityHarness<
    TBootstrapOptions extends object,
    TRunOptions extends object,
    TApp extends AppLike = AppLike,
  >(
    options: HttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TRunOptions, TApp>,
  ): HttpAdapterPortabilityHarness<TBootstrapOptions, TRunOptions, TApp>;
}
