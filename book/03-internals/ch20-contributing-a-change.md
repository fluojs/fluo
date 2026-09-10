# Taking a Framework Change Through Submission

<!-- book:volume=03-internals;chapter=20 -->

[Previous: Verifying Performance Claims Through Experiments](./ch19-performance-experiments.md) | [Volume 3 Contents](./toc.md) | [Series Introduction](../README.md)

## Turning a Product Pain Point into a Framework Change

At first, the operator wanted to display a single post. That blog gained reader accounts and subscriptions, then grew into a shop where the same users buy T-shirts. In Volume 3, we followed order requests through decorators, the module graph, DI, the runtime, and adapters. What remains is to turn the ability to read those internals into a change that other users can safely receive.

A contribution does not need a grand starting point. Suppose that while assembling the extension package from Chapter 17, you find yourself repeatedly writing `@Module({})` even for small modules that do not yet have providers. The syntax you want is `@Module()`. But is simply marking the argument optional enough? Must an empty module still be registered in the graph? What information must remain when it is combined with `@Module({ global: true })`? These questions turn a small syntactic convenience into an actual contract change.

This chapter uses the empty `Module` default contract already implemented in the current `@fluojs/core`. `Module()`, `Module(undefined)`, and `Module({})` are all currently supported. We do not claim to have discovered an unresolved bug or submitted a new PR. This is an experiment that reconstructs a change from the completed source and tests, then injects a defect in an independent learning worktree to check the tests' ability to detect it. Nor does it claim to reproduce the history of a particular past commit.

This check is also the first step in contributing. If a failure in the version you were using is already fixed in the current source, do not open an empty PR with the same fix. Narrow the version and conditions with a minimal reproduction, and distinguish an upgrade issue from a missing regression case. Explaining an already resolved boundary accurately is more useful than attaching an imagined internal fix to a problem you cannot reproduce.

## Expand One Sentence into an Executable Contract

The acceptance criteria must be more precise than "the empty object inside the parentheses can be omitted." Omitting the argument and passing explicit `undefined` must register the same module metadata as an empty object. The class must remain distinguishable from an undecorated class, and previously recorded partial fields and the `global: true` marker must be preserved. The metadata snapshot must be protected, and the change version must be updated. Do not broaden the scope to automatically treat `null` as an empty object too.

Although these criteria do not directly mention domain outcomes, their connection to the product is clear. An empty module can be explicitly placed in the assembly before its features are added. If a configuration module's providers are recorded first and an empty `@Module()` is applied afterward, that configuration must not disappear. If decorator order erases the global module marker, token visibility in the existing app changes. That is how a syntax change can spread into injection failures in existing order or post services.

Conversely, do not bundle new module naming rules, automatic provider discovery, or a redesigned inheritance policy into this change. Those have separate requirements and regression scopes. The reviewer's question becomes: "Does this add only an argument default while reusing the existing metadata recording contract unchanged?" A small diff is valuable not because it has few lines, but because it has few assumptions to review.

Choose ownership first as well. `packages/core/src/decorators.ts` and the core README own the public decorator and its explanation. `packages/core/src/metadata/module.ts` owns metadata merging and freezing. Use `@fluojs/testing` for actual assembly verification; runtime's existing regression tests cover adapterless application bootstrap. Creating a workaround decorator in the application's `src/orders` does not return the problem to its framework boundary.

## The First Test Observes Registration, Not Decoration Alone

The following is the **complete `packages/core/src/module-defaults.consumer.test.ts` file** you can add in an independent learning checkout. It is a consumer-oriented experiment that deliberately overlaps with the repository's current `module-defaults.test.ts`. In an actual contribution, extend a nearby existing test rather than retaining duplicate coverage of the same behavior.

```ts
import { getModuleMetadata, Module } from '@fluojs/core';
import { getModuleMetadataVersion } from '@fluojs/core/internal';
import { expect, it } from 'vitest';

it.each([
  { name: 'omitted', factory: () => Module() },
  { name: 'undefined', factory: () => Module(undefined) },
  { name: 'empty object', factory: () => Module({}) },
])('registers an empty module for $name input', ({ factory }) => {
  class Undecorated {}
  @Module({})
  class ExplicitModule {}
  const before = getModuleMetadataVersion();
  const decorate = factory();

  @decorate
  class EmptyModule {}

  const metadata = getModuleMetadata(EmptyModule);
  expect(getModuleMetadata(Undecorated)).toBeUndefined();
  expect(metadata).toBeDefined();
  expect(metadata).toEqual(getModuleMetadata(ExplicitModule));
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(getModuleMetadataVersion()).toBe(before + 1);
});

it('keeps partial fields and both Global decorator orders', () => {
  class Marker {}

  @Module()
  @Module({ providers: [Marker], exports: [Marker] })
  class PartialModule {}

  @Module({ global: true })
  @Module()
  class OuterGlobalModule {}

  @Module()
  @Module({ global: true })
  class InnerGlobalModule {}

  expect(getModuleMetadata(PartialModule)).toMatchObject({
    providers: [Marker],
    exports: [Marker],
  });
  expect(getModuleMetadata(OuterGlobalModule)?.global).toBe(true);
  expect(getModuleMetadata(InnerGlobalModule)?.global).toBe(true);
});

it('does not expand the accepted input to null', () => {
  const decorate = Reflect.apply(Module, undefined, [null]);
  expect(() => {
    @decorate
    class InvalidModule {}
    return InvalidModule;
  }).toThrow(TypeError);
});
```

