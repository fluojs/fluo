import { MIGRATION_TRANSFORMS, type MigrationTransformKind } from '../transforms/nestjs-migrate.js';

const MIGRATION_TRANSFORM_ALIASES: Readonly<Record<string, MigrationTransformKind>> = {
  injectable: 'inject-params',
  testing: 'tests',
};

/**
 * Parse canonical or legacy migration transform tokens from one CLI option.
 *
 * @param rawValue Comma-separated transform tokens passed to the CLI.
 * @param optionName CLI option that supplied the transform tokens.
 * @returns Canonical migration transform kinds.
 * @throws When the option has no tokens or includes an unsupported token.
 */
export function parseMigrationTransformList(
  rawValue: string,
  optionName: '--only' | '--skip',
): MigrationTransformKind[] {
  const values = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(`${optionName} requires a non-empty comma-separated transform list.`);
  }

  const transforms: MigrationTransformKind[] = [];
  const invalid: string[] = [];
  for (const value of values) {
    const transform = MIGRATION_TRANSFORMS.find((candidate) => candidate === value) ?? MIGRATION_TRANSFORM_ALIASES[value];
    if (transform) {
      transforms.push(transform);
    } else {
      invalid.push(value);
    }
  }

  if (invalid.length > 0) {
    throw new Error(`Unknown transform(s): ${invalid.join(', ')}. Available transforms: ${MIGRATION_TRANSFORMS.join(', ')}.`);
  }

  return transforms;
}
