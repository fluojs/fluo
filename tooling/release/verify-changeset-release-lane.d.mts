export type ChangesetReleaseBump = 'patch' | 'minor' | 'major';

export type ChangesetReleaseLane = 'stable' | 'prerelease';

export type ChangesetReleaseIntent = {
  body: string;
  bump: ChangesetReleaseBump;
  filePath: string;
  packageName: string;
};

export type PackageVersionDelta = {
  bump: ChangesetReleaseBump;
  filePath: string;
  nextVersion: string;
  packageName: string;
  previousVersion: string;
};

export type DependencyOnlyMajorVersionDelta = PackageVersionDelta & {
  changelogPath: string;
  reason: string;
};

export type PatchCliFeatureDowngrade = {
  changelogPath?: string;
  filePath?: string;
  nextVersion?: string;
  packageName: '@fluojs/cli';
  releaseText: string;
  source: 'changeset' | 'package-changelog';
};

export type PatchStudioRouteKindInputContractNarrowing = {
  changelogPath?: string;
  filePath?: string;
  nextVersion?: string;
  packageName: '@fluojs/studio';
  releaseText: string;
  source: 'changeset' | 'package-changelog';
};

export type StableNodeEngineRangeNarrowing = {
  filePath: string;
  nextEngineRange: string;
  packageName: string;
  previousEngineRange: string;
  previousVersion: string;
};

export type VerifyChangesetReleaseLaneOptions = {
  baseRef?: string;
  changesetDirectory?: string;
  lane?: ChangesetReleaseLane;
};

export type VerifyChangesetReleaseLaneResult = {
  allowedBumps: ChangesetReleaseBump[];
  checkedDependencyOnlyMajorVersionDeltas: DependencyOnlyMajorVersionDelta[];
  checkedIntents: ChangesetReleaseIntent[];
  checkedPatchCliFeatureDowngrades: PatchCliFeatureDowngrade[];
  checkedPatchStudioRouteKindInputContractNarrowings: PatchStudioRouteKindInputContractNarrowing[];
  checkedStableNodeEngineRangeNarrowings: StableNodeEngineRangeNarrowing[];
  checkedVersionDeltas: PackageVersionDelta[];
  lane: ChangesetReleaseLane;
};

export function verifyChangesetReleaseLane(
  options?: VerifyChangesetReleaseLaneOptions,
  dependencies?: Record<string, unknown>,
): VerifyChangesetReleaseLaneResult;

export function main(argv?: string[]): void;
