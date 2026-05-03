# @fluojs/metrics

## 1.0.0-beta.3

### Patch Changes

- [#1509](https://github.com/fluojs/fluo/pull/1509) [`2513723`](https://github.com/fluojs/fluo/commit/2513723dfe09ebbc4018104f5461c8f1fcd28920) Thanks [@ayden94](https://github.com/ayden94)! - Reuse built-in HTTP metrics when multiple MetricsModule instances intentionally share one registry, while documenting that HTTP instrumentation requires the explicit `http` option.

- Updated dependencies [[`1d43614`](https://github.com/fluojs/fluo/commit/1d4361416e56ec935d67da096ba8b72d3886f7ee), [`f086fa5`](https://github.com/fluojs/fluo/commit/f086fa58827617bda8bdef50e0b694bd5e85dfaa), [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67), [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199)]:
  - @fluojs/di@1.0.0-beta.6
  - @fluojs/runtime@1.0.0-beta.9

## 1.0.0-beta.2

### Patch Changes

- [#1366](https://github.com/fluojs/fluo/pull/1366) [`616189f`](https://github.com/fluojs/fluo/commit/616189ff76227bf574226ecd32134584e193efdc) Thanks [@ayden94](https://github.com/ayden94)! - Clear stale runtime platform telemetry series when `PLATFORM_SHELL` becomes unavailable after a prior scrape, and align the documented metrics public surface with exported contracts.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
