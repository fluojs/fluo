/**
 * Validates the source and manifest boundaries of the Metrics public API.
 *
 * @param files Source text and package metadata for the governed entrypoints.
 * @returns Nothing when all governed boundaries are valid.
 */
export function enforceMetricsRegistryIntegrationBoundary(files: {
  readonly root: string;
  readonly integration: string;
  readonly module: string;
  readonly manifest: string;
}): void;
