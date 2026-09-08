# Turning Providers into an Internal Representation

<!-- book:volume=03-internals;chapter=05 -->

[Previous: Building Custom Decorators Safely](./ch04-custom-decorators.md) | [Volume 3 Contents](./toc.md) | [Next: Dependency Resolution Algorithms](./ch06-resolution-algorithms.md)

## One Pricing Policy, Several Ways to Register It

Selling the T-shirts and stickers requested by FluoBlog readers added products and orders to the same application. The accounts are still the blog's accounts, and an order's `customerId` is that account ID. This problem did not arise because we needed a new payment service. We refactored the cart and orders to apply the same purchase quantity limit, but in tests only one side picked up the new policy. Registering the policy class separately under two tokens had created two different instances.

The decorators we have examined so far record which tokens a class needs. That record alone does not create an object. A class decorated with `@Inject(SHOP_POLICY)`, a `{ provide, useClass }` object, a configuration value created in advance, and an asynchronous factory all have different shapes. If the resolver had to understand all of these shapes and exceptions every time, dependencies and scopes would be more likely to be interpreted differently depending on the registration form.

`@fluojs/di` handles these differences at the registration boundary. It validates a public `Provider` declaration and turns it into an internal record containing a token, strategy, injection list, and scope. This process is called normalization. The important question here goes beyond whether short syntax becomes long syntax. To explain policy replacement and test isolation, we need to know what is settled at registration time and what remains until resolution actually happens.

The experiment in this chapter is a complete test file that isolates the DI boundary from the existing product and order code. It does not mean that a complete shop repository is already provided. `examples/fluo-blog` provides evidence for the initial HTTP and DI path, while the `fluo-blog/src/experiments/` file below is an experiment you create in your own application. It connects to neither a database nor a real payment provider.

## Thinking Separately About Tokens, Implementations, and Instances

In the application, the `ShopPolicy` interface helps with type checking during development, but it does not exist at runtime. The `SHOP_POLICY` symbol, by contrast, exists at runtime and serves as the container's key. Creating another `Symbol('SHOP_POLICY')` with the same name in a different file produces a different key. In the actual application, therefore, `src/catalog/shop-policy.ts` should own both the interface and the token, and consumers should import that token.

The `QuotePolicy` class is an implementation and can also be used as a class token. `container.register(QuotePolicy)` declares that the class itself is both the provided token and the constructor. `{ provide: CHECKOUT_POLICY, useClass: QuotePolicy }` is a separate declaration with the same implementation but a different registration key. The default singleton scope does not mean one instance for the class across all of its uses. It means sharing within the registration and cache boundaries owned by the container. Do not assume that two `useClass` registrations for the same class are merged into one object.

Use `useExisting` when you want to retrieve the same object under two names. If `CHECKOUT_POLICY` is registered to point to `QuotePolicy`, resolving the alias moves to the target token. This is a decision about meaning more than performance. Separate `useClass` registrations are appropriate when independent policy state is needed; an alias is appropriate when the same policy and the same disposal responsibility must be shared. Even if the target later becomes request or transient scoped, the alias must follow the target's resolution rules.

A configuration object that has already been validated can be registered with `useValue`. This differs from registering a function that reads configuration. The object already exists, and the container supplies its reference. Parsing environment variables and validating quantity ranges are responsibilities of the application boundary. The container does not inspect the internal fields of `useValue` to validate currencies or prices.

Use a factory when a single class constructor cannot express the creation procedure. The public type accepts `useFactory` arguments as `unknown[]`, so the application is responsible for matching the token list to the argument types. In this chapter, `inject: [SHOP_POLICY]` sits alongside the first argument's `ShopPolicy` assertion to make that contract visible. Do not treat this assertion as validation of external JSON. The value comes from types and registrations defined in the same file.

## What Normalization Settles

