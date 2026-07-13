/** Exact React, React DOM, and Flight renderer version supported by the experimental RSC contract. */
export const REACT_RSC_SUPPORTED_VERSION = '19.2.6';

/** HTTP content type written for experimental React Flight payload responses. */
export const REACT_RSC_FLIGHT_CONTENT_TYPE = 'text/x-component; charset=utf-8';

/** Stable diagnostic codes emitted by the experimental RSC compatibility and manifest checks. */
export const REACT_RSC_DIAGNOSTIC_CODES = {
  emptyClientReferenceManifest: 'react-rsc-empty-client-reference-manifest',
  emptyServerClientModuleMap: 'react-rsc-empty-server-client-module-map',
  missingClientReferenceManifest: 'react-rsc-missing-client-reference-manifest',
  missingServerClientModuleMap: 'react-rsc-missing-server-client-module-map',
  unknownClientReference: 'react-rsc-unknown-client-reference',
  unsupportedFlightRendererVersion: 'react-rsc-unsupported-flight-renderer-version',
  unsupportedReactDomVersion: 'react-rsc-unsupported-react-dom-version',
  unsupportedReactVersion: 'react-rsc-unsupported-react-version',
  unsupportedRuntime: 'react-rsc-unsupported-runtime',
} as const;

/** Machine-readable diagnostic code produced by the experimental RSC contract. */
export type ReactRscDiagnosticCode =
  (typeof REACT_RSC_DIAGNOSTIC_CODES)[keyof typeof REACT_RSC_DIAGNOSTIC_CODES];

/** Actionable compatibility or build diagnostic produced instead of an expected configuration throw. */
export type ReactRscDiagnostic = {
  /** Stable machine-readable diagnostic code. */
  readonly code: ReactRscDiagnosticCode;
  /** Human-readable explanation of the unsupported condition. */
  readonly message: string;
  /** Build manifest path associated with the diagnostic, when applicable. */
  readonly path?: string;
};

/** Runtime capabilities required by the experimental Flight response transport. */
export type ReactRscRuntimeCapabilities = {
  /** Application-facing runtime name included in unsupported-runtime diagnostics. */
  readonly name: string;
  /** Whether the runtime provides Web `ReadableStream` support. */
  readonly webStreams: boolean;
};

/** Build-adapter capabilities required to connect RSC module graphs explicitly. */
export type ReactRscBuildCapabilities = {
  /** Whether the build adapter produced a client-reference manifest. */
  readonly clientReferenceManifest: boolean;
  /** Application-facing build adapter name included in diagnostics. */
  readonly name: string;
  /** Whether the build adapter produced an explicit server-to-client module map. */
  readonly serverClientModuleMap: boolean;
};

/** Environment inputs checked before an application enables the experimental RSC path. */
export type ReactRscEnvironmentOptions = {
  /** Explicit build-adapter capabilities. */
  readonly build: ReactRscBuildCapabilities;
  /** Installed Flight renderer version, such as `react-server-dom-webpack`. */
  readonly flightRendererVersion: string;
  /** Installed `react-dom` version. */
  readonly reactDomVersion: string;
  /** Installed `react` version. */
  readonly reactVersion: string;
  /** Explicit runtime capabilities. */
  readonly runtime: ReactRscRuntimeCapabilities;
};

/** Result of inspecting one experimental RSC runtime and build environment. */
export type ReactRscSupportResult =
  | { readonly diagnostics: readonly []; readonly ok: true }
  | { readonly diagnostics: readonly ReactRscDiagnostic[]; readonly ok: false };

/** Bundler-produced metadata for one client module export referenced by a Flight payload. */
export type ReactRscClientReference = {
  /** Whether the referenced module is loaded asynchronously. */
  readonly async?: boolean;
  /** Build chunks required to load the client reference. */
  readonly chunks: readonly string[];
  /** Bundler-specific module id consumed by the application-owned Flight renderer. */
  readonly id: string;
  /** Export name consumed from the referenced client module. */
  readonly name: string;
};

/** Client-reference metadata keyed by an application-owned stable reference id. */
export type ReactRscClientReferenceManifest = Readonly<Record<string, ReactRscClientReference>>;

/** Server module exports mapped to keys in the client-reference manifest. */
export type ReactRscServerClientModuleMap = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Build output accepted by `createReactRscManifest(...)`. */
export type ReactRscManifestInput = {
  /** Client references produced by the application build adapter. */
  readonly clientReferences: ReactRscClientReferenceManifest;
  /** Server module exports mapped to client-reference keys. */
  readonly serverClientModuleMap: ReactRscServerClientModuleMap;
};

/** Defensive RSC module graph snapshot passed to an application-owned Flight renderer. */
export type ReactRscManifest = ReactRscManifestInput;

/** Result of validating and snapshotting an experimental RSC manifest. */
export type ReactRscManifestResult =
  | { readonly diagnostics: readonly []; readonly manifest: ReactRscManifest; readonly ok: true }
  | { readonly diagnostics: readonly ReactRscDiagnostic[]; readonly ok: false };

/** Encoded React Flight payload accepted by the experimental HTTP response helper. */
export type ReactFlightPayload = string | Uint8Array | ReadableStream<Uint8Array>;

/** Additional HTTP headers applied to an experimental Flight response. */
export type ReactFlightResponseHeaders = Readonly<Record<string, string | readonly string[]>>;

/** Options applied after ordinary fluo route success metadata for a Flight response. */
export type ReactFlightResponseOptions = {
  /** Additional response headers; the Flight `Content-Type` remains fixed. */
  readonly headers?: ReactFlightResponseHeaders;
  /** HTTP status overriding ordinary route success metadata. */
  readonly status?: number;
};

/** Response entry returned from an ordinary fluo HTTP handler to emit an encoded Flight payload. */
export type ReactFlightResponse = {
  /** Additional response headers applied before the payload commits. */
  readonly headers: ReactFlightResponseHeaders;
  /** Encoded Flight payload or one-shot Flight stream. */
  readonly payload: ReactFlightPayload;
  /** Optional status overriding ordinary route success metadata. */
  readonly status?: number;
};
