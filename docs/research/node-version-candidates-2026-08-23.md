# Node.js minimum-version candidates (2026-08-23)

## Scope and method
Investigation only. Sources are first-party Node.js release pages, the Node.js Release repository, and Node.js API documentation. Repository/dependency evidence is intentionally out of scope.

## Executive findings
- **Node 22.12.0** (2024-12-03) is the meaningful 22.x interoperability boundary for Fluo-style package authors: `require(esm)` became enabled by default, and import attributes/JSON modules were marked stable. Source: [22.12.0 release](https://nodejs.org/en/blog/release/v22.12.0) (sections “require(esm) is now enabled by default” and “Notable Changes”).
- **Node 22.14.0** (2025-02-11) is not a comparable support-lifetime boundary. It is a useful *tooling/API floor* only if Fluo specifically wants its additions: TypeScript support in STDIN eval and workers, `module.findPackageJSON()`, `process.ref()/unref()`, SQLite TypedArray/DataView support, and test-runner additions. Source: [22.14.0 release](https://nodejs.org/en/blog/release/v22.14.0), “Notable Changes”.
- **Latest 22.x** is the conservative candidate when the objective is “Node 22 with maximum patch/security coverage”; the major line remains LTS until 2027-04-30. The minimum declaration should normally be `>=22.12.0` or `>=22.14.0` only when a concrete API requires it, while CI/runtime should test the latest 22.x.
- **Node 24.x** has materially longer support (EOL 2028-04-30) and current platform/tooling improvements, but a 24 floor also excludes Node 22 consumers and introduces build-platform implications (MSVC removal; ClangCL required on Windows). It is a policy/product decision, not justified by 22.14 alone.

## Release/support schedule (status on 2026-08-23)
The canonical schedule records: [Node.js Release `schedule.json`](https://github.com/nodejs/Release/blob/main/schedule.json). Relevant entries: [v22 lines](https://github.com/nodejs/Release/blob/main/schedule.json#L103-L108) and [v24 lines](https://github.com/nodejs/Release/blob/main/schedule.json#L109-L112).

| Candidate | First release | LTS / Active LTS | Maintenance | EOL | Status on 2026-08-23 |
|---|---:|---:|---:|---:|---|
| 22.12.0 | 2024-12-03 | 2024-10-29 (22.x line) | 2025-10-21 | 2027-04-30 | Maintenance
| 22.14.0 | 2025-02-11 | 2024-10-29 (22.x line) | 2025-10-21 | 2027-04-30 | Maintenance
| latest 22.x | line began 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 | Maintenance
| 24.x | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 | Active LTS

The 22 LTS transition and stated lifecycle are also described in [22.11.0 release](https://nodejs.org/en/blog/release/v22.11.0): “Active LTS … until October 2025” and then “Maintenance … until end of life in April 2027.” The 24 release page records LTS promotion in October 2025; the schedule gives exact dates.

## Concrete capability boundaries

### 22.12.0
- `require(esm)` no longer requires `--experimental-require-module`; Node documents that it can load native ES modules from `require()`, with `process.features.require_module` and the `module-sync` exports condition. Source: [22.12.0 release](https://nodejs.org/en/blog/release/v22.12.0).
- Import attributes and JSON modules were marked stable in this release. The API history records `v23.1.0, v22.12.0, v20.18.3, v18.20.5`: import attributes are no longer experimental. Source: [ES modules API history](https://nodejs.org/api/esm.html#history-version-changes).

### 22.14.0
The official changelog lists these semver-minor additions: TypeScript support to STDIN eval; `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; `module.findPackageJSON`; `process.ref()` / `process.unref()`; SQLite `TypedArray` and `DataView` support; `TestContext.prototype.waitFor()`; `t.assert.fileSnapshot()`; `assert.register()`; and worker TypeScript eval. Source: [22.14.0 release, “Notable Changes”](https://nodejs.org/en/blog/release/v22.14.0).

The API reference confirms 22.14.0 as the introduction version for relevant `node:module` APIs (for example, [module API](https://nodejs.org/api/module.html)). These are concrete reasons to choose 22.14.0 over 22.12.0, but they are feature-specific, not lifecycle-specific.

### Later 22.x
Later patch/minor releases should be treated as the maintained implementation of the same Jod line, not a new support tier. The project’s current release index lists maintained 22.x releases, including [22.23.0](https://nodejs.org/en/blog/release/v22.23.0). Any exact “latest 22.x” pin must be refreshed from the release index on rollout day.

### 24.x
Node 24.0.0 introduced V8 13.6, npm 11, global `URLPattern`, `AsyncLocalStorage` using `AsyncContextFrame` by default, and removed MSVC support in favor of ClangCL for Windows builds. Source: [24.0.0 release](https://nodejs.org/en/blog/release/v24.0.0), opening announcement and “npm 11” section.

## Is 22.14 a meaningful boundary?
**Answer: technically meaningful for selected APIs, but not a general platform boundary.** 22.12 already contains the major package-interop boundary (`require(esm)`) and stable import attributes. 22.14 adds several useful APIs and test/tooling capabilities, but it does not change the support phase, EOL date, or major runtime generation. Therefore:

1. Choose **22.12.0** when the requirement is the ESM/package-resolution baseline.
2. Choose **22.14.0** when Fluo or a required tool directly uses one of the listed 22.14 additions.
3. Choose **latest 22.x** when retaining Node 22 while maximizing maintenance/security fixes.
4. Choose **24.x** only when the longer EOL horizon or Node 24 capabilities outweigh the compatibility and build-tooling cost.

## Caveats for the downstream recommendation
- This report does not inspect Fluo manifests, dependencies, native addons, CI images, or consumer telemetry.
- Node’s release schedule is the authority for lifecycle dates; release pages are the authority for version-specific capabilities.
- The date “2026-08-23” is used for status classification; Node 24 is still before its scheduled 2026-10-20 Maintenance transition and Node 22 is already in Maintenance.
