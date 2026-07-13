export class PackageChangelogContractError extends Error {}

export function normalizePackageChangelog(changelog: string): string;
export function packageChangelogContractViolation(changelog: string): string | undefined;