The actual entry point is `register()` in `packages/di/src/container.ts`, and `normalizeProvider()` in `provider-normalization.ts` performs the transformation. The public root exports retain the `NormalizedProvider` type for compatibility, but it is not an API that encourages applications to create this internal record directly. Use the `Provider` family for declarations and let the container own normalization.

The class shorthand becomes a record with `type: 'class'`, the class as `provide`, and the class as `useClass`. Constructor tokens are read from core metadata, and singleton is selected if no scope is present. An object-form class provider first uses an explicit `scope`, then the metadata on `useClass` if no scope is specified, and finally the default scope if neither is available. Omitting `inject` or setting it to `undefined` falls back to the class's `@Inject(...)`. In contrast, `[]` deliberately empties the dependency list.

An explicit scope also takes precedence for a factory. If `resolverClass` is supplied, that class's scope metadata can be used to determine the default. However, the factory's `inject` list is not automatically copied from that class. When creation uses a factory, you must declare the list of arguments the factory actually receives. The class's injection list and the factory's arguments are not assumed to always have the same meaning.

A value provider becomes a singleton record with no dependencies. `useValue: undefined` is also valid. Strategy validation checks for the presence of a property rather than the truthiness of its value, so `false`, `0`, and `undefined` are not mistaken for a missing strategy. Conversely, adding an own `inject` property to a value provider is rejected, even if its value is `undefined`. This prevents the contradiction of declaring creation dependencies for a value that already exists.

Each object provider requires a valid `provide` and exactly one creation strategy. You cannot supply both `useValue` and `useFactory` and ask for an interpretation such as "use the factory if there is no value." Allowed tokens are strings, symbols, and constructible classes; a non-constructible arrow function is not a class token. The internal check uses `Reflect.construct` to verify constructibility, but it does not actually call the user class's constructor. Order processing or connection creation must not happen during registration.

The injection array is also copied into a new array and frozen. The shapes of `forwardRef()` and `optional()` wrappers are validated, and the wrappers are preserved as separate frozen records. Changes a caller makes to the original array or wrapper after registration therefore do not silently alter the container's declaration. This does not deeply freeze the internals of a `useValue` object or a factory's closure. Declaration stability and application state immutability must be kept distinct.

## Observing Internal Records with a Purchase Policy

The following is the complete file `fluo-blog/src/experiments/provider-normalization.test.ts`. The price calculation is a small pure policy that accepts only a server-selected unit price and quantity; it does not replace order persistence. Amounts are restricted to integers in KRW minor units, and the result is checked to ensure it is a safe integer. Moving the quantity limit into DI configuration lets orders and the cart consume the same rule.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject, Scope, type InjectionToken } from '@fluojs/core';
import {
  Container,
  InvalidProviderError,
  type ClassProvider,
} from '@fluojs/di';

interface ShopPolicy {
  currency: 'KRW';
  maxQuantity: number;
}

const SHOP_POLICY = Symbol('SHOP_POLICY');
const CHECKOUT_POLICY = Symbol('CHECKOUT_POLICY');
const RECEIPT_POLICY = Symbol('RECEIPT_POLICY');
const OTHER_POLICY = Symbol('OTHER_POLICY');

@Inject(SHOP_POLICY)
class QuotePolicy {
  constructor(readonly policy: ShopPolicy) {}

  totalMinor(unitMinor: number, quantity: number): number {
    if (!Number.isSafeInteger(unitMinor) || unitMinor < 0) {
      throw new RangeError('Invalid unit price');
    }
    if (!Number.isSafeInteger(quantity) ||
        quantity < 1 || quantity > this.policy.maxQuantity) {
      throw new RangeError('Invalid quantity');
    }
    const total = unitMinor * quantity;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError('Total exceeds safe integer range');
    }
    return total;
  }
}

@Scope('request')
@Inject(SHOP_POLICY)
class ReceiptPolicy {
  constructor(readonly policy: ShopPolicy) {}
}

