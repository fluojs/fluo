export type DocumentSnapshots = Readonly<Record<string, {
  readonly base?: string;
  readonly head?: string;
}>>;

export function isNavigationDocument(path: string): boolean;

export function behavioralChangedFiles(
  changedFiles: readonly string[],
  documentSnapshots?: DocumentSnapshots,
): string[];
