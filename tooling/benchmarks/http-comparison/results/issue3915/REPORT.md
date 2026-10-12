# #3915 final engineering artifact report

## Verdict and completion boundary

**Performance is NOT_ESTABLISHED.** Owner approval “미입증 후보 제외” replaces the demand for new passing candidate matrices with candidate withdrawal, verified tooling and truthful reports. It does not turn FAIL, INCONCLUSIVE, incomplete, UNSUPPORTED or owner exclusion into performance PASS. The frozen policy remains unchanged. No parity, improvement, maximum capacity or whole-matrix nonregression is established.

Engineering dependencies #3911, #3912, #3913 and #3914 are merged, archived and cleaned. Each final head had three-axis PASS (lead-reported) and 18 successful GitHub CI checks (captured merge receipts). #3915 is local artifact implementation only: its exact-head contract/code/verification reviews, full final-head GitHub CI, remote-head equality/mergeability, merge, archival, cleanup and lane retrospective remain lead gates. **The lane is not complete.** The older closure-evidence-packet dependencyCompletion string is historical, not current status. CI total elapsed is unknown: individual check timestamps do not prove the canonical preparation/queue/run boundary or a 15-minute budget.

| Issue / PR | Reviewed final head | Merge commit |
| --- | --- | --- |
| #3911 / #3934 | `cc9162b49d6f1af04ed58e71d9aa0fdb90847875` | `d5c4812a3aefdfd005af819247f18d9eb567315b` |
| #3912 / #3933 | `01380383faa3c932632ec6a9bdfd4cc42148b134` | `51b677d1168f6c2527970bb59d5f725fc759fa2b` |
| #3913 / #3935 | `f169f00cf906f2fa1a24ff31f70e88b6ae20ac95` | `bbfc76dbc472202cc88ea5c464878b6cac18f414` |
| #3914 / #3936 | `ea99d9e4a0dc59ddfbd201e07805d6a4962ed3e8` | `9a91d1347be38757ecc433fe6496ea94e2b70587` |

## Policy and independent protocols

policy.json preserves the full original source object and both amendments. Original **semantic digest** is b012894325786ad74b286a537d6b7483c4a79accb6a6d834b9aee4e63d88fa5b; original **file-byte SHA256** is e411f07a12486673a9aaebea5e44aa2da9b05b050fccb9a0f7952439bbb8fbb6. These are distinct identities, neither replaced by the other. Deno amendment semantic digest is 7af9f766d65b962827ae1734377d23de78d74149ea0f6fe9130866f045d90e4b; its byte hash is 59cbc13fe47504ec9fbd6277cb2c1b7bc3cc88e9d19e2873052a920aacf7f1b1. The completion amendment is bound separately.

| Metric | Candidate/BEFORE bound | Maximum CV |
| --- | --- | --- |
| Throughput requests/second | minimum 0.95 | 0.03 |
| Server CPU microseconds/request | maximum 1.05 | 0.03 |
| Per-run p95 milliseconds | maximum 1.10 | 0.05 |
| Per-run p99 milliseconds | maximum 1.15 | 0.075 |
| Sampled process-tree RSS bytes | maximum 1.10 | 0.05 |

All three pairs and the median must meet every applicable limit. Each measured run requires 20000 completed requests. Additional repeats: 0; outlier deletion: prohibited. BEFORE, candidate, paired ratios and native controls retain the CV screen. Original warmup/measurement is 5s/15s; NAS Bun is a separately frozen 30s/60s protocol and NAS Node family is 30s/180s. They are not one interchangeable protocol. Weekly/before-release entries are prospective policy, not an operational CI schedule.

The numerical gate and collector correction belong to #3914, head c169f9095a76b4b7d139427ff3cabf653413cdd0, at results/issue-3914/paired-aa.mts. The corrected Node reevaluation validator hash is 3b6ec3afd2c8d1ac53ac93ce7f4e6a0451679d531cae12e407b28aefd97cf6a6. This artifact checker neither copies that engine nor calculates new numerical acceptance.

## Platform dispositions and preserved measurements

