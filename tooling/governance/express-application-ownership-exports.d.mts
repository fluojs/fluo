type ReadText = (relativePath: string) => string;

export function findExportedApplicationOptions(input: {
  readonly content: string;
  readonly readText: ReadText;
  readonly sourcePath: string;
}): string[];
