export type ReactRscGraduationReadText = (relativePath: string) => string;

export function enforceReactRscGraduationEvidenceUpdates(
  changedFiles: readonly string[],
  readText?: ReactRscGraduationReadText,
): void;
export function enforceReactRscGraduationGovernance(
  changedFiles: readonly string[],
  readText?: ReactRscGraduationReadText,
): void;
export function enforceReactRscGraduationPolicy(readText?: ReactRscGraduationReadText): void;