test('normalizes declarations without changing token identity', async () => {
  const policy: ShopPolicy = { currency: 'KRW', maxQuantity: 5 };
  const inject: InjectionToken[] = [SHOP_POLICY];
  const declaration: ClassProvider<QuotePolicy> = {
    provide: QuotePolicy,
    useClass: QuotePolicy,
    inject,
  };
  const root = new Container().register(
    { provide: SHOP_POLICY, useValue: policy },
    declaration,
    { provide: CHECKOUT_POLICY, useExisting: QuotePolicy },
    {
      provide: RECEIPT_POLICY,
      useFactory: (value) => new ReceiptPolicy(value as ShopPolicy),
      inject: [SHOP_POLICY],
      resolverClass: ReceiptPolicy,
    },
  );
  const request = root.createRequestScope();

  try {
    inject[0] = OTHER_POLICY;
    const state = root.inspectResolutionState();
    const normalized = state.registrations.get(QuotePolicy);
    assert.ok(normalized);
    assert.equal(normalized.type, 'class');
    assert.equal(normalized.scope, 'singleton');
    assert.deepEqual(normalized.inject, [SHOP_POLICY]);
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.inject), true);
    assert.equal(
      state.registrations.get(RECEIPT_POLICY)?.scope,
      'request',
    );

    const quote = await root.resolve(QuotePolicy);
    const alias = await root.resolve<QuotePolicy>(CHECKOUT_POLICY);
    const receipt = await request.resolve<ReceiptPolicy>(RECEIPT_POLICY);
    assert.equal(quote, alias);
    assert.equal(receipt.policy, policy);
    assert.equal(quote.totalMinor(25000, 2), 50000);
    assert.throws(() => quote.totalMinor(25000, 6), RangeError);

    policy.maxQuantity = 2;
    assert.throws(() => quote.totalMinor(25000, 3), RangeError);
  } finally {
    await root.dispose();
  }
});

