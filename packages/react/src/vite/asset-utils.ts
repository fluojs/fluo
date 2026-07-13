import type { ReactAssetMap, ReactBootstrapAsset, ReactBootstrapScriptDescriptor } from '../server-entry.js';

import { ABSOLUTE_URL_PATTERN, JAVASCRIPT_OUTPUT_EXTENSIONS } from './types.js';
import { createMalformedDiagnostic } from './diagnostics.js';
import type { DependencyGraph, ParsedManifest, ParsedManifestEntry } from './types.js';

/**
 * Collects the import graph for a client manifest entry with dependencies first.
 *
 * @param manifest Parsed Vite manifest.
 * @param rootEntry Browser hydration entry.
 * @returns Ordered graph entries and missing-import diagnostics.
 */
export function collectDependencyGraph(
  manifest: ParsedManifest,
  rootEntry: ParsedManifestEntry,
): DependencyGraph {
  const diagnostics: DependencyGraph['diagnostics'][number][] = [];
  const entries: ParsedManifestEntry[] = [];
  const visited = new Set<string>();

  function visit(entry: ParsedManifestEntry): void {
    if (visited.has(entry.id)) {
      return;
    }

    visited.add(entry.id);

    for (const importId of entry.imports) {
      const importedEntry = manifest[importId];

      if (importedEntry === undefined) {
        diagnostics.push(
          createMalformedDiagnostic(
            `React Vite manifest entry "${entry.id}" imports missing chunk "${importId}".`,
            `${entry.id}.imports`,
          ),
        );
        continue;
      }

      visit(importedEntry);
    }

    entries.push(entry);
  }

  visit(rootEntry);

  return { diagnostics, entries };
}

function normalizeBase(base: string | undefined): string {
  if (base === undefined) {
    return '/';
  }

  if (base === '') {
    return '';
  }

  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Resolves a Vite manifest file path to a public URL.
 *
 * @param file Manifest file path or already absolute URL.
 * @param base Optional Vite base path.
 * @returns Public URL suitable for emitted HTML or asset maps.
 */
export function createPublicUrl(file: string, base: string | undefined): string {
  if (file.startsWith('/') || ABSOLUTE_URL_PATTERN.test(file)) {
    return file;
  }

  return `${normalizeBase(base)}${file}`;
}

function stripUrlSuffix(file: string): string {
  const queryIndex = file.indexOf('?');
  const hashIndex = file.indexOf('#');
  const suffixIndexes = [queryIndex, hashIndex].filter((index) => index >= 0);

  if (suffixIndexes.length === 0) {
    return file;
  }

  return file.slice(0, Math.min(...suffixIndexes));
}

/**
 * Checks whether a Vite output path is a JavaScript chunk supported by the React Vite bridge.
 *
 * @param file Manifest output file path.
 * @returns `true` when the output path has a supported JavaScript extension.
 */
export function isJavaScriptOutput(file: string): boolean {
  const pathname = stripUrlSuffix(file);

  return JAVASCRIPT_OUTPUT_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

function getBootstrapAssetSource(asset: ReactBootstrapAsset): string {
  return typeof asset === 'string' ? asset : asset.src;
}

function cloneBootstrapDescriptor(asset: ReactBootstrapScriptDescriptor): ReactBootstrapScriptDescriptor {
  return {
    ...(asset.crossOrigin !== undefined ? { crossOrigin: asset.crossOrigin } : {}),
    ...(asset.integrity !== undefined ? { integrity: asset.integrity } : {}),
    src: asset.src,
  };
}

function cloneBootstrapAsset(asset: ReactBootstrapAsset): ReactBootstrapAsset {
  return typeof asset === 'string' ? asset : cloneBootstrapDescriptor(asset);
}

/**
 * Clones bootstrap assets while preserving first-seen order by source URL.
 *
 * @param assets Bootstrap assets to clone and deduplicate.
 * @returns Defensive bootstrap asset snapshot.
 */
export function cloneUniqueBootstrapAssets(
  assets: readonly ReactBootstrapAsset[],
): readonly ReactBootstrapAsset[] {
  const cloned: ReactBootstrapAsset[] = [];
  const seenSources = new Set<string>();

  for (const asset of assets) {
    const source = getBootstrapAssetSource(asset);

    if (seenSources.has(source)) {
      continue;
    }

    seenSources.add(source);
    cloned.push(cloneBootstrapAsset(asset));
  }

  return cloned;
}

function appendUniqueUrls(target: string[], seen: Set<string>, urls: readonly string[]): void {
  for (const url of urls) {
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    target.push(url);
  }
}

/**
 * Collects stylesheet URLs in dependency order with duplicate removal.
 *
 * @param entries Dependency-ordered client graph entries.
 * @param base Optional Vite base path.
 * @returns Stylesheet URLs ordered before hydration scripts.
 */
export function collectCssUrls(
  entries: readonly ParsedManifestEntry[],
  base: string | undefined,
): readonly string[] {
  const css: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    appendUniqueUrls(
      css,
      seen,
      entry.css.map((file) => createPublicUrl(file, base)),
    );
  }

  return css;
}

/**
 * Collects JavaScript module URLs in dependency order.
 *
 * @param entries Dependency-ordered client graph entries.
 * @param base Optional Vite base path.
 * @returns Public JavaScript module URLs.
 */
export function collectModuleUrls(
  entries: readonly ParsedManifestEntry[],
  base: string | undefined,
): readonly string[] {
  return entries.map((entry) => createPublicUrl(entry.file, base));
}

/**
 * Creates a defensive asset map snapshot from every manifest file, stylesheet, and static asset.
 *
 * @param manifest Parsed Vite manifest.
 * @param base Optional Vite base path.
 * @returns Asset map compatible with the stable React server entry contract.
 */
export function createAssetMap(manifest: ParsedManifest, base: string | undefined): ReactAssetMap {
  const assetMap: Record<string, string> = {};

  for (const [entryId, entry] of Object.entries(manifest)) {
    const publicFile = createPublicUrl(entry.file, base);
    assetMap[entryId] = publicFile;
    assetMap[entry.file] = publicFile;

    if (entry.name !== undefined) {
      assetMap[entry.name] = publicFile;
    }

    if (entry.src !== undefined) {
      assetMap[entry.src] = publicFile;
    }

    for (const css of entry.css) {
      assetMap[css] = createPublicUrl(css, base);
    }

    for (const asset of entry.assets) {
      assetMap[asset] = createPublicUrl(asset, base);
    }
  }

  return assetMap;
}
