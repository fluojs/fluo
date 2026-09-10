import {
  type ForwardRefToken as CoreForwardRefToken,
  Inject,
  type InjectionToken,
  Module,
  type OptionalInjectToken as CoreOptionalInjectToken,
  Scope,
} from '@fluojs/core';
import {
  Container,
  ForwardRef,
  type ForwardRefToken,
  Optional,
  type OptionalInjectToken,
  type Scope as ProviderScope,
} from '@fluojs/di';
import * as core from '@fluojs/core';
import * as coreInternal from '@fluojs/core/internal';
import * as pipeline from '@fluojs/core/request-pipeline';
import * as di from '@fluojs/di';
import * as diInternal from '@fluojs/di/internal';

class Dependency { readonly value = 1; }
const deferred: ForwardRefToken<Dependency> = ForwardRef.create(() => Dependency);
const optional: OptionalInjectToken<Dependency> = Optional.create(Dependency);
const sharedDeferred: CoreForwardRefToken<Dependency> = deferred;
const sharedOptional: CoreOptionalInjectToken<Dependency> = optional;
const entries: readonly InjectionToken[] = [sharedDeferred, sharedOptional];
const scopes: readonly ProviderScope[] = ['singleton', 'request', 'transient'];

@Inject(...entries)
@Scope(scopes[0]!)
class Service {
  constructor(readonly dependency: Dependency, readonly optionalDependency: Dependency | undefined) {}
}

@Module({ global: true, providers: [Dependency, Service], exports: [Service] })
class AppModule {}
Module()(AppModule, { kind: 'class', name: 'AppModule', metadata: {}, addInitializer() {} });
Module(undefined);
Inject();
const resolved: Promise<Service> = new Container().resolve(Service);
void resolved;

// @ts-expect-error Arrays must be spread into the variadic decorator.
Inject([Dependency]);
// @ts-expect-error An empty legacy array is not an injection token.
Inject([]);
// @ts-expect-error Scope is a type-only DI export.
di.Scope;
// @ts-expect-error Scope literals remain a closed union.
const invalidScope: ProviderScope = 'global';
void invalidScope;
// @ts-expect-error The old DI wrapper type is removed.
type RemovedForward = di.ForwardRefFn;
// @ts-expect-error The old DI wrapper type is removed.
type RemovedOptional = di.OptionalToken;

for (const api of [core, coreInternal, pipeline, di, diInternal] as const) {
  // @ts-expect-error Removed decorators are not available on any public entrypoint.
  api.Global;
  // @ts-expect-error Free-function creation is not re-exported on another entrypoint.
  api.forwardRef;
  // @ts-expect-error Free-function creation is not re-exported on another entrypoint.
  api.optional;
}
