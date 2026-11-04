/** Canonical migration guide for retired Deno application hosts. */
export const DENO_MIGRATION_URL = 'https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-from-deno.md';

/** Runtime identifier retained for rejecting legacy input. */
export const RETIRED_DENO_RUNTIME: string = 'deno';

/** Adapter dependency identifying legacy Deno projects. */
export const RETIRED_DENO_PLATFORM_PACKAGE = '@fluojs/platform-deno';

/**
 * Formats a Deno support-ended diagnostic.
 * @param surface Requested starter or lifecycle surface.
 * @returns Diagnostic containing the migration URL.
 */
export function denoSupportEndedMessage(surface: string): string {
  return `Deno support has ended: ${surface}. `
    + 'Deno starters and Deno dev/build/start lifecycle routing were removed from the fluo CLI '
    + 'and Deno requests never fall back to another runtime. '
    + `Migrate existing Deno projects to Node.js, Bun, or Cloudflare Workers: ${DENO_MIGRATION_URL}`;
}
