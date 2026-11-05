import type { MaybePromise } from './types.js';

/** Lifecycle hook invoked after one module's providers are instantiated. */
export interface OnModuleInit {
  onModuleInit(): MaybePromise<void>;
}

/** Lifecycle hook invoked after the full application bootstrap finishes. */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): MaybePromise<void>;
}

/** Lifecycle hook invoked when one module is being torn down. */
export interface OnModuleDestroy {
  onModuleDestroy(): MaybePromise<void>;
}

/** Lifecycle hook invoked during application shutdown with the active signal. */
export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): MaybePromise<void>;
}

/** Convenience union covering every public provider lifecycle hook contract. */
export type LifecycleHooks =
  | OnModuleInit
  | OnApplicationBootstrap
  | OnModuleDestroy
  | OnApplicationShutdown;
