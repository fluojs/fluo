import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { AuthGuard } from '../guard.js';
import { PassportModule } from '../module.js';
import type { AuthStrategyRegistration, PassportModuleOptions } from '../types.js';
import {
  COOKIE_AUTH_OPTIONS,
  COOKIE_AUTH_STRATEGY_NAME,
  CookieAuthStrategy,
} from './cookie-auth.js';
import { CookieManager, type CookieManagerConfig } from './cookie-manager.js';

type CookieAuthModuleType = ModuleType;

/**
 * Canonical module-first entrypoint for the built-in cookie-auth preset.
 */
export class CookieAuthModule {
  /**
   * Registers cookie-auth providers and their passport strategy as a complete module recipe.
   *
   * @param config Optional shared cookie reader and writer configuration.
   * @param passportOptions Passport defaults for the single registry owned by this recipe.
   * @param additionalStrategies Other strategies composed with the cookie strategy in that registry.
   * @returns A module definition that exports `AuthGuard`, `CookieAuthStrategy`, and `CookieManager`.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { JwtModule } from '@fluojs/jwt';
   * import {
   *   CookieAuthModule,
   * } from '@fluojs/passport';
   *
   * @Module({
   *   imports: [
   *     CookieAuthModule.forRoot({
   *       accessTokenCookieName: 'session_access',
   *       cookieOptions: { path: '/sessions' },
   *     }),
   *     JwtModule.forRoot({
   *       algorithms: ['HS256'],
   *       global: true,
   *       secret: 'your-secure-secret',
   *     }),
   *   ],
   * })
   * export class AuthModule {}
   * ```
   */
  static forRoot(
    config?: CookieManagerConfig,
    passportOptions: PassportModuleOptions = {},
    additionalStrategies: AuthStrategyRegistration[] = [],
  ): CookieAuthModuleType {
    class CookieAuthRuntimeModule extends CookieAuthModule {}

    return defineModule(CookieAuthRuntimeModule, {
      exports: [AuthGuard, CookieAuthStrategy, CookieManager],
      imports: [
        PassportModule.forRoot(
          {
            ...passportOptions,
            defaultStrategy: passportOptions.defaultStrategy ?? COOKIE_AUTH_STRATEGY_NAME,
          },
          [
            { name: COOKIE_AUTH_STRATEGY_NAME, token: CookieAuthStrategy },
            ...additionalStrategies,
          ],
        ),
      ],
      providers: [
        {
          provide: COOKIE_AUTH_OPTIONS,
          useValue: config ?? {},
        },
        CookieAuthStrategy,
        {
          inject: [],
          provide: CookieManager,
          useFactory: () => CookieManager.create(config),
        },
      ] satisfies Provider[],
    });
  }
}
