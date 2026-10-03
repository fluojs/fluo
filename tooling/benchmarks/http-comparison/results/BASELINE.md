# HTTP platform baseline - issue #3909

## Evidence boundary

This is baseline collection, not an optimization or a regression-budget verdict.
Two configurations x 16 targets x 3 workloads x 2 concurrency levels x 3 repeats produced 576 unique measurements. Each measured interval is 15 seconds after 5 seconds of warmup. All response-body/status, connection-error, timeout and non-2xx gates passed.

Both configurations used measured source digest `fe82ef173d29d810d1883c4d17301671ab7318cec6f54dfb9f4cf504f9082e30`. Full benchmark sources, versions, lockfile hashes, raw latency histograms, CPU/RSS samples and first-request/startup observations are inside the compressed artifacts. `baseline-manifest.json` binds compressed and decompressed SHA-256 hashes and gives all 192 condition summaries, including sample standard deviation.

## Equivalent configuration, 64 connections

Values below are descriptive means of three runs. Ratios are not significance tests. Native and Nest receive Fluo's seven default security headers in this configuration; Fluo security remains enabled. Other native/framework feature differences are not claimed equivalent.

| Platform | Workload | Native req/s | Fluo req/s | Nest req/s | Fluo/native | Fluo/Nest |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| fastify | read-search-local | 40197 | 29503 | 39279 | 73.4% | 75.1% |
| fastify | json-command-local | 57580 | 42120 | 53062 | 73.2% | 79.4% |
| fastify | rest-route-mix-local | 68783 | 47636 | 60581 | 69.3% | 78.6% |
| express | read-search-local | 33007 | 23903 | 31179 | 72.4% | 76.7% |
| express | json-command-local | 47530 | 34575 | 44533 | 72.7% | 77.6% |
| express | rest-route-mix-local | 48931 | 34442 | 45916 | 70.4% | 75% |
| nodejs | read-search-local | 41339 | 29223 | - | 70.7% | - |
| nodejs | json-command-local | 66250 | 42240 | - | 63.8% | - |
| nodejs | rest-route-mix-local | 71910 | 44833 | - | 62.3% | - |
| bun | read-search-local | 59474 | 40955 | - | 68.9% | - |
| bun | json-command-local | 88053 | 29295 | - | 33.3% | - |
| bun | rest-route-mix-local | 90603 | 47498 | - | 52.4% | - |
| deno | read-search-local | 46894 | 27513 | - | 58.7% | - |
| deno | json-command-local | 76314 | 26559 | - | 34.8% | - |
| deno | rest-route-mix-local | 81926 | 34870 | - | 42.6% | - |
| workers | read-search-local | 3390 | 3351 | - | 98.8% | - |
| workers | json-command-local | 3245 | 3103 | - | 95.6% | - |
| workers | rest-route-mix-local | 3437 | 3363 | - | 97.9% | - |
| nextjs | read-search-local | 7825 | 7154 | - | 91.4% | - |
| nextjs | json-command-local | 8912 | 7938 | - | 89.1% | - |
| nextjs | rest-route-mix-local | 8771 | 7844 | - | 89.4% | - |

## Interpretation and limitations

- Fastify and Express retain measurable gaps against Nest on their matched Node host engines. These measurements do not establish the cause; #3910 owns server profiling.
- Bun and Deno show the largest native-relative gaps on the JSON command. Do not substitute runtime speed for framework overhead or attribute the gap to body parsing without profiles.
- Local workerd measurements include local hosting overhead. Their near-native ratio does not establish deployed Workers performance or absence of Fluo overhead. Next uses a local production App Router host, not a deployed service.
- Cold-start data separates process-to-ready and first-request latency. Nest logging is disabled as in the original fixture; that startup configuration difference remains visible.
- Three rotated repeats describe variation. They do not remove scheduling, thermal, CPU-frequency, network, or serial-configuration-order confounders.

## Generator evidence

The NAS uses Node 22 as the generator only; matched framework servers use the same Node 24 executable on the Mac. NAS one-versus-four generator controls increased throughput while the Mac server remained underutilized. NAS measurements therefore demonstrate a generator limit, not server capacity.

The maintainer approved retaining NAS low-load/transport evidence and using Mac generator-process controls for high-load measurements. Six current-installation controls cover Fastify and Bun native across all three workloads, with one and four generator processes at the same total 64 connections, three rotated repeats. Four generators did not show a consistent throughput increase. These observations support the local measurement envelope; they do not remove same-host contention or prove headroom on every possible workload. Inspect each raw control and its variability before extrapolating.

## Reproduction and exclusions

- Run frozen installs for the workspace and isolated benchmark before building. The harness now rejects declared/installed lockfile mismatches.
- Use `BENCH_LOAD_PROCESS=1 BENCH_CONCURRENCY_SWEEP=1,64 BENCH_RUNS=3 BENCH_WARMUP_SEC=5 BENCH_MEASURE_SEC=15 NODE_ENV=production` with `BENCH_CONFIGURATION=default` and then `equivalent`. Set a separate `BENCH_OUTPUT_JSON` for each.
- Run `pnpm --ignore-workspace exec tsx src/archive.mjs` to validate the matrix and archive complete evidence.
- Earlier diagnostics from before the frozen-install recovery are not these baselines. An interrupted collection and a stale detached-server collision were discarded.
- A regression test checks actual detached-server teardown on parent termination. Another rejects an installed lockfile with changed overrides; disabling its comparison was observed to fail the test.
- The initial implementation head adds archive/report/tests and sorts existing imports. `measured-source-equivalence.json` records that initial comparison and separately identifies the later collector fix-back. Existing archives retain their original collector source; they are not relabeled as measurements of the changed collector.

## Collector review fix-back

The review found that failed or interrupted collection could discard completed
samples. The collector now registers each sample before teardown, preserves raw
traffic and available resource diagnostics, flushes on handled SIGINT/SIGTERM,
and rejects invalid attempts during archiving. `collector-fix-back.json` contains
an actual runner probe: a valid native Fastify measurement survived a subsequent
HTTP 503 failure at the next target endpoint, with a nonzero exit and retained
subprocess diagnostics. This probe and its small successful control are
correctness evidence, not new performance baselines.
