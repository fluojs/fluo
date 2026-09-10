# Standard Decorators and the Role of Build Tools

<!-- book:volume=03-internals;chapter=02 -->

[Previous: Tracing an Order Request Through the Source](./ch01-trace-an-order.md) | [Volume 3 Contents](./toc.md) | [Next: Where Is Metadata Stored?](./ch03-metadata-ownership.md)

## The Tests Are Green, but the Order Route Has Disappeared

The previous chapter traced an order lookup through declarations, bootstrap, and request execution. But something strange happens while tidying the build configuration after adding the shop to FluoBlog. The order service's unit tests pass, yet DTO fields are not bound in the built application. One developer assumes that upgrading TypeScript must have improved decorator support as well. Another argues that using Node24 means the transform plugin is no longer needed. Both have bundled different responsibilities into a single word: "support."

The TypeScript type checker understanding the source, Babel transforming decorators into JavaScript, Vite bundling modules, and Node evaluating the final modules are separate tasks. A higher version number for any one of them does not prove the contracts of the other stages. In particular, when the test runner and the deployed application use different transformation paths, passing tests are not evidence for the deployment transformation. In this chapter, we observe that difference using the same order service.

Fluo does not use the legacy model that depends on `experimentalDecorators` and `emitDecoratorMetadata`. The current application build plugin selects Babel's `2023-11` standard decorator semantics. That date is the actual transformation setting, not shorthand for the TC39 proposal's stage or for a particular runtime's native syntax support. We use Node24 and pnpm10 as our execution baseline, but transform TypeScript containing decorators into JavaScript at the documented build boundary.

## Decorators Are Not Configuration Functions Called for Each Request

First, separate the execution times. In the expression `@Inject(ORDER_LOOKUP)`, the `Inject(...)` factory runs while the class declaration is being evaluated and produces a decorator function. That function is applied to the class and records token metadata. Later, the DI container reads the record when constructing the class. `Inject(...)` does not run again every time the controller looks up an order.

A standard method decorator receives the method value and a context. The context includes `kind`, `name`, `static`, `private`, `addInitializer`, and a metadata integration point. Its calling convention differs from the legacy `(target, propertyKey, descriptor)`. An example that treats context as a descriptor and modifies `descriptor.value` is structurally incompatible. Applying the standard class decorator `@Inject` to a constructor parameter is not the current Fluo API either.

The following is a **complete experiment file**, `src/decorators/order-probe.ts`. It creates a description of a lookup for the same merchandise operator without changing payment or fulfillment logic. `READ_LABEL` is the actual DI token, and `OrdersModule` declares its providers and exports explicitly. `marked()` is an application-owned decorator for observing invocation timing and the standard metadata bag. Chapter 4 develops the full design for a reusable extension, so here we allow only public instance methods.

```ts
import { Inject, Module, Scope } from '@fluojs/core';

export const events: string[] = [];
export const MARKS = Symbol.for('fluo.book-build-probe.marks');
export const READ_LABEL = Symbol('READ_LABEL');

function marked(label: string) {
  events.push(`factory:${label}`);
  return function <This, Args extends unknown[], Result>(
    value: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Result
    >,
  ) {
    if (context.static || context.private) {
      throw new TypeError('Only public instance methods are supported');
    }
    if (!context.metadata) {
      throw new Error('Metadata preload is required');
    }
    events.push(`apply:${label}:${String(context.name)}`);
    const previous = context.metadata[MARKS];
    const marks: readonly string[] = Array.isArray(previous) ? previous : [];
    context.metadata[MARKS] = Object.freeze([...marks, label]);
    return value;
  };
}

@Scope('singleton')
@Inject(READ_LABEL)
export class OrdersService {
  constructor(private readonly label: string) {
    events.push('construct:OrdersService');
  }

  @marked('outer')
  @marked('inner')
  describe(id: string): string {
    events.push(`call:${id}`);
    return `${this.label}:${id}`;
  }
}

@Module({
  providers: [
    { provide: READ_LABEL, useValue: 'order-summary' },
    OrdersService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
```

