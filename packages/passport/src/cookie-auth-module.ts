import type { Provider } from '@konekti/di';
import { DefaultJwtVerifier } from '@konekti/jwt';

import {
  COOKIE_AUTH_OPTIONS,
  COOKIE_AUTH_STRATEGY_NAME,
  CookieAuthStrategy,
  type CookieAuthOptions,
} from './cookie-auth.js';
import { CookieManager, type CookieManagerConfig } from './cookie-manager.js';
import type { AuthStrategyRegistration } from './types.js';

export interface CookieAuthPresetConfig {
  cookieAuth?: CookieAuthOptions;
  cookieManager?: CookieManagerConfig;
}

export function createCookieAuthProviders(config?: CookieAuthPresetConfig): Provider[] {
  return [
    {
      provide: COOKIE_AUTH_OPTIONS,
      useValue: config?.cookieAuth ?? {},
    },
    CookieAuthStrategy,
    {
      inject: [],
      provide: CookieManager,
      useFactory: () => new CookieManager(config?.cookieManager),
    },
  ];
}

export function createCookieAuthStrategyRegistration(): AuthStrategyRegistration {
  return {
    name: COOKIE_AUTH_STRATEGY_NAME,
    token: CookieAuthStrategy,
  };
}

export function createCookieAuthPreset(config?: CookieAuthPresetConfig): {
  providers: Provider[];
  strategy: AuthStrategyRegistration;
} {
  return {
    providers: createCookieAuthProviders(config),
    strategy: createCookieAuthStrategyRegistration(),
  };
}
