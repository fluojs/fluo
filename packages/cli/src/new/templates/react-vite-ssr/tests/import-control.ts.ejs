import type { ReactNavigationFailurePolicy, ReactNavigationModules } from '@fluojs/react/client';

/** Compiled only in Vite's explicit reliability mode, never normal application assets. */
export function controlledImports(modules: ReactNavigationModules): ReactNavigationModules {
  return Object.fromEntries(Object.entries(modules).map(([key, load]) => [key, async () => {
    const control = Reflect.get(window, '__reliabilityImport');
    if (control?.module !== key) return load();
    Reflect.deleteProperty(window, '__reliabilityImport');
    control.started?.();
    try {
      if (control.fault === 'reject') throw new Error('Injected mapped importer rejection');
      const actual = await load();
      await control.release;
      return actual;
    } finally { control.completed?.(); }
  }]));
}

/** Hold the existing policy's decision; the store still owns authority and cancellation. */
export function controlledPolicy(policy: ReactNavigationFailurePolicy): ReactNavigationFailurePolicy {
  return async (failure) => {
    const control = Reflect.get(window, '__reliabilityPolicy');
    if (control === undefined) return policy(failure);
    Reflect.deleteProperty(window, '__reliabilityPolicy');
    control.started();
    try { await control.release; return policy(failure); }
    finally { control.completed(); }
  };
}