Because `marked()` returns the original method unchanged, it does not alter the call's result or `this`. We are observing evaluation order and metadata preservation, not wrapper overhead. Factories are evaluated in source order, while decorators stacked on the same method are applied from the inside out. The expected order here is `factory:outer`, `factory:inner`, `apply:inner:describe`, `apply:outer:describe`. Adding more decorators would prevent us from fixing all global events to these four, so we record only the decorators in this experiment file.

The standard metadata object is data attached to a class declaration, not a request store created separately for each service instance. That is why this code does not write an order ID or customer account into metadata. Recording runtime request values in class metadata allows multiple requests and instances to overwrite the same record. The array recording inside `describe()` is a test-only aid, not something to extend into a real audit log or production telemetry.

## Where Preparation Belongs in ESM

Importing `@fluojs/core` does not by itself install a global `Symbol.metadata`. Distinguish the framework-owned storage used by built-in core decorators from the standard integration point that user decorators access through `context.metadata`. If a user decorator needs the standard bag, run `ensureMetadataSymbol()` before evaluating the decorated module.

The following `src/decorators-main.ts` is a **complete experiment entry point**. ESM evaluation order is why `OrdersService` is not statically imported. Dependencies of static imports are evaluated before the current module's body. Writing an initialization function below the imports in the same file therefore does not guarantee the required order. A dynamic import ensures that the decorated module is evaluated only after initialization completes.

```ts
import assert from 'node:assert/strict';
import { ensureMetadataSymbol, getModuleMetadata } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

const metadataSymbol = ensureMetadataSymbol();
const { events, MARKS, OrdersModule, OrdersService } =
  await import('./decorators/order-probe.js');

assert.deepEqual(events, [
  'factory:outer',
  'factory:inner',
  'apply:inner:describe',
  'apply:outer:describe',
]);
assert.ok(getModuleMetadata(OrdersModule)?.exports?.includes(OrdersService));

const bag: unknown = Reflect.get(OrdersService, metadataSymbol);
assert.ok(typeof bag === 'object' && bag !== null);
assert.deepEqual(Reflect.get(bag, MARKS), ['inner', 'outer']);

const app = await FluoFactory.createApplicationContext(OrdersModule);
try {
  const orders = await app.get(OrdersService);
  assert.equal(orders.describe('order-1001'), 'order-summary:order-1001');
  assert.equal(await app.get(OrdersService), orders);
  assert.equal(
    events.filter((event) => event === 'construct:OrdersService').length,
    1,
  );
  assert.equal(events.filter((event) => event.startsWith('call:')).length, 1);
  console.log('decorator probe assertions passed');
} finally {
  await app.close();
}
```

This experiment does not measure the interval between initialization and invocation using a fixed wait. It checks declaration-stage events when the dynamic import settles, then checks construction and call counts after explicit `get()` and method calls. Since runtime may resolve a singleton during bootstrap, we do not make the stronger assumption that "the constructor runs only immediately before the first get." The observations we need are that import alone did not construct the DI service and that singleton lookups within the same application return the same instance.

An ordinary `new OrdersService('manual')` is manual construction without DI. `@Inject` does not intercept JavaScript's `new` behavior to supply arguments. Nor does `@Scope('singleton')` make the class a JavaScript-global singleton. Scope is a declaration the container reads during resolution. Missing this distinction can lead to putting network connections or service construction inside the decorator itself, acquiring resources as early as import time.

## Why Babel Runs Before Vite's Other Transforms

The following `vite.decorators.config.ts` is a **complete configuration file exclusively for the experiment**. It does not replace the real application's `vite.config.ts`. This file builds only the order probe's entry point into a separate directory, avoiding confusion with the blog's normal `src/main.ts` and its output.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/decorators-main.ts',
    target: 'node24',
    outDir: '.lab-dist/standard-decorators',
    emptyOutDir: false,
    sourcemap: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
