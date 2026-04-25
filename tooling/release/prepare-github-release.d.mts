export function parseReleaseTag(tag: string): {
  packageName: string | null;
  tag: string;
  version: string;
};

export function sectionForVersion(changelog: string, version: string): string;

export function packageSectionForVersion(section: string, packageName: string, version: string): string;

export function buildGitHubReleaseNotes(tag: string, changelog: string): string;

export function main(argv?: string[]): void;
