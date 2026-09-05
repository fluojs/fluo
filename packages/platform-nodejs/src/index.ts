import {
  type BootstrapNodeApplicationOptions,
  bootstrapNodeApplication,
  createNodeHttpAdapter,
  type NodeApplicationSignal,
  type NodeHttpAdapterOptions,
  type NodeHttpApplicationAdapter,
  type RunNodeApplicationOptions,
  runNodeApplication,
} from './node/internal-node.js';

export {
  type BootstrapNodeApplicationOptions,
  bootstrapNodeApplication,
  type CorsInput,
  createNodeHttpAdapter,
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
  type NodeApplicationSignal,
  type NodeHttpAdapterOptions,
  NodeHttpApplicationAdapter,
  type RunNodeApplicationOptions,
  registerShutdownSignals,
  runNodeApplication,
} from './node/internal-node.js';
export * from './node/json-logger.js';
export * from './node/logger.js';
export {
  createNodeFileSystemAssetSource,
  type NodeFileSystemAssetPrecompression,
  type NodeFileSystemAssetSourceOptions,
} from './node/node-static-assets.js';

/** Options accepted by `bootstrapNodejsApplication(...)` before the listener starts. */
export type BootstrapNodejsApplicationOptions = BootstrapNodeApplicationOptions;

/** POSIX signals that `runNodejsApplication(...)` can subscribe to for graceful shutdown. */
export type NodejsApplicationSignal = NodeApplicationSignal;

/** Transport-level settings for the raw Node.js adapter factory. */
export type NodejsAdapterOptions = NodeHttpAdapterOptions;

/** Adapter instance returned by `createNodejsAdapter(...)`. */
export type NodejsHttpApplicationAdapter = NodeHttpApplicationAdapter;

/** Options accepted by `runNodejsApplication(...)` for one-call bootstrap, listen, and shutdown wiring. */
export type RunNodejsApplicationOptions = RunNodeApplicationOptions;

/**
 * Bootstrap a fluo module with the raw Node.js adapter without starting the listener.
 *
 * @param rootModule Root fluo module to bootstrap.
 * @param options Node.js bootstrap options applied before the listener starts.
 * @returns A fluo application instance whose listener is not started yet.
 */
export const bootstrapNodejsApplication: typeof bootstrapNodeApplication = bootstrapNodeApplication;

/**
 * Create the raw Node.js HTTP adapter exposed by `@fluojs/platform-nodejs`.
 *
 * @param options Transport-level Node.js settings such as port, retries, body-size limits, and HTTPS options.
 * @returns The Node.js HTTP adapter instance used by the Fluo runtime.
 */
export function createNodejsAdapter(
  options: NodejsAdapterOptions = {},
): NodejsHttpApplicationAdapter {
  return createNodeHttpAdapter(options) as NodejsHttpApplicationAdapter;
}

/**
 * Bootstrap and start a fluo module on the raw Node.js adapter with lifecycle shutdown wiring.
 *
 * @param rootModule Root fluo module to bootstrap and start.
 * @param options Node.js run options, including optional shutdown signal ownership.
 * @returns A started fluo application instance.
 */
export const runNodejsApplication: typeof runNodeApplication = runNodeApplication;