Here, `getModuleMetadataVersion` is read from an internal subpath. This is an acceptable choice because this package test verifies invalidation of framework-owned metadata. It does not mean the general extension package in Chapter 17 should be distributed with a dependency on this internal counter. Public consumers can perform the checks they need with `getModuleMetadata`; keep internal evidence limited to tests that protect internal changes.

Rather than pinning the version to an absolute value, compare it with the value immediately before application plus 1. This avoids depending on test order even when other decorated classes exist in the same process. This test block records synchronously and reads immediately. When testing a shared metadata counter, do not introduce interference through `it.concurrent` or turn it into a test that waits for time to pass.

The `null` test checks the error type without pinning its wording. An ordinary TypeScript caller cannot pass `null`, but a JavaScript or dynamic call boundary can. `Reflect.apply` makes that boundary explicit. If an implementation expands from supporting omission and `undefined` to accepting every falsy value, this test must fail.

Passing this test against the current implementation is expected. If you want to check its detection power, **only in your own independent learning worktree**, temporarily remove `= {}` from the added line of the diff below and run this test. The omitted and `undefined` cases should fail while applying module metadata, while the empty-object case should still pass. Do not use an unrelated import error or runner configuration failure as RED evidence. Afterward, restore the default and run the same test again. Neither that fault injection nor the test execution was performed as part of preparing this manuscript.

## Reuse the Existing Recording Path in the Implementation

The difference between the state without default support and the current implementation can be expressed as follows. This is a **partial diff of the function signature**, not the whole file. `StandardClassDecoratorFn`, `ModuleMetadata`, and `defineModuleMetadata` are types and imports already present in the same file.

```diff
-export function Module(definition: ModuleMetadata): StandardClassDecoratorFn {
+export function Module(definition: ModuleMetadata = {}): StandardClassDecoratorFn {
   return (target) => {
     defineModuleMetadata(target, definition);
   };
 }
```

A default parameter applies only to an omitted argument or `undefined`, not to `null`. This language rule matches the acceptance criteria. Using `definition || {}` would also accept other falsy values and broaden the semantics. Using `if (!definition) return` would skip empty module registration entirely, leaving decorated and undecorated classes indistinguishable.

The existing `defineModuleMetadata` handles the rest. It preserves previously stored fields, applies only the new partial fields, copies collections and provider descriptors, freezes the snapshot, and increments the version. Bypassing this path to store a special empty object in a separate global map would give normal and empty modules different lifecycles. Remembering why Chapter 19's cache includes the metadata version in its key makes it clear that empty input must not become "do nothing."

Preserve the existing handling that retains the object identity of a provider's `useValue` as well. Introducing unconditional deep copying while adding empty module support could change an externally supplied sink or adapter instance. Do not change an ownership contract merely because the code looks cleaner. Such a separate change requires new failure cases and separate approval.

Public TSDoc should explain that omission or `undefined` uses `{}`, that empty metadata is still registered, and that existing partial fields and version updates are preserved. Even for a one-line implementation, declaration consumers must be able to understand the behavior without reading the source. README usage and error boundaries must convey the same meaning.

## A Second Piece of Evidence Through Real Module Assembly

The first test proves metadata recording, but does not pass through the module graph. The following slice can be reproduced as the **complete `packages/testing/src/empty-module.consumer.test.ts` file**. It represents the relationship in which an existing account owns a shop order using a small token, and places an empty module in the same graph. It needs neither the entire blog nor a database.

