export type ReactRscGraduationReadText = (relativePath: string) => string;
export type ReactRscGraduationGitProbe = Readonly<{
  commitExists(commit: string): boolean;
  isAncestorOfHead(commit: string): boolean;
}>;

export function enforceReactRscGraduationEvidenceUpdates(
  changedFiles: readonly string[],
  readText?: ReactRscGraduationReadText,
  gitProbe?: ReactRscGraduationGitProbe,
): void;
export function enforceReactRscGraduationGovernance(
  changedFiles: readonly string[],
  readText?: ReactRscGraduationReadText,
  gitProbe?: ReactRscGraduationGitProbe,
): void;
export function enforceReactRscGraduationPolicy(readText?: ReactRscGraduationReadText): void;
