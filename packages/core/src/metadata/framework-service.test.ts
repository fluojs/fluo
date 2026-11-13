import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  defineFrameworkServiceIdentity,
  FrameworkService,
  getFrameworkServiceIdentity,
  normalizeFrameworkServiceToken,
} from './framework-service.js';

describe('framework service identity metadata', () => {
  it('FrameworkService: standard class decoration records the compatible identity', () => {
    const identity = { id: '@fluojs/test/decorated-service', version: 1 };
    expectTypeOf(FrameworkService(identity)).toEqualTypeOf<
      (value: Function, context: ClassDecoratorContext) => void
    >();

    @FrameworkService(identity)
    class DecoratedService {}

    expect(getFrameworkServiceIdentity(DecoratedService)).toEqual(identity);
    expect(normalizeFrameworkServiceToken(DecoratedService)).toBe(
      Symbol.for('fluo.framework-service/@fluojs/test/decorated-service/v1'),
    );
  });

  it.each([
    { id: '', version: 1 },
    { id: '@fluojs/test/service', version: 0 },
    { id: '@fluojs/test/service', version: 1.5 },
  ])('FrameworkService: invalid identity %j throws before decoration', (identity) => {
    expect(() => FrameworkService(identity)).toThrow(TypeError);
  });

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