| Platform / environment | Evidence and disposition |
| --- | --- |
| Fastify / Node | 12 runs / 9199248 requests, INCONCLUSIVE: native throughput, CPU/request and p95 drift. Calibration blocked candidate comparison. |
| Express / Node | 12 runs / 4164414 requests, INCONCLUSIVE: native p99 drift. Calibration blocked candidate comparison. Historical header/stream candidates remain rejected. |
| Node.js / Node | Candidate 12 runs / 7856265 requests, INCONCLUSIVE: native RSS block CV 5.584327506359987% exceeds 5%. No budget breaches, evidence errors or invalid attempts; 64 raw hashes match. Offline equality preserves INCONCLUSIVE, not PASS. Same-code calibration: 12 runs / 7824418 requests, OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE only. |
| Bun / Bun | Shared-header candidate 12 runs / 4642263 requests, INCONCLUSIVE: paired throughput/CPU instability and native p95/p99 drift. Same-code calibration 12 runs / 4607948 requests is limited to minimal/equivalent/c64. No accepted Bun-specific adapter optimization or full Bun matrix. |
| Workers / local workerd | 44/44 finite correctness, 180 requests, 220 authenticated raw artifacts. Partial BEFORE calibration remains incomplete performance evidence. |
| Workers / deployed Version URLs | 44/44 immutable-version correctness; 180 new requests and cumulative 204/250 cap. Correctness-only, not production traffic allocation, isolate cold, exclusive CPU/RSS, throughput or budget acceptance. |
| Next.js / production Node App | Local correctness is part of combined App/Pages 88/88 conditions, 360 requests, 440 raw artifacts. Original native-nextjs timeout remains failed; incomplete performance evidence. |
| Next.js / production Node Pages | Separate production build identity; same combined correctness receipt, not an additional 360 requests. Incomplete performance evidence; Edge excluded. |
| Deno / Deno | EXCLUDED_BY_OWNER_NOT_PASS, performance only. Public support, functionality, portability and native regression obligations remain. Historical native diagnostics are not Fluo conformance or Bun completion. |

Workers/Next BEFORE: 263/264 expected samples and 2454837 measured requests; 241 samples below 20000. The failed default/native-nextjs/stage-routing-params/concurrency64 run had 7 timeouts and 1666 completed requests. Continuation collected only the previously unattempted 169 conditions, not a retry of the failed condition. Instrumented diagnosis completed 8167 requests across two runs without reproducing timeouts; it does not replace the original failure or establish its cause. The earlier deployed production check retains 20 successes, 2 failures and 2 diagnostic requests; later Version URL correctness does not erase it.

Historical Nest Fastify/Express comparisons are same-Node-host diagnostics, not a complete business BEFORE/candidate/Nest matrix or competitiveness verdict. The combined Express candidate was rejected; stream-only CPU paired ratio 1.0508237154627784 exceeded 1.05, while unstable latency stayed INCONCLUSIVE. Header-index RSS CV/breach evidence and older 60s native drift stay separate from the later empty budgetBreaches. Missing metrics are never zero.

## Source identity, exclusions and remaining limits

manifest.json binds each committed summary digest to a local original source and an evidence role: raw, summary, diagnostic, correctness, calibration, candidate, offline-reevaluation, engineering or archive. summaries retain source/head, condition, observed ratios and units. Missing exact serving, collector, build or lockfile identity is explicitly UNKNOWN with a reason, not replaced by a different arm. Root NAS raw provenance retains available per-arm build and lockfile records. Source head and harness/producer head are different concepts.

Both NAS candidates used framework BEFORE 1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18. Bun candidate source is 2f4dd790acac4fc5b73e04291b6a2481a5108e54; producer heads are b7b4aaa5f333d93ee68929fb061dee11902c0b61 and bdb3fa568c9dc688a00cb83f2d32a7036916a77c. Node candidate source is 99614b72c801542b220e620b91dad7a944c64c40; producer heads are c554860cae0f05ebf8e95d079a02d3f58ed3f50d and 72ba42390d00cb693d900e0d34d7cb870e3cc2bb. NAS is Linux x64 kernel 4.4.302+, Bun 1.4.2 / Node 24.21.0; observed execution does not extend official runtime support.

