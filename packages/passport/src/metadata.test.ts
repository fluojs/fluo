import { Controller, Get } from '@konekti/http';
import { describe, expect, it } from 'vitest';

import { RequireScopes, UseAuth } from './decorators.js';
import { getAuthRequirement } from './metadata.js';

describe('auth metadata scope merge', () => {
  it('deduplicates scope requirements across class and method decorators', () => {
    @Controller('/metadata')
    @UseAuth('jwt')
    @RequireScopes('profile:read')
    @RequireScopes('profile:read', 'profile:write')
    class ProfileController {
      @Get('/')
      @RequireScopes('profile:read')
      @RequireScopes('profile:write', 'profile:write')
      getProfile() {
        return undefined;
      }
    }

    expect(getAuthRequirement(ProfileController)).toEqual({
      scopes: ['profile:read', 'profile:write'],
      strategy: 'jwt',
    });
    expect(getAuthRequirement(ProfileController, 'getProfile')).toEqual({
      scopes: ['profile:read', 'profile:write'],
      strategy: 'jwt',
    });
  });

  it('keeps class scopes while method strategy overrides class strategy', () => {
    @Controller('/metadata')
    @UseAuth('jwt')
    @RequireScopes('profile:read')
    class ProfileController {
      @Get('/')
      @UseAuth('session')
      @RequireScopes('profile:read', 'profile:write')
      getProfile() {
        return undefined;
      }
    }

    expect(getAuthRequirement(ProfileController, 'getProfile')).toEqual({
      scopes: ['profile:read', 'profile:write'],
      strategy: 'session',
    });
  });
});
