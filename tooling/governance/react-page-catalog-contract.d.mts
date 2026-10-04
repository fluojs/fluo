/**
 * Enforce compiled HTTP catalog provenance and its existing companion surfaces.
 *
 * @param readText Reader for each governed source or documentation path.
 * @throws When required catalog markers or authoritative version selection are missing.
 */
export function enforceReactPageCatalogContract(
  readText?: (relativePath: string) => string,
): void;