```

The project must have `@fluojs/core`, `@fluojs/runtime`, and their runtime dependencies installed. The build boundary's direct dependencies are `@fluojs/vite`, Vite, and the Babel peers. The currently generated non-Deno starter uses Vite `^8.2.2`, but the published peer range of `@fluojs/vite` itself is `vite >=6.2.0`. Do not describe a specific starter version and the plugin's supported range as the same number. The development dependencies and commands needed for a new experiment environment are as follows.

```bash
pnpm add -D @fluojs/vite vite@^8.2.2 @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript
pnpm exec vite build --config vite.decorators.config.ts
node .lab-dist/standard-decorators/main.js
```

These commands are a procedure to run in the reader's project. They do not mean that new dependencies were installed while writing this manuscript or that the build passed in every reader's environment. The expected final output is shown below; runtime startup logs may precede it.

```text
decorator probe assertions passed
```

In `src/decorators-plugin.ts`, the plugin's `enforce: 'pre'` is the key. Babel must handle decorators before Vite's normal transform stage. If Oxc or esbuild changes the original syntax before handing it to Babel, there is no guarantee that Babel can reconstruct the metadata semantics it needs to preserve. Do not explain this boundary merely by saying the plugin appears first in the `plugins` array; check its stage too.

The actual transformation options include `babelrc: false`, `configFile: false`, `{ version: '2023-11' }` for `@babel/plugin-proposal-decorators`, and `{ allowDeclareFields: true }` for `@babel/preset-typescript`. These prevent incidental Babel configuration files in surrounding directories from changing the result and explicitly select the documented standard semantics. The plugin removes types and transforms decorators, but it does not prove type safety. A separate TypeScript check is still needed to catch an error such as passing a string where a `number` is expected.

It is not enough to see that `@marked` has disappeared from the build output. Several transformers can remove syntax. More important evidence comes from executing the output: do values written to `context.metadata` remain, and are decorator application order and service behavior using `this` preserved? That is why the probe does not compare helper names in the output code. Babel versions may change helper names or generated code structure without changing their meaning.

## Which Files Pass Through This Transform?

The plugin does not transform every file. It removes Vite query or hash suffixes, normalizes path separators, and then accepts only application `.ts` files. It skips `.d.ts`, `*.test.ts`, `*.spec.ts`, files inside `node_modules`, and other extensions, including `.tsx`. `/app/src/orders.ts?import` is eligible; `/app/src/orders.test.ts?import` is not. Removing suffixes first ensures that annotations added by the development server do not change the ownership boundary of the same underlying file.

This rule also affects where order lookup code belongs. A decorated service declaration placed alongside a React page in `src/page.tsx` is outside the current application plugin's scope. Keep rendering in `.tsx` and decorated declarations in `src/app.ts` or `src/orders/*.ts`. This is the current transformation boundary provided by Fluo, not a general language rule forbidding JSX and backend code in the same file.

Excluding test files is not an omission either. The generated test environment uses a separate transform from `@fluojs/testing/vitest`. Unconditionally extending the application Vite plugin to test files could cause two transformers to process the same declaration or break test-specific semantics. Conversely, removing the application plugin while leaving a correct Vitest configuration can leave tests passing. This is where the investigation of the initial incident splits. Check the actual ID of the failing file and the transform that processed that ID.

Give decorated DTO fields initial values, or use optional fields. For example, `id = ''` from the previous chapter is supported. `id!: string` may look like syntax that merely tells the type checker to trust initialization, but a decorated definite-assignment field is rejected under Fluo's Babel configuration. Use a supported field declaration instead of enabling legacy decorator mode to remove the error. It remains true that a field's initial value does not replace binding or validation.

## Reproducing Failures at the Transform Boundary

The first failure experiment concerns preload order. In a separate, clean process, verify that the metadata symbol is absent and change the entry point to evaluate `order-probe` first. This should produce `Metadata preload is required`. In an environment where the runtime already supplies `Symbol.metadata`, however, the same change may not fail. In that case, success does not mean the incorrect import order is safe in every environment. Because this experiment checks reliance on existing global state, the test process's state is part of its conditions.

The second concerns the plugin stage. The owning package's `vite8-rolldown.test.ts` runs a normal Vite build and fails if field decorator syntax is still present at a normal-stage probe. It then executes the output and checks field binding metadata. This serves a different purpose from a unit test that checks only the `enforce` string. It detects whether the real pipeline loses metadata when the order is changed incorrectly.

The third concerns file boundaries. `transform-boundary.test.ts` checks exclusions including `.test.ts?import`, `.d.ts#hash`, and Windows-style `node_modules` paths. If you rename the order probe to `.tsx` and investigate why its transformation disappeared, this test states the expected contract. Returning null for a file outside the boundary is not a plugin failure; it avoids taking over another transformer's responsibility.

The fourth concerns when dependencies are loaded. Neither a root import of `@fluojs/vite` nor a call to `fluoDecoratorsPlugin()` loads Babel. It is lazily loaded on the first eligible transform, and a missing Babel peer is reported with a diagnostic that includes the path of the file being transformed. Checking that "the plugin import succeeded, so Babel must be installed correctly" is therefore insufficient. Conversely, a tool that only inspects the plugin list need not fail immediately because Babel is not installed. The design separates the cost of observing configuration from that of actually transforming source.

The following command is a reproduction procedure that selects only the related regressions in the repository. There is no need to run a full root build or every governance check instead. The selection checks both file boundaries and the real Vite pipeline; it is not a test that pins manuscript sentences as strings.

```bash
pnpm --filter @fluojs/vite exec vitest run -c vitest.config.ts src/transform-boundary.test.ts src/transform-options.test.ts src/plugin-stage.test.ts src/vite8-rolldown.test.ts
```

## Simpler Choices and the Next Boundary

A small data transformation function does not need a decorator. Keeping arithmetic rules for order totals in ordinary functions makes their inputs and outputs easier to test. Decorators are valuable for gathering declarations, such as module registrations, DI declarations, and routes, into execution plans later. Wrapping every domain rule in a decorator separates evaluation time from invocation time and makes failures harder to explain.

Replacing all configuration with manual calls is not free either. Repeating tokens and providers in every module can cause declarations and actual construction logic to drift apart. The criterion is not how short the syntax is, but whether responsibility is kept in one place. Babel's role is to preserve standard decorator semantics; runtime's role is to connect those declarations to actual container and HTTP execution. Do not expect the build tool to infer DI types or automatically register missing providers.

We have now established when the order service's declaration is evaluated and what it passes through to become deployable JavaScript. The next chapter examines the lifetime of the data that declaration leaves behind. Does seeing `Object.freeze` mean every value is immutable? Is importing the same class twice equivalent to creating a new class with the same name? Which metadata does a child class inherit from its parent? These are our next questions.

## Source and Contract References

- [Standard decorator and preload contracts in the core README](../../packages/core/README.md), [Class decorator implementation](../../packages/core/src/decorators.ts), [Metadata symbol boundary](../../packages/core/src/metadata/shared.ts)
- [Peer and file boundaries in the Vite README](../../packages/vite/README.md), [Public exports](../../packages/vite/src/index.ts), [Babel transform implementation](../../packages/vite/src/decorators-plugin.ts)
- [File boundary tests](../../packages/vite/src/transform-boundary.test.ts), [Proposal and source map option tests](../../packages/vite/src/transform-options.test.ts), [Pre-stage tests](../../packages/vite/src/plugin-stage.test.ts)
- [Experiment with actual Vite8 and Rolldown output](../../packages/vite/src/vite8-rolldown.test.ts), [core standard metadata transformation tests](../../packages/core/src/decorator-transform.test.ts)
- [DTO field declaration constraints in the HTTP README](../../packages/http/README.md), [Extension decorator contract](../../docs/contracts/third-party-extension-contract.md)
