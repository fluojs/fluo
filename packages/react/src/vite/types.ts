import type { ReactAssetMap, ReactBootstrapAsset, ReactServerEntryOptions } from '../server-entry.js';

/** Stable diagnostic code values emitted by the React Vite manifest parser. */
export const DIAGNOSTIC_CODES = {
  malformed: 'react-vite-manifest-malformed',
  missingClientEntry: 'react-vite-manifest-missing-client-entry',
  missingServerEntry: 'react-vite-manifest-missing-server-entry',
  unsupportedOutputShape: 'react-vite-manifest-unsupported-output-shape',
} as const;

/** JavaScript extensions accepted for Vite SSR and hydration chunks. */
export const JAVASCRIPT_OUTPUT_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const;

/** URL protocol detector used before applying a Vite base path. */
export const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

/** Narrowed object record used while parsing untrusted manifests. */
export type UnknownRecord = Readonly<Record<string, unknown>>;

/** Entry role used in diagnostics for selected React server and client chunks. */
export type EntryRole = 'client' | 'server';

/** Parsed manifest entry with normalized optional fields. */
export type ParsedManifestEntry = {
  readonly assets: readonly string[];
  readonly css: readonly string[];
  readonly file: string;
  readonly id: string;
  readonly imports: readonly string[];
  readonly isDynamicEntry?: boolean;
  readonly isEntry?: boolean;
  readonly name?: string;
  readonly src?: string;
};

/** Parsed manifest keyed by Vite manifest id. */
export type ParsedManifest = Readonly<Record<string, ParsedManifestEntry>>;

/** Result of parsing the untrusted manifest boundary. */
export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: ParsedManifest }
  | { readonly ok: false; readonly diagnostics: readonly ReactViteManifestDiagnostic[] };

/** Result of parsing one Vite manifest entry. */
export type ManifestEntryParseResult = {
  readonly diagnostics: readonly ReactViteManifestDiagnostic[];
  readonly entry?: ParsedManifestEntry;
};

/** Result of resolving an explicit React entry selector. */
export type EntryResolveResult = {
  readonly diagnostics: readonly ReactViteManifestDiagnostic[];
  readonly entry?: ParsedManifestEntry;
};

/** Reader state shared by manifest entry field parsers. */
export type ManifestEntryReader = {
  readonly diagnostics: ReactViteManifestDiagnostic[];
  readonly entry: UnknownRecord;
  readonly entryId: string;
};

/** Ordered client dependency graph plus graph-level diagnostics. */
export type DependencyGraph = {
  readonly diagnostics: readonly ReactViteManifestDiagnostic[];
  readonly entries: readonly ParsedManifestEntry[];
};

/** Input fields that form trusted bootstrap metadata. */
export type BootstrapDataInput = Pick<
  ReactViteManifestOptions,
  'bootstrapScriptContent' | 'identifierPrefix' | 'nonce'
>;

/** Inputs used to assemble stable root hydration options. */
export type HydrationOptionsInput = {
  readonly assetMap: ReactAssetMap;
  readonly bootstrap: ReactViteBootstrapData;
  readonly modules: readonly ReactBootstrapAsset[];
  readonly scripts: readonly ReactBootstrapAsset[];
};

/** Vite manifest chunk fields consumed by `@fluojs/react/vite`. */
export type ReactViteBuildManifestChunk = {
  /** Emitted static assets referenced by this chunk. */
  readonly assets?: readonly string[];
  /** Stylesheets emitted for this chunk in Vite manifest order. */
  readonly css?: readonly string[];
  /** JavaScript output file for this chunk. */
  readonly file: string;
  /** Static chunk imports that should be ordered before this chunk. */
  readonly imports?: readonly string[];
  /** Whether Vite marks this chunk as a dynamic entry. */
  readonly isDynamicEntry?: boolean;
  /** Whether Vite marks this chunk as an entry. */
  readonly isEntry?: boolean;
  /** Optional Vite chunk name used as a secondary lookup key. */
  readonly name?: string;
  /** Optional original source path used as a secondary lookup key. */
  readonly src?: string;
};

/** Vite manifest object keyed by source entry or generated chunk id. */
export type ReactViteBuildManifest = Readonly<Record<string, ReactViteBuildManifestChunk>>;

/** Explicit React server and client entry selectors for a Vite manifest. */
export type ReactViteManifestEntries = {
  /** Manifest key, `src`, or `name` for the browser hydration entry. */
  readonly client: string;
  /** Manifest key, `src`, or `name` for the server SSR entry. */
  readonly server: string;
};

