# manifest strategy decision

<p><strong><kbd>English</kbd></strong> <a href="./manifest-decision.ko.md"><kbd>한국어</kbd></a></p>


Compile-time manifest generation is still treated as an optimization decision gate, not the default architecture.

## current decision

Current status: `defer`

Reason:

- the runtime already has a measurable bootstrap baseline
- a compile-time manifest path would add tooling, docs, and generator complexity
- adoption should wait for benchmark evidence that the complexity buys a meaningful startup or registration improvement

## benchmark artifact

Use the benchmark harness below to measure the current runtime baseline:

```sh
pnpm exec tsx tooling/benchmarks/manifest-decision.ts
```

The harness covers:

- `hello-world`
- `medium-rest`
- `module-heavy`

Current 2026-03-12 baseline from `pnpm exec tsx tooling/benchmarks/manifest-decision.ts`:

- `hello-world`: `0.35ms` average bootstrap
- `medium-rest`: `0.48ms` average bootstrap
- `module-heavy`: `0.47ms` average bootstrap

The checked-in snapshot for that run lives at `tooling/benchmarks/manifest-decision.latest.json`.

## adoption bar

Treat an improvement around `~20%` as a useful decision aid, not an automatic rule. Adoption should consider all of the following together:

- bootstrap/startup time
- route and module registration time
- memory cost
- build/toolchain cost
- generator and docs maintenance burden
