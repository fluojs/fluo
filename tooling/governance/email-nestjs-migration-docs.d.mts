export const emailNestjsMigrationMarkerPrefix: string;

export function headingBoundedSection(
  markdown: string,
  markerPrefix: string,
  relativePath: string,
): string;

export function enforceEmailNestjsMigrationDocs(
  readText?: (relativePath: string) => string,
): void;
