import type { ReleaseIntentPackageEntry, WorkspacePackageManifestRecord } from './release-intents.mjs';

export type PublicPackageDependencyField = 'dependencies' | 'peerDependencies' | 'optionalDependencies';

export type PublicPackageDependencyGraph = {
  dependenciesByPackage: Record<string, string[]>;
  dependentsByPackage: Record<string, string[]>;
  publicPackageNames: string[];
};

export type PublicPackageDependencyImpactEntry = {
  disposition: Extract<ReleaseIntentPackageEntry['disposition'], 'release' | 'downstream-evaluate'>;
  package: string;
};

export type PublicPackageDependencyImpactOptions = {
  graph?: PublicPackageDependencyGraph;
  packageManifests?: WorkspacePackageManifestRecord[];
};

export const publicPackageDependencyFields: ReadonlyArray<PublicPackageDependencyField>;

export function buildPublicPackageDependencyGraph(
  packageManifests?: WorkspacePackageManifestRecord[],
): PublicPackageDependencyGraph;
export function expandPublicPackageDependencyImpact(
  releasedPackageNames: string[],
  options?: PublicPackageDependencyImpactOptions,
): PublicPackageDependencyImpactEntry[];
