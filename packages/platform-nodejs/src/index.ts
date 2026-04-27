import {
  type BootstrapNodeApplicationOptions,
  bootstrapNodeApplication,
  createNodeHttpAdapter,
  type NodeApplicationSignal,
  type NodeHttpAdapterOptions,
  type NodeHttpApplicationAdapter,
  type RunNodeApplicationOptions,
  runNodeApplication,
} from '@fluojs/runtime/node';

/**
 * Options accepted by `bootstrapNodejsApplication(...)` before the listener starts.
 *
 * @remarks
 * This type mirrors the supported Node application bootstrap options from `@fluojs/runtime/node`
 * while keeping the `@fluojs/platform-nodejs` public surface documented at its package boundary.
 */
export type BootstrapNodejsApplicationOptions = BootstrapNodeApplicationOptions;

/**
 * POSIX signals that `runNodejsApplication(...)` can subscribe to for graceful shutdown.
 *
 * @remarks
 * Pass `false` to `RunNodejsApplicationOptions.shutdownSignals` when the host process owns signal
 * registration and should call `app.close()` itself.
 */
export type NodejsApplicationSignal = NodeApplicationSignal;

/**
 * Transport-level settings for the raw Node.js adapter factory.
 *
 * @remarks
 * `maxBodySize` is enforced while request bytes stream in and also seeds the multipart total-size
 * limit unless `bootstrapNodejsApplication(...)` or `runNodejsApplication(...)` provides an
 * explicit `multipart.maxTotalSize` value.
 */
export type NodejsAdapterOptions = NodeHttpAdapterOptions;

/**
 * Adapter instance returned by `createNodejsAdapter(...)`.
 *
 * @remarks
 * The alias preserves the public `@fluojs/runtime/node` adapter contract, including access to the
 * underlying Node server via `getServer()` for server-backed realtime integrations.
 */
export type NodejsHttpApplicationAdapter = NodeHttpApplicationAdapter;

/**
 * Options accepted by `runNodejsApplication(...)` for one-call bootstrap, listen, and shutdown wiring.
 *
 * @remarks
 * Signal-driven shutdown logs timeout or failure conditions and sets `process.exitCode`, but final
 * process termination remains owned by the surrounding host runtime.
 */
export type RunNodejsApplicationOptions = RunNodeApplicationOptions;

/**
 * Bootstrap a fluo module with the raw Node.js adapter without starting the listener.
 *
 * @remarks
 * This alias keeps the package-level Node.js naming convention while delegating to the supported
 * `@fluojs/runtime/node` implementation.
 *
 * @param rootModule Root fluo module to bootstrap.
 * @param options Node.js bootstrap options applied before the listener starts.
 * @returns A fluo application instance whose listener is not started yet.
 */
export const bootstrapNodejsApplication: typeof bootstrapNodeApplication = bootstrapNodeApplication;

/**
 * Create the raw Node.js HTTP adapter exposed by `@fluojs/platform-nodejs`.
 *
 * @remarks
 * Use this factory for adapter-first startup through `fluoFactory.create(...)` when the application
 * should run directly on Node's built-in `http` or `https` server primitives.
 *
 * @param options Transport-level Node.js settings such as port, retries, multipart, and HTTPS options.
 * @returns The Node.js HTTP adapter instance used by the Fluo runtime.
 *
 * @example
 * ```ts
 * const adapter = createNodejsAdapter({ port: 3000 });
 * ```
 */
export function createNodejsAdapter(
  options: NodeHttpAdapterOptions = {},
): NodeHttpApplicationAdapter {
  return createNodeHttpAdapter(options) as NodeHttpApplicationAdapter;
}

/**
 * Bootstrap and start a fluo module on the raw Node.js adapter with lifecycle shutdown wiring.
 *
 * @remarks
 * This alias is the zero-boilerplate package entrypoint for Node.js hosts. It preserves the runtime
 * helper behavior: graceful shutdown is bounded and reported, while final process exit remains under
 * host ownership.
 *
 * @param rootModule Root fluo module to bootstrap and start.
 * @param options Node.js run options, including optional shutdown signal ownership.
 * @returns A started fluo application instance.
 */
export const runNodejsApplication: typeof runNodeApplication = runNodeApplication;
