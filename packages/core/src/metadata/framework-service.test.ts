import { describe, expect, it } from 'vitest';

import {
  defineFrameworkServiceIdentity,
  getFrameworkServiceIdentity,
  normalizeFrameworkServiceToken,
} from './framework-service.js';

describe('framework service identity metadata', () => {
  it('shares a versioned internal token only for explicitly designated compatible constructors', () => {
    class ServiceCopyA {}
    class ServiceCopyB {}
    const UserServiceA = class UserService {};
    const UserServiceB = class UserService {};

    defineFrameworkServiceIdentity(ServiceCopyA, {
      id: '@fluojs/test/service',
      version: 1,
    });
    defineFrameworkServiceIdentity(ServiceCopyB, {
      id: '@fluojs/test/service',
      version: 1,
    });

    expect(normalizeFrameworkServiceToken(ServiceCopyA)).toBe(normalizeFrameworkServiceToken(ServiceCopyB));
    expect(normalizeFrameworkServiceToken(UserServiceA)).toBe(UserServiceA);
    expect(normalizeFrameworkServiceToken(UserServiceB)).toBe(UserServiceB);
    expect(getFrameworkServiceIdentity(ServiceCopyA)).toEqual({
      id: '@fluojs/test/service',
      version: 1,
    });
  });

  it('does not alias incompatible framework service identity versions', () => {
    class VersionOne {}
    class VersionTwo {}

    defineFrameworkServiceIdentity(VersionOne, {
      id: '@fluojs/test/service',
      version: 1,
    });
    defineFrameworkServiceIdentity(VersionTwo, {
      id: '@fluojs/test/service',
      version: 2,
    });

    expect(normalizeFrameworkServiceToken(VersionOne)).not.toBe(normalizeFrameworkServiceToken(VersionTwo));
  });
});
