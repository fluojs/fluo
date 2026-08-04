/** Parsed lifecycle and path options for one typegen invocation. */
export type ParsedTypegenArgs = {
  readonly check: boolean;
  readonly exportName: string;
  readonly modulePath: string;
  readonly outputPath: string;
  readonly watch: boolean;
};

/** Invalid typegen command arguments or unavailable runtime tooling. */
export class TypegenCommandError extends Error {
  readonly name = 'TypegenCommandError';
}

/**
 * Parses command arguments after `fluo typegen`.
 *
 * @param argv Raw typegen command arguments.
 * @returns Parsed module, output, export, and lifecycle options.
 */
export function parseTypegenArgs(argv: readonly string[]): ParsedTypegenArgs {
  let check = false;
  let exportName = 'AppModule';
  let modulePath: string | undefined;
  let outputPath: string | undefined;
  let watch = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--check') {
      check = true;
      continue;
    }
    if (option === '--watch') {
      watch = true;
      continue;
    }
    if (option === '--output') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new TypegenCommandError('Expected --output to have a file path value.');
      }
      outputPath = next;
      index += 1;
      continue;
    }
    if (option === '--export') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new TypegenCommandError('Expected --export to have a symbol name value.');
      }
      exportName = next;
      index += 1;
      continue;
    }
    if (option?.startsWith('-')) {
      throw new TypegenCommandError(`Unknown option for typegen command: ${option}`);
    }
    if (option !== undefined) {
      if (modulePath !== undefined) {
        throw new TypegenCommandError(`Unexpected extra positional argument: ${option}`);
      }
      modulePath = option;
    }
  }

  if (modulePath === undefined || outputPath === undefined) {
    throw new TypegenCommandError('Usage: fluo typegen <module-path> --output <path> [--export <name>] [--check|--watch]');
  }
  if (check && watch) {
    throw new TypegenCommandError('fluo typegen accepts only one of --check or --watch.');
  }

  return { check, exportName, modulePath, outputPath, watch };
}