/** Options accepted by `createReactViteAssetManifest(...)`. */
export type ReactViteManifestOptions = {
  /** Public Vite base path used to turn relative manifest files into public URLs. Defaults to `/`. */
  readonly base?: string;
  /** Caller-provided module bootstrap assets appended after manifest-derived modules. */
  readonly bootstrapModules?: readonly ReactBootstrapAsset[];
  /** Trusted inline bootstrap script content forwarded to the root hydration contract. */
  readonly bootstrapScriptContent?: string;
  /** Caller-provided classic script bootstrap assets forwarded to the root hydration contract. */
  readonly bootstrapScripts?: readonly ReactBootstrapAsset[];
  /** Server and client React entry selectors. */
  readonly entries: ReactViteManifestEntries;
  /** Stable React `useId()` prefix forwarded to the root hydration contract. */
  readonly identifierPrefix?: string;
  /** Untrusted manifest value loaded from Vite output or provided by the caller. */
  readonly manifest: unknown;
  /** CSP nonce forwarded to emitted React bootstrap scripts. */
  readonly nonce?: string;
};

/** Diagnostic code emitted while parsing React Vite assets. */
export type ReactViteManifestDiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

/** Diagnostic emitted instead of throwing for expected manifest problems. */
export type ReactViteManifestDiagnostic = {
  /** Stable machine-readable diagnostic code. */
  readonly code: ReactViteManifestDiagnosticCode;
  /** Requested manifest entry when the diagnostic is entry-specific. */
  readonly entry?: string;
  /** Human-readable diagnostic message. */
  readonly message: string;
  /** Manifest path for malformed field diagnostics. */
  readonly path?: string;
};

/** JavaScript assets split by module and classic script bootstrap semantics. */
export type ReactViteJavaScriptAssets = {
  /** Module scripts derived from the Vite client import graph plus caller-provided modules. */
  readonly modules: readonly ReactBootstrapAsset[];
  /** Classic scripts supplied by the caller for the root hydration contract. */
  readonly scripts: readonly ReactBootstrapAsset[];
};

/** Trusted bootstrap data forwarded into the stable root hydration contract. */
export type ReactViteBootstrapData = {
  /** Trusted inline bootstrap script content. */
  readonly bootstrapScriptContent?: string;
  /** Stable React `useId()` prefix. */
  readonly identifierPrefix?: string;
  /** CSP nonce for emitted React bootstrap scripts. */
  readonly nonce?: string;
};

/** Hydration options that can be passed directly to `createReactServerEntry(...)`. */
export type ReactViteHydrationOptions = Pick<
  ReactServerEntryOptions,
  | 'assetMap'
  | 'bootstrapModules'
  | 'bootstrapScriptContent'
  | 'bootstrapScripts'
  | 'identifierPrefix'
  | 'nonce'
>;

/** Resolved Vite entry metadata with public URLs for assets owned by that entry. */
export type ReactViteResolvedEntry = {
  /** Manifest entry id selected by key, `src`, or `name`. */
  readonly id: string;
  /** Public asset URLs referenced directly by this entry. */
  readonly assets: readonly string[];
  /** Public stylesheet URLs referenced directly by this entry. */
  readonly css: readonly string[];
  /** Manifest output file for this entry. */
  readonly file: string;
  /** Static import ids declared by this entry. */
  readonly imports: readonly string[];
  /** Public JavaScript URL for this entry. */
  readonly publicUrl: string;
};

/** React Vite asset manifest produced for server rendering and client hydration. */
export type ReactViteAssetManifest = {
  /** Defensive asset map snapshot shared by server markup and client hydration. */
  readonly assetMap: ReactAssetMap;
  /** Trusted bootstrap data forwarded to React DOM through the root package. */
  readonly bootstrap: ReactViteBootstrapData;
  /** Resolved browser hydration entry. */
  readonly clientEntry: ReactViteResolvedEntry;
  /** Stylesheet URLs ordered before hydration scripts. */
  readonly css: readonly string[];
  /** Existing stable root hydration options. */
  readonly hydrationOptions: ReactViteHydrationOptions;
  /** JavaScript bootstrap assets split by module and classic script semantics. */
  readonly js: ReactViteJavaScriptAssets;
  /** Resolved server SSR entry. */
  readonly serverEntry: ReactViteResolvedEntry;
};

/** Result returned by `createReactViteAssetManifest(...)`. */
export type ReactViteAssetManifestResult =
  | { readonly ok: true; readonly manifest: ReactViteAssetManifest }
  | { readonly ok: false; readonly diagnostics: readonly ReactViteManifestDiagnostic[] };
