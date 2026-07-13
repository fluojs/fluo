import {
  cloneUniqueBootstrapAssets,
  collectCssUrls,
  collectDependencyGraph,
  collectModuleUrls,
  createAssetMap,
  createPublicUrl,
  isJavaScriptOutput,
} from './asset-utils.js';
import { createMissingEntryDiagnostic, createUnsupportedOutputDiagnostic } from './diagnostics.js';
import { parseReactViteBuildManifest, resolveManifestEntry } from './parse-manifest.js';
import type {
  BootstrapDataInput,
  DependencyGraph,
  HydrationOptionsInput,
  ParsedManifest,
  ParsedManifestEntry,
  ReactViteAssetManifestResult,
  ReactViteBootstrapData,
  ReactViteHydrationOptions,
  ReactViteManifestOptions,
  ReactViteResolvedEntry,
} from './types.js';

type SuccessManifestInput = {
  readonly clientGraph: DependencyGraph;
  readonly manifest: ParsedManifest;
  readonly options: ReactViteManifestOptions;
  readonly serverEntry: ParsedManifestEntry;
};

function createResolvedEntry(entry: ParsedManifestEntry, base: string | undefined): ReactViteResolvedEntry {
  return {
    assets: entry.assets.map((asset) => createPublicUrl(asset, base)),
    css: entry.css.map((css) => createPublicUrl(css, base)),
    file: entry.file,
    id: entry.id,
    imports: [...entry.imports],
    publicUrl: createPublicUrl(entry.file, base),
  };
}

function createBootstrapData(input: BootstrapDataInput): ReactViteBootstrapData {
  return {
    ...(input.bootstrapScriptContent !== undefined
      ? { bootstrapScriptContent: input.bootstrapScriptContent }
      : {}),
    ...(input.identifierPrefix !== undefined ? { identifierPrefix: input.identifierPrefix } : {}),
    ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
  };
}

function createHydrationOptions(input: HydrationOptionsInput): ReactViteHydrationOptions {
  return {
    assetMap: input.assetMap,
    ...(input.modules.length > 0 ? { bootstrapModules: input.modules } : {}),
    ...(input.bootstrap.bootstrapScriptContent !== undefined
      ? { bootstrapScriptContent: input.bootstrap.bootstrapScriptContent }
      : {}),
    ...(input.scripts.length > 0 ? { bootstrapScripts: input.scripts } : {}),
    ...(input.bootstrap.identifierPrefix !== undefined ? { identifierPrefix: input.bootstrap.identifierPrefix } : {}),
    ...(input.bootstrap.nonce !== undefined ? { nonce: input.bootstrap.nonce } : {}),
  };
}

function createSuccessManifest(input: SuccessManifestInput): ReactViteAssetManifestResult {
  const { clientGraph, manifest, options, serverEntry } = input;
  const assetMap = createAssetMap(manifest, options.base);
  const css = collectCssUrls(clientGraph.entries, options.base);
  const manifestModuleUrls = collectModuleUrls(clientGraph.entries, options.base);
  const modules = cloneUniqueBootstrapAssets([
    ...manifestModuleUrls,
    ...(options.bootstrapModules ?? []),
  ]);
  const scripts = cloneUniqueBootstrapAssets(options.bootstrapScripts ?? []);
  const bootstrap = createBootstrapData(options);
  const hydrationOptions = createHydrationOptions({ assetMap, bootstrap, modules, scripts });
  const clientEntry = clientGraph.entries[clientGraph.entries.length - 1];

  if (clientEntry === undefined) {
    return {
      diagnostics: [createMissingEntryDiagnostic('client', options.entries.client)],
      ok: false,
    };
  }

  return {
    manifest: {
      assetMap,
      bootstrap,
      clientEntry: createResolvedEntry(clientEntry, options.base),
      css,
      hydrationOptions,
      js: { modules, scripts },
      serverEntry: createResolvedEntry(serverEntry, options.base),
    },
    ok: true,
  };
}

/**
 * Parses a Vite manifest into React hydration assets without importing Vite from the root package.
 *
 * @param options Manifest input, explicit React entry selectors, public base path, and trusted bootstrap metadata.
 * @returns A typed asset manifest on success, or diagnostics for expected manifest and output-shape failures.
 */
export function createReactViteAssetManifest(
  options: ReactViteManifestOptions,
): ReactViteAssetManifestResult {
  const parsed = parseReactViteBuildManifest(options.manifest);

  if (!parsed.ok) {
    return parsed;
  }

  const serverResult = resolveManifestEntry(parsed.manifest, 'server', options.entries.server);
  const clientResult = resolveManifestEntry(parsed.manifest, 'client', options.entries.client);
  const entryDiagnostics = [...serverResult.diagnostics, ...clientResult.diagnostics];
  const serverEntry = serverResult.entry;
  const clientEntry = clientResult.entry;

  if (serverEntry === undefined || clientEntry === undefined) {
    return { diagnostics: entryDiagnostics, ok: false };
  }

  const clientGraph = collectDependencyGraph(parsed.manifest, clientEntry);
  const unsupportedDiagnostics = [
    ...(isJavaScriptOutput(serverEntry.file) ? [] : [createUnsupportedOutputDiagnostic('server', serverEntry)]),
    ...clientGraph.entries.flatMap((entry) =>
      isJavaScriptOutput(entry.file) ? [] : [createUnsupportedOutputDiagnostic('client', entry)],
    ),
  ];
  const diagnostics = [...clientGraph.diagnostics, ...unsupportedDiagnostics];

  if (diagnostics.length > 0) {
    return { diagnostics, ok: false };
  }

  return createSuccessManifest({
    clientGraph,
    manifest: parsed.manifest,
    options,
    serverEntry,
  });
}
