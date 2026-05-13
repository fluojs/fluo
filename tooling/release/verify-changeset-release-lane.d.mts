export type ChangesetReleaseBump = 'patch' | 'minor' | 'major';

export type ChangesetReleaseLane = 'stable' | 'prerelease';

export type ChangesetReleaseIntent = {
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

export type VerifyChangesetReleaseLaneOptions = {
  baseRef?: string;
  changesetDirectory?: string;
  lane?: ChangesetReleaseLane;
};

export type VerifyChangesetReleaseLaneResult = {
  allowedBumps: ChangesetReleaseBump[];
  checkedIntents: ChangesetReleaseIntent[];
  checkedVersionDeltas: PackageVersionDelta[];
  lane: ChangesetReleaseLane;
};

export function verifyChangesetReleaseLane(
  options?: VerifyChangesetReleaseLaneOptions,
  dependencies?: Record<string, unknown>,
): VerifyChangesetReleaseLaneResult;

export function main(argv?: string[]): void;
