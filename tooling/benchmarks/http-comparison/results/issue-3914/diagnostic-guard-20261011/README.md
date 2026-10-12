# Diagnostic evidence guard fix-back

Reviewed head: `c554860cae0f05ebf8e95d079a02d3f58ed3f50d`.
Preflight: `f1bad8d11dc53e87efaccba542b087938211748f406dd0ed02528ec519d18ea5`.

The code review identified missing diagnostic-environment rejection in Bun A/A
and missing diagnostic-marker rejection in the shared acceptance evaluator.
This directory retains the regression and verification logs. Synthetic marker
mutations are validation tests, not performance measurements. Original
benchmark artifacts and their collected-head identities remain unchanged.

Collection now rejects any defined `BENCH_DIAGNOSTIC_DRIFT` value for Bun A/A;
read-only plan descriptions do not start collection. The common evaluator rejects
`driftDiagnostic` on cold, warmup, measurement and every resource sample,
including a malformed null marker. Node's existing environment guard remains.

`red.log` records 43 new assertion failures and one passing existing Node CLI
guard. `green.log` passes all 44 selected cases. `full-harness.log` passes
439 of 440 tests, with the existing Linux-only macOS skip and zero failures.
Typecheck, four changed-file LSP diagnostics, exact-byte stdin Biome lint and
diff checks pass. No existing test was removed or weakened.

The offline recheck at repository-root
`.omo/verification/3914-diagnostic-guard-recheck-20261011.json` uses the stricter
evaluator without changing any original file. The original Bun and Node.js
calibrations remain within budget; Fastify and Express remain inconclusive.
Four explicitly synthetic diagnostic-marker mutations now fail evidence
validation. This is not a new performance run or a retrospective promotion.

The independently frozen NAS Node candidate run retains its original producer
heads. Its Node entrypoint already rejects the diagnostic environment, and
its original calibration and finite preparation have no diagnostic markers.
Its final results still require reevaluation with the corrected evaluator.