test('rejects malformed strategies and keeps a failed override atomic', async () => {
  const policy: ShopPolicy = { currency: 'KRW', maxQuantity: 5 };
  const root = new Container().register(
    { provide: SHOP_POLICY, useValue: policy },
    QuotePolicy,
  );
  try {
    const before = await root.resolve(QuotePolicy);
    assert.throws(
      () => Reflect.apply(root.override, root, [
        {
          provide: SHOP_POLICY,
          useValue: { currency: 'KRW', maxQuantity: 1 },
        },
        {
          provide: RECEIPT_POLICY,
          useValue: undefined,
          useFactory: () => undefined,
        },
      ]),
      InvalidProviderError,
    );
    assert.equal(await root.resolve(QuotePolicy), before);
    assert.equal(before.policy, policy);
    assert.equal(root.has(RECEIPT_POLICY), false);

    assert.throws(
      () => Reflect.apply(root.register, root, [
        { provide: RECEIPT_POLICY, useValue: undefined, inject: undefined },
      ]),
      InvalidProviderError,
    );
    root.register({ provide: RECEIPT_POLICY, useValue: undefined });
    assert.equal(root.has(RECEIPT_POLICY), true);
    assert.equal(await root.resolve(RECEIPT_POLICY), undefined);
  } finally {
    await root.dispose();
  }
});
```
`inspectResolutionState()` is used only as a framework observation tool in this experiment. The returned registration map is a read-only snapshot, not a live window that automatically reflects later registrations. An ordinary order service has no reason to read this map to select an implementation. The service can use the `QuotePolicy` received through its constructor; only the experiment checks whether the normalized array is preserved when the original array changes. The `cacheOwner` feature for cache adoption is not needed for this observation either.

The last two lines of the first test deliberately change the configuration object. This is a counterexample that exposes the shared object reference, not a recommendation for updating configuration in production. Fixed configuration in a real application is validated when created and then treated as immutable. If dynamic policies are needed, design an explicit policy store and versioning rules. Container normalization does not automatically freeze the price snapshot taken when an order is placed.

The second test supplies invalid input through `Reflect.apply`. This does not mean that normal application code should bypass type checking. It is a negative test to verify that the registration boundary rejects values outside the TypeScript types with `InvalidProviderError`, even when those values come from a JavaScript consumer or runtime assembler. Object identity verifies that `override()` validates the entire call before replacing the first policy. The error class and the state left behind catch the regression more precisely than the full wording of the error message.

## Distinguishing Registration Order, Duplicates, and Replacement

Normalization does not imply atomic application assembly. `register(...providers)` normalizes and registers inputs in order. It would be incorrect to describe it as a batch transaction that rolls back earlier successful registrations when a later declaration fails. Discarding an assembly attempt expresses the intent more clearly than reusing a container after validation of a plugin list has failed.

By contrast, `override(...providers)` first normalizes the replacement declarations and validates the plan for each token, then makes changes. The preceding test relies on this difference. A rejected replacement must preserve existing registrations, caches, and disposal ownership. A successful replacement can invalidate not only the replaced token's cache but also the caches of already-created dependency consumers. Chapter 7 examines where disposal of old objects meets the next resolution.

Registering the same single token twice through normal registration causes `DuplicateProviderError`. To contribute multiple values, explicitly set `multi: true` on supported class, factory, or value providers. Rather than overwriting one registration, this retains normalized contribution records in order under the same token. Mixing single and multi registrations is rejected because it is ambiguous. Alias providers have no public `multi` option. Do not force unsupported combinations onto an object and treat them as an extension mechanism.

If you extend the tests, observe three boundaries separately. A class provider with `inject: undefined` receives the policy from metadata, whereas `inject: null` must fail during registration. A number or arrow function used as the provided token must also fail during registration. A factory that returns an incorrectly shaped policy may pass normalization; that error must be validated at the factory's return contract or the policy consumption boundary. Grouping all of these under "DI errors" obscures where each fix belongs.

## Running the Experiment and the Next Question

The experiment targets Node24 and pnpm10. With current versions of `@fluojs/core`, `@fluojs/di`, TypeScript, and Node types installed in `fluo-blog`, transform the standard decorators into JavaScript and then run the result as follows. Do not assume that Node's TypeScript stripping feature can also execute decorators directly.

```bash
pnpm exec tsc src/experiments/provider-normalization.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/provider-normalization.test.js
```
Both tests are expected to pass. In the first test, the policy amount is `50000`, and the two policy names return the same object. In the second, the invalid replacement is rejected synchronously, and the existing object remains. This chapter does not provide a recorded pass of these commands. It presents reproduction steps and evaluation criteria based on the current source and regression tests; installation, compilation, and execution in your environment need to be checked separately.

We can now explain which token the cart and orders use to share the same policy. A normalized record alone, however, does not tell us what the second order waits for while the first order creates that policy. In the next chapter, we follow dependency paths from these records and examine why an instance that is not yet complete is represented in a Promise cache.

## Source References

- [DI README: provider forms and public contracts](../../packages/di/README.md)
- [DI public exports](../../packages/di/src/index.ts), [Provider and NormalizedProvider types](../../packages/di/src/types.ts)
- [Normalization and token, strategy, and injection validation implementation](../../packages/di/src/provider-normalization.ts)
- [Registration, replacement, and inspection snapshot implementation](../../packages/di/src/container.ts)
- [Regression tests for invalid provider input](../../packages/di/src/provider-validation.test.ts)
- [Tests for wrapper immutability, aliases, and multi registration](../../packages/di/src/container.test.ts)
- [Regression tests for replacement call atomicity](../../packages/di/src/container-override-atomicity-regression.test.ts)
- [Core's explicit injection decorator contract](../../packages/core/README.md), [implementation](../../packages/core/src/decorators.ts)

[Previous Chapter](./ch04-custom-decorators.md) | [Volume 3 Contents](./toc.md) | [Next Chapter](./ch06-resolution-algorithms.md)
