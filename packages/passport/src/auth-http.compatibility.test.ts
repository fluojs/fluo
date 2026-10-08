import * as auth from '@fluojs/auth';
import * as canonical from '@fluojs/auth-http';
import { Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import * as legacy from './index.js';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

describe('canonical and compatibility auth composition', () => {
  it('shares class, error, metadata and registration identities with legacy imports', () => {
    expect(canonical.AuthModule).toBe(legacy.PassportModule);
    for (const [current, previous] of [
      [canonical.AuthGuard, legacy.AuthGuard],
      [canonical.BearerJwtStrategy, legacy.BearerJwtStrategy],
      [canonical.CookieAuthModule, legacy.CookieAuthModule],
      [canonical.CookieAuthStrategy, legacy.CookieAuthStrategy],
      [canonical.CookieManager, legacy.CookieManager],
      [canonical.RefreshTokenModule, legacy.RefreshTokenModule],
      [canonical.RefreshTokenStrategy, legacy.RefreshTokenStrategy],
      [canonical.UseAuth, legacy.UseAuth],
      [canonical.UseOptionalAuth, legacy.UseOptionalAuth],
      [canonical.RequireScopes, legacy.RequireScopes],
      [canonical.defineAuthRequirement, legacy.defineAuthRequirement],
      [canonical.getAuthRequirement, legacy.getAuthRequirement],
    ]) {
      expect(current).toBe(previous);
    }
    expect(auth.AuthenticationFailedError).toBe(legacy.AuthenticationFailedError);
    expect(auth.AccountLinkConflictError).toBe(legacy.AccountLinkConflictError);
    expect(auth.ACCOUNT_LINKING_POLICY).toBe(legacy.ACCOUNT_LINKING_POLICY);
    expect(auth.isAuthError).toBe(legacy.isPassportError);
    expect(canonical).not.toHaveProperty('AUTH_STRATEGY_REGISTRY');
    expect(canonical).not.toHaveProperty('PASSPORT_OPTIONS');
  });

  it('enforces mixed decorators through a canonical registry and a non-JWT strategy', async () => {
    class Strategy implements canonical.AuthStrategy {
      authenticate(context: Parameters<canonical.AuthStrategy['authenticate']>[0]): auth.AuthStrategyResult {
        const mode = context.requestContext.request.headers.mode;
        if (mode === 'guest') return { authenticated: false };
        if (mode === 'handled') {
          context.requestContext.response.redirect(302, '/complete');
          return { handled: true, principal: { subject: '', claims: {} } };
        }
        return { subject: 'custom', claims: {}, scopes: mode === 'scoped' ? ['read'] : [] };
      }
    }
    @Controller('/mixed')
    class Routes {
      @Get('/optional')
      @legacy.UseOptionalAuth('custom')
      optional(_input: unknown, context: RequestContext) {
        return { subject: context.principal?.subject ?? null };
      }

      @Get('/scoped')
      @canonical.UseAuth('custom')
      @legacy.RequireScopes('read')
      scoped(_input: unknown, context: RequestContext) {
        return { subject: context.principal?.subject };
      }
    }
    @Module({
      controllers: [Routes],
      imports: [canonical.AuthModule.forRoot({}, [{ name: 'custom', token: Strategy }])],
      providers: [Strategy],
    })
    class App {}
    const app = await Test.createApp({ rootModule: App });

    try {
      expect(await app.request('GET', '/mixed/optional').header('mode', 'guest').send())
        .toMatchObject({ status: 200, body: { subject: null } });
      expect(await app.request('GET', '/mixed/scoped').send()).toMatchObject({ status: 403 });
      expect(await app.request('GET', '/mixed/scoped').header('mode', 'scoped').send())
        .toMatchObject({ status: 200, body: { subject: 'custom' } });
      expect(await app.request('GET', '/mixed/scoped').header('mode', 'handled').send())
        .toMatchObject({ status: 302 });
    } finally {
      await app.close();
    }
  });
});
