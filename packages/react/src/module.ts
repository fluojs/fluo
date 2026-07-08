import { Module } from '@fluojs/core';

/**
 * Runtime-neutral module marker for the initial `@fluojs/react` scaffold.
 *
 * @remarks
 * Phase 1-1 intentionally registers no providers, controllers, renderers, Vite plugins,
 * React Server Components hooks, or server functions. Import this class only as a stable
 * package boundary for later React integration work.
 */
@Module({})
export class ReactModule {}
