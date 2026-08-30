import { realpath } from 'node:fs/promises';

/** Raised when an artifact output resolves to its input application module. */
export class OutputPathAliasesModuleError extends Error {
  readonly name = 'OutputPathAliasesModuleError';
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Rejects an artifact path that directly or through a symlink resolves to the input module.
 *
 * @param modulePath Absolute application module path.
 * @param outputPath Absolute artifact output path.
 * @throws {OutputPathAliasesModuleError} When the paths identify the same file.
 */
export async function assertOutputDoesNotAliasModule(
  modulePath: string,
  outputPath: string,
): Promise<void> {
  if (modulePath === outputPath) {
    throw new OutputPathAliasesModuleError('Output path must not identify the input application module.');
  }

  const resolvedModulePath = await realpath(modulePath);
  try {
    const resolvedOutputPath = await realpath(outputPath);
    if (resolvedModulePath === resolvedOutputPath) {
      throw new OutputPathAliasesModuleError('Output path must not identify the input application module.');
    }
  } catch (error: unknown) {
    if (error instanceof OutputPathAliasesModuleError || !isMissingPathError(error)) {
      throw error;
    }
  }
}