```ts
import { Inject, Module } from '@fluojs/core';
import { createTestingModule } from '@fluojs/testing';
import { expect, it } from 'vitest';

const CUSTOMER_ID = Symbol('CUSTOMER_ID');

it('compiles a consumer graph containing an empty decorated module', async () => {
  @Module()
  class EmptyExtensionModule {}

  @Module({
    providers: [{ provide: CUSTOMER_ID, useValue: 'reader-7' }],
    exports: [CUSTOMER_ID],
  })
  class AccountsModule {}

  @Inject(CUSTOMER_ID)
  class OrderOwner {
    constructor(readonly customerId: string) {}
  }

  @Module({
    imports: [AccountsModule, EmptyExtensionModule],
    providers: [OrderOwner],
    exports: [OrderOwner],
  })
  class OrdersModule {}

  @Module({ imports: [OrdersModule] })
  class AppModule {}

  const module = await createTestingModule({ rootModule: AppModule }).compile();
  try {
    expect((await module.resolve(OrderOwner)).customerId).toBe('reader-7');
    expect(module.modules.some((entry) => entry.type === EmptyExtensionModule)).toBe(true);
  } finally {
    await module.container.dispose();
  }
});
```

`OrderOwner` is not injected merely because it accepts a string type. The provider and export in `AccountsModule`, the import in `OrdersModule`, and class-level `@Inject` create the connection. Because this slice checks the empty module's presence by graph identity, it can also detect a mutation that treats empty metadata as though it never existed.

The current runtime's `empty-module-default.test.ts` bootstraps an adapterless application, checks that its route list is empty, and verifies that it can be closed again after being closed. There is no reason to add real order HTTP or payment calls here. For a decorator default change, graph and bootstrap regression coverage is sufficient. A contribution that changes the request pipeline, on the other hand, must go beyond this slice and pass through the request surface of `createTestApp({ rootModule })`.

Distinguish resource ownership after a failed compile too. The builder owns the internal container until it returns a reference and performs disposal if compilation fails. Once a reference is returned successfully, the caller disposes of it as in the example above. Do not unconditionally read a module variable that has not yet been assigned in `finally`, or place disposal only on the successful path. Partial initialization failure and normal shutdown are protected by their respective evidence tests.

## Make Verification Results Readable to the Reviewer

To run the existing evidence in an independent learning worktree, use the repository's Node24/pnpm10 environment and installed dependencies. The following **commands target test files that currently exist**. If you create the new consumer tests, add those files to the targets in the same project as well. These are not logs of commands run while writing this chapter.

```bash
pnpm exec vitest run --project packages packages/core/src/module-defaults.test.ts packages/runtime/src/empty-module-default.test.ts packages/testing/src/module.compile-failure.test.ts
pnpm --filter @fluojs/core typecheck
pnpm --filter @fluojs/core build
```

Record why the tests failed separately from their passing results after the fix. Confirm a build exit code of 0; passing source tests is not a substitute. Because the public function signature changed, check that the optional parameter appears in `.d.ts` too. Core's existing build-output tests protect the presence of distributed entry files, but file existence alone does not prove the semantics of every typed call. Include consumer calls that import from the package root and use `Module()`, `Module(undefined)`, and `Module({})` in type checking as well.

Once the impact is established, expand from package-specific checks to the repository's actual release gate. The changed package, runtime assembly, documentation, and distribution surface must all refer to the same head. Do not reuse green CI from a previous head for a modified head. If a behavior change affects a public package, a single local test does not establish release readiness.

In the contribution report, record which commands exited 0 at which head, what you could not run, and what external conditions are required. Not using a database for a pure module change is an intentional scope decision, not a verification gap. Failing to check public declarations, however, is an explicit limitation. Do not cover both with the same phrase, "most checks passed."

## The Changeset and Submission Description Are Part of the Change

For a hypothetical fix restoring a release that broke the currently documented `Module()` contract, you can consider `patch` as a backward-compatible bug fix. Introducing a previously unsupported call for the first time requires consideration of `minor`. A change is not a patch merely because it takes one line. If consumers of a package at 1.0 or later must change their code to keep it working, the change requires a major release and migration guidance.

The following is the **complete example of `.changeset/empty-module-contract.md`, to be used only when restoring the documented contract**. It is not an instruction to create only this file without further implementation changes and release the same feature again. In an actual submission, align the verified baseline with the semver intent.

```md
---
"@fluojs/core": patch
---

Module 인수 생략과 undefined 입력이 빈 모듈 메타데이터를 등록하도록 문서화된 계약을 복구합니다. 기존 부분 필드, Global 표시와 메타데이터 버전 갱신을 보존합니다.
```

Do not manually update versions and package changelogs in several places. Fluo's official path is Changesets and `.github/workflows/release.yml`. Contributors express intent in a changeset and leave version adjustments, changelog generation, and publishing to the canonical GitHub Actions workflow. Local `npm publish` is not part of that path.

The PR description should lead with the contract to review rather than boast about how short the code is. For this example, a title could be "Restore the registration contract for empty Module calls." Connect the three affected calls, the distinction from undecorated classes, preservation of partial metadata and continued rejection of null, and test and declaration evidence in the body. Do not fill in check marks for results you have not run; separate reproduction steps from observed outcomes.

