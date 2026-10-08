const PASSPORT_OPTIONS_KEY = 'fluo.passport.options';
const AUTH_STRATEGY_REGISTRY_KEY = 'fluo.passport.strategy-registry';

/**
 * Provides the passport options value.
 */
export const PASSPORT_OPTIONS = Symbol.for(PASSPORT_OPTIONS_KEY);
/**
 * Provides the auth strategy registry value.
 */
export const AUTH_STRATEGY_REGISTRY = Symbol.for(AUTH_STRATEGY_REGISTRY_KEY);
