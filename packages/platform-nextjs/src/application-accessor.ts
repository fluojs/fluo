const registryKey = Symbol.for('@fluojs/platform-nextjs/applications/v1');
const processGlobal: typeof globalThis & {
  [registryKey]?: Map<string, Promise<unknown>>;
} = globalThis;

/** Application-owned identity and lazy bootstrap shared by server bundles. */
export interface NextApplicationOptions<T> {
  /** Stable, application-owned namespace; all callers of one key must agree on T. */
  readonly key: string;
  /** Bootstrap application resources only, never request, actor, or session state. */
  readonly load: () => Promise<T>;
}

/**
 * Define a lazy accessor sharing one application promise within a JS global.
 *
 * The first invocation for a key owns bootstrap, including synchronous throws.
 * Success and failure remain cached for the process lifetime. Later definitions,
 * including HMR evaluations, cannot replace it. The application owner must drain
 * consumers and close/dispose resources; this accessor never retries, resets,
 * registers signals, or reopens a closed application. Restart the host to reload.
 * Workers, serverless instances, and distinct JS globals do not share this cache.
 *
 * @param options Application namespace and request-independent bootstrap loader.
 * @returns An accessor yielding the exact shared promise, without eager loading.
 */
export function defineNextApplication<T>(options: NextApplicationOptions<T>): () => Promise<T>;
/**
 * Store an application promise under its caller-owned process-local identity.
 *
 * @param options Application namespace and lazy loader.
 * @returns The accessor for that identity.
 */
export function defineNextApplication(
  options: NextApplicationOptions<unknown>,
): () => Promise<unknown> {
  const { key, load } = options;
  return () => {
    const registry = processGlobal[registryKey] ??= new Map();
    let application = registry.get(key);
    if (!application) {
      // Publish before invoking user code, including reentrant loader calls.
      application = Promise.resolve().then(load);
      registry.set(key, application);
    }
    return application;
  };
}