Ordinary exclusion commits cc9162b49d6f1af04ed58e71d9aa0fdb90847875 (#3911) and 01380383faa3c932632ec6a9bdfd4cc42148b134 (#3912) restored runtime web.ts and internal-node-request.ts to the approved base and removed candidate-only Changesets. Direct base-to-starting-head diff is empty for those runtime files and release entries. Historical candidate commits, raw and independently justified regression/tooling remain; their focused validation is linked by the predecessor receipts/reports, not rerun here.

Remaining costs include live case-insensitive header scanning, Request/Response materialization and host routing/initialization. Their removable share is not causally proven by these summaries. CPU is measured server-process-tree cost, not deployed isolate exclusive CPU. RSS samples are not retained heap/allocation; run percentiles are not pooled request percentiles; process startup is not isolate cold; local host and deployed results are distinct. Generator headroom, host/kernel constraints, unmeasured matrix conditions and provider resource boundaries prevent capacity/parity conclusions.

Node candidate elapsed 2818.790038989s spans first recorded run start to last end, excluding preparation and initial parent verification. Fastify and Express reported elapsed are 2822.562464627s / 2815.567175816s, with exact aggregate boundaries not separately established in the rollup. Bun candidate reports 1323.373550365s with exact boundary unavailable. Bun calibration reports measurement 1144.8981166319998s, initial provisioning 355s, and build/verification 635.827s separately. Workers/Next arithmetic 168984s = 46.94 hours estimates both arms over 43 complete groups; excludes the failed group, builds, startup/teardown, authentication and extra controls. It is planning cost, not actual CI elapsed or a success forecast.

## Preservation and focused verification

All .omo paths are repository-root local durable locators, not public downloads. Pre-exclusion archive receipt/plan retains candidate-history.bundle (be6410c2898cb3d3aa331990aa9d0e5c5f235ec273628f1c56ba9de9ca1249d4) and worktree-raw-before-exclusion.tar.gz (00cfc4ebe237154e8a1330fb7fd9ad6d546b9698ae35b3e52dd224104b3f5b98), 5235 members, command/listing/bundle verify exit 0. This snapshot predates final reports; root .omo evidence, retrospective records and separatelyPreserved archives are outside its scope.

Final closure-3911/3912/3913/3914 receipts bind separate post-exclusion archives. #3914 final tar has 2980 members / 10374267 bytes; relocated historical test artifacts and root NAS raw remain separate. lane-measurement-closure-20261012/receipt.json records eight measurement HEAD bundles and results/.omo archives, lead-verified inclusion/listing/bundle checks. Original measurement worktrees remain pending final lane cleanup; issue/review worktrees and issue branches are cleaned. Directly rechecked: 10 issue/pre-exclusion archive hashes and 64 Node raw hashes. Other raw and measurement archive verification is explicitly receipt-based, not claimed as a new individual rehash.

Run node verify-artifacts.mjs and node --test verify-artifacts.test.mjs here. The checker requires no external .omo access, dependencies, benchmark, deployment or network request. It verifies containment, bytes hashes and artifact machine consistency only. REPORT machine blocks bind both locales to the same policy/dispositions/evidence; prose is not pinned by tests. Focused check receipts live under logs/. No full local CI was run per session approval. Independent exact-head review and full GitHub CI are later gates. No Changeset: private benchmark reporting/checker/tests do not alter public package behavior, API, contents or release metadata.

## Machine-consumed report binding

```json artifact-data
{
  "schemaVersion": 1,
  "issue": 3915,
  "performanceVerdict": "NOT_ESTABLISHED",
  "engineeringStatus": "DEPENDENCIES_MERGED_REPORT_LOCAL_ONLY",
  "allLaneComplete": false,
  "depends_on": [
    3911,
    3912,
    3913,
    3914
  ],
  "policySha256": "2cbe630f271435c5ae7041cc9d86bd14523e44aafdb8a297a11578f99cfebbe6",
  "dispositionsSha256": "f02edbd414d27e9dc3e6f51bf7d83771868168ede4e46084e33915fa30f9409e",
  "evidence": [
    {
      "id": "bun-candidate",
      "sha256": "e0f55c4f6e6600ffb9a00fcd137840392a5fa3960e90294c8d7592a882391f3b"
    },
    {
      "id": "node-candidate",
      "sha256": "e716cab855c35cb16f05e465a84c15c4a0f54bb2706ec5407984fc69c19549c7"
    },
    {
      "id": "node-raw",
      "sha256": "e5290375d36d55e267fd7000bb9cbd25e598b8acdf809bb35c0a1fe606a9f3b5"
    },
    {
      "id": "node-offline",
      "sha256": "0c64cd1b2bf6637f5eec0af1c0544324e6abbf25b00f145473fc73690b3325cd"
    },
    {
      "id": "node-calibration",
      "sha256": "b80fff925f4313b7e1420620d4bcea2fc7f8e57cf2018030287e2c31a4de6fff"
    },
    {
      "id": "bun-calibration",
      "sha256": "44889efe7d9f7c93f991972374b58c5e324498facb4a6cae02b563ed227dedde"
    },
    {
      "id": "host-before",
      "sha256": "b3b56ebe31224efaa9dd88dcbdfa7c160f9a1fe22b49df5db3533565ea619f0f"
    },
    {
      "id": "host-failure",
      "sha256": "e8ab8d51af6957cdb7090a5c57fdcf2b258f260e4b83d29404bf4ac51fd9acfb"
    },
    {
      "id": "next-diagnostic",
      "sha256": "ecffd75d83bf7872ec90638c8933a2380b8c32de94030aa42f75699c0eafaf14"
    },
    {
      "id": "workers-correctness",
      "sha256": "9de56811fcb0534c0fcef5a2ae1e773dd59393c25ad4ee3b06611523f09bbfb1"
    },
    {
      "id": "next-correctness",
      "sha256": "a0bace7c22146455471a75445f221d4484f88dd496e82731d10e6f413ea9ff37"
    },
    {
      "id": "deployed-correctness",
      "sha256": "33a38376fe6e1ece7677609ec011ea6fb6376771741757b935c33f4ca911fcb0"
    },
    {
      "id": "engineering-3911",
      "sha256": "86bd05cd908edbcb233a2185a019f296f64f53692c6e236b032e2f991a504239"
    },
    {
      "id": "cleanup-3911",
      "sha256": "e434842bf7fd26d80a8fd589265f6e9c1fbcf16c65feedd336c87109cfbbd6b9"
    },
    {
      "id": "archive-3911",
      "sha256": "540cf06e2e1d69bf3bd6df357c9f49065064218eeb72da42c6c7de0939c77261"
    },
    {
      "id": "engineering-3912",
      "sha256": "bd111c72fd9fcf56461528f35073d6050ca6c125ecaeac037dd870c9b17b50ca"
    },
    {
      "id": "cleanup-3912",
      "sha256": "7bcb2f7a156fe70ac6ec5b907249613cffed4da526407ae36c65eb6031e0cdc9"
    },
    {
      "id": "archive-3912",
      "sha256": "84eced5499d0cfb1d0f402200caa095e58a840b9f75afa252667c86cfb3e4a9c"
    },
    {
      "id": "engineering-3913",
      "sha256": "5c3c86400be30c409e92e05b23aea1e0794735bdd8fba713a1f209884e3724e8"
    },
    {
      "id": "cleanup-3913",
      "sha256": "eccea542abdc553dccd39645156d07ea6cdf76093ab2b68710f0c57030df6cca"
    },
    {
      "id": "archive-3913",
      "sha256": "62d470123dfc9b3479b05a7919220e2cfe94705f2d75d20c136db30426d2cf29"
    },
    {
      "id": "engineering-3914",
      "sha256": "98de55e7dca17a1ae3f0d4ff8e2793a52fc472ce869a404115c9c9a8c9611081"
    },
    {
      "id": "cleanup-3914",
      "sha256": "cb5df2457189a675ceff0471f3bd8843ee85e64e09d967721147d4059aaefc93"
    },
    {
      "id": "archive-3914",
      "sha256": "36a29ac85d916060cc32978e8a178eb5e5194b2e2fd8853c174a407ade1c919e"
    },
    {
      "id": "pre-exclusion-archive",
      "sha256": "337594f788a5493c0d836077982829383edf6e86a34af9b6fb8d13c12bc49237"
    },
    {
      "id": "archive-plan",
      "sha256": "9ae267d02f3b05004cf5ae1feb22b37f2fd720b22af7baca9058321b5e920998"
    },
    {
      "id": "measurement-archives",
      "sha256": "be3afbc3c42fcb4c0034926e15d740bdc3d1a8b5962b278a3aca5a07429e4d96"
    }
  ]
}
```