State the expected reproduction results as well. In the fault-injected experiment, the omitted and undefined cases fail while the `{}` case still passes. After the fix, all three inputs produce identical metadata, and a consumer graph containing the empty module is assembled. These results are criteria for readers to verify, not measured results from a PR submitted by this manuscript. A good submission description can be concrete without hiding this distinction.

Maintaining Korean and English package READMEs and contracts together is the documentation contract for ordinary contributions. Do not confuse it with this book's Korean-first writing phase. The book is translated after the entire Korean edition is complete, but the two language contracts for a distributed API change cannot be left with different meanings. If a new call is introduced, its examples, public export explanation, declaration, and release intent must read as one change.

## From Review to Reaching Users

Base the work on `main`, use a separate worktree under `.worktrees/`, and inspect the change list. Exclude unrelated edits, local data, and experimental artifacts. Commits, pushes, and PR creation for a real contribution are performed under the authority for that work. Reading this chapter or writing this manuscript does not mean any repository or GitHub changes have already been made.

If a reviewer asks about another decorator order, immutability of an earlier snapshot, or cached graph invalidation, do not view those questions as excessive scrutiny of a small diff. They are all execution contracts relied on by callers of this API. A failing mutation and a passing minimal test answer them better than a long statement of confidence. If the implementation changes during review, rerun related checks at the new head, and explain the impact boundary rather than unconditionally repeating checks for unchanged areas too.

Before merging, check CI and release metadata together. main is the single path for stable releases, and a major Changeset requires explicit maintainer approval and consumer migration guidance. Do not lower the stated version intent to avoid that approval path. The Changesets Version Packages flow and publishing results follow the merge, so record PR merging and npm distribution as separate events.

Once a version users can actually install is available, verify the same minimal reproduction through the public package entry, not only a source checkout. If the problem remains, investigate again with the release version, Node version, reproduction code, and failure boundary. Clean up the working branch and worktree under the proper authority after preserving the necessary evidence and references. Automatically deleting all local work because tests passed is not a submission procedure.

No commits, pushes, GitHub issues or PRs, or package publishing are performed in preparing this manuscript. What is completed here is a chapter that lets you connect one change from contract definition through reproduction, minimal implementation, verification, version decisions, review, and distribution checks. Knowing not to submit an already solved case as a new achievement is part of that process too.

## Closing the Three Volumes

FluoBlog and FluoShop have been the same product throughout. We did not create new user accounts when adding orders, nor split every module into a separate service from the outset merely because the product was growing. The reason for reading the internals in Volume 3 was not to expand an abstract list of framework knowledge. It was to explain where a reader's publication request and a customer's order are interpreted, what state they share, and what is disposed of when they fail.

The extension let the application own its configuration and resources; diagnostic tools exposed the limits of what their data can say; performance experiments verified both numbers and consistency. The final contribution leaves that knowledge as a small contract another developer can review and maintain. Whatever the next feature is, the starting point is the same: narrow down a concrete product failure, read the current contract, write a test that observes the failure, and then change only what is needed.

This is the final chapter of Volume 3 and the series, so it does not link to a nonexistent next volume. If you want to develop a new product requirement, revisit the application that began with [the first execution path in Volume 1](../01-fluoblog/ch01-first-app.md). You can now explain what engine that short assembly code starts, and what must be proved when changing that engine.

## Source References and Verification Scope

- [core README](../../packages/core/README.md), [public exports](../../packages/core/src/index.ts), [Module implementation](../../packages/core/src/decorators.ts): the already supported defaults and public contract.
- [Metadata storage implementation](../../packages/core/src/metadata/module.ts), [empty Module regression tests](../../packages/core/src/module-defaults.test.ts), [build artifact tests](../../packages/core/src/build-output.test.ts): evidence for merging, freezing, versioning, and distributed entry points.
- [Empty module runtime tests](../../packages/runtime/src/empty-module-default.test.ts): adapterless bootstrap and repeated close.
- [testing README](../../packages/testing/README.md), [module implementation](../../packages/testing/src/module.ts), [compile failure disposal tests](../../packages/testing/src/module.compile-failure.test.ts): container ownership on success and failure.
- [Testing contract](../../docs/contracts/testing-guide.md), [behavioral contract policy](../../docs/contracts/behavioral-contract-policy.md), [release contract](../../docs/contracts/release-governance.md), [release workflow](../../.github/workflows/release.yml): verification scope and the Changesets publishing boundary.

The example tests and fault injection are presented as reproduction procedures, not passing evidence from execution for this manuscript. The explanation was checked against the current source and supporting tests; it does not claim that actual code changes, full verification, or distribution were completed.
