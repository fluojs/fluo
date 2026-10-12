# #3915 최종 engineering 산출물 보고

## 판정과 완료 경계

**성능 판정은 NOT_ESTABLISHED다.** 소유자의 “미입증 후보 제외” 승인은 새 passing candidate matrix 요구를 후보 철회·검증된 tooling·사실 기반 보고로 대체한다. FAIL, INCONCLUSIVE, incomplete, UNSUPPORTED와 owner exclusion을 performance PASS로 바꾸지 않는다. 고정 정책은 변경하지 않으며 경쟁력 동등성, 개선, 최대 capacity 또는 전 행렬 비회귀를 입증하지 않았다.

Engineering 선행 #3911, #3912, #3913, #3914는 merge·archive·cleanup됐다. 각 최종 head는 세 축 PASS(lead 전달)와 GitHub CI 18개 success(captured merge receipts)를 갖는다. #3915는 로컬 산출물 구현 단계다. exact-head contract/code/verification review, full final-head GitHub CI, remote-head equality/mergeability, merge, archive, cleanup과 lane retrospective는 lead의 후속 gate다. **전체 lane 완료를 주장하지 않는다.** 이전 closure-evidence-packet의 dependencyCompletion 문구는 당시 기록이다. 개별 check timestamp는 canonical 준비/queue/run 전체 경계나 15분 예산을 증명하지 않아 CI 총 elapsed는 미확보다.

| Issue / PR | 리뷰된 최종 head | Merge commit |
| --- | --- | --- |
| #3911 / #3934 | `cc9162b49d6f1af04ed58e71d9aa0fdb90847875` | `d5c4812a3aefdfd005af819247f18d9eb567315b` |
| #3912 / #3933 | `01380383faa3c932632ec6a9bdfd4cc42148b134` | `51b677d1168f6c2527970bb59d5f725fc759fa2b` |
| #3913 / #3935 | `f169f00cf906f2fa1a24ff31f70e88b6ae20ac95` | `bbfc76dbc472202cc88ea5c464878b6cac18f414` |
| #3914 / #3936 | `ea99d9e4a0dc59ddfbd201e07805d6a4962ed3e8` | `9a91d1347be38757ecc433fe6496ea94e2b70587` |

## 정책과 독립 protocol

policy.json은 원본 source object 전체와 두 amendment를 보존한다. 원본 **semantic digest**는 b012894325786ad74b286a537d6b7483c4a79accb6a6d834b9aee4e63d88fa5b, 원본 **file-byte SHA256**는 e411f07a12486673a9aaebea5e44aa2da9b05b050fccb9a0f7952439bbb8fbb6이다. 서로 다른 identity로 어느 쪽도 교체하지 않는다. Deno amendment semantic digest는 7af9f766d65b962827ae1734377d23de78d74149ea0f6fe9130866f045d90e4b, byte hash는 59cbc13fe47504ec9fbd6277cb2c1b7bc3cc88e9d19e2873052a920aacf7f1b1이다. 완료 범위 amendment도 별도로 연결한다.

| Metric | Candidate/BEFORE 한계 | 최대 CV |
| --- | --- | --- |
| Throughput requests/second | 최소 0.95 | 0.03 |
| Server CPU microseconds/request | 최대 1.05 | 0.03 |
| Per-run p95 milliseconds | 최대 1.10 | 0.05 |
| Per-run p99 milliseconds | 최대 1.15 | 0.075 |
| Sampled process-tree RSS bytes | 최대 1.10 | 0.05 |

세 pair 모두와 median이 각 한계를 만족해야 한다. 측정 run마다 completed requests 20000개가 필요하다. 추가 반복은 0회, outlier 삭제는 금지다. BEFORE·candidate·paired ratios·native controls의 CV 검사를 유지한다. 원본 warmup/measurement는 5s/15s이며 NAS Bun은 별도 고정 30s/60s, NAS Node 계열은 30s/180s다. 같은 protocol로 합치지 않는다. Weekly/before-release 항목은 prospective 정책이지 실제 CI schedule 운영 근거가 아니다.

수치 gate와 collector correction은 #3914의 c169f9095a76b4b7d139427ff3cabf653413cdd0 및 results/issue-3914/paired-aa.mts 소유다. 정정 Node reevaluation validator hash는 3b6ec3afd2c8d1ac53ac93ce7f4e6a0451679d531cae12e407b28aefd97cf6a6이다. 이번 checker는 해당 engine을 복제하거나 새 수치 acceptance를 계산하지 않는다.

## 플랫폼 disposition과 보존 측정

| Platform / environment | 증거와 disposition |
| --- | --- |
| Fastify / Node | 12 runs / 9199248 requests, INCONCLUSIVE: native throughput·CPU/request·p95 drift. Calibration이 candidate comparison을 허용하지 않았다. |
| Express / Node | 12 runs / 4164414 requests, INCONCLUSIVE: native p99 drift. Candidate comparison 미허용이며 과거 header/stream 후보는 거절 상태다. |
| Node.js / Node | Candidate 12 runs / 7856265 requests, INCONCLUSIVE: native RSS block CV 5.584327506359987% > 5%. Budget breaches·evidence errors·invalid attempts 없음, raw hash 64개 일치. Offline equality는 INCONCLUSIVE 재현이지 PASS가 아니다. Same-code calibration 12 runs / 7824418 requests는 OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE에만 해당한다. |
| Bun / Bun | Shared-header candidate 12 runs / 4642263 requests, INCONCLUSIVE: paired throughput/CPU instability·native p95/p99 drift. Same-code calibration 12 runs / 4607948 requests는 minimal/equivalent/c64 한정이다. 수용된 Bun 고유 adapter 최적화나 완전한 matrix가 없다. |
| Workers / local workerd | Finite correctness 44/44, 180 requests, raw artifacts 220개 인증. Partial BEFORE calibration은 불완전한 성능 증거다. |
| Workers / deployed Version URLs | Immutable-version correctness 44/44, 신규 180 requests·누적 204/250 cap. Correctness-only이며 production traffic allocation·isolate cold·exclusive CPU/RSS·throughput·budget acceptance를 뜻하지 않는다. |
| Next.js / production Node App | App/Pages 합산 correctness 88/88 conditions, 360 requests, raw artifacts 440개에 포함된다. 원래 native-nextjs timeout은 실패로 보존하고 성능 증거는 불완전하다. |
| Next.js / production Node Pages | 별도 production build identity이며 같은 합산 receipt다. 360 requests를 추가로 센 것이 아니다. 성능 증거 불완전, Edge 제외다. |
| Deno / Deno | EXCLUDED_BY_OWNER_NOT_PASS, 성능만 제외. 공개 지원·기능·portability·native regression 의무는 유지한다. 역사 native 진단은 Fluo conformance나 Bun 완료가 아니다. |

Workers/Next BEFORE는 expected 264 중 263 samples, measured requests 2454837이며 241 samples가 20000 미달이다. 실패한 default/native-nextjs/stage-routing-params/concurrency64 run의 7 timeouts·1666 completed requests를 보존한다. Continuation은 이전 미시도 169 conditions만 수집했으며 실패 조건 재시도가 아니다. Instrumented diagnosis의 두 run·8167 requests에서 timeout이 재현되지 않았지만 원래 실패를 대체하거나 원인을 입증하지 않는다. 초기 deployed production check의 성공 20·실패 2·진단 2 requests도 유지하며 이후 Version URL correctness가 지우지 않는다.

역사 Nest Fastify/Express 비교는 같은 Node host의 진단이며 완전한 business BEFORE/candidate/Nest matrix나 경쟁력 판정이 아니다. Combined Express 후보는 거절됐고 stream-only paired CPU ratio 1.0508237154627784 > 1.05이며 불안정 latency는 INCONCLUSIVE다. Header-index RSS CV/breach와 기존 60s native drift는 이후의 빈 budgetBreaches와 별도 보존한다. 미확보 metric을 0으로 바꾸지 않는다.

## Source identity, 제외와 잔여 한계

manifest.json은 committed summary digest를 로컬 원본 source 및 raw·summary·diagnostic·correctness·calibration·candidate·offline-reevaluation·engineering·archive 역할에 연결한다. Summaries에 source/head·condition·관측 ratios·단위를 보존한다. 미확보 serving·collector·build·lockfile identity는 이유를 가진 UNKNOWN으로 표시하고 다른 arm으로 대체하지 않는다. Root NAS raw provenance에는 확보된 arm별 build/lockfile 기록이 유지된다. Framework source와 harness/producer head는 구분한다.

두 NAS 후보의 framework BEFORE는 1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18다. Bun candidate source는 2f4dd790acac4fc5b73e04291b6a2481a5108e54, producer heads는 b7b4aaa5f333d93ee68929fb061dee11902c0b61 및 bdb3fa568c9dc688a00cb83f2d32a7036916a77c다. Node candidate source는 99614b72c801542b220e620b91dad7a944c64c40, producer heads는 c554860cae0f05ebf8e95d079a02d3f58ed3f50d 및 72ba42390d00cb693d900e0d34d7cb870e3cc2bb다. NAS는 Linux x64 kernel 4.4.302+, Bun 1.4.2 / Node 24.21.0이며 관측 실행이 공식 runtime 지원을 확장하지 않는다.

Ordinary exclusion commits cc9162b49d6f1af04ed58e71d9aa0fdb90847875 (#3911), 01380383faa3c932632ec6a9bdfd4cc42148b134 (#3912)는 runtime web.ts·internal-node-request.ts를 승인 base로 복구하고 후보-only Changesets를 제거했다. 해당 runtime·release entries의 base-to-starting-head 직접 diff는 비어 있다. 역사 후보 commits·raw·독립 근거를 가진 회귀/tooling은 유지하며 선행 receipts/reports의 focused verification을 연결한다. 여기서 다시 실행한 결과로 표현하지 않는다.

Live case-insensitive header scan, Request/Response materialization, host routing/initialization 비용이 남는다. 제거 가능한 인과적 비중은 이번 summaries로 입증하지 않았다. Server-process-tree CPU는 deployed isolate exclusive CPU가 아니며 sampled RSS는 retained heap/allocation이 아니다. Run percentiles는 pooled request percentile이 아니고 process startup은 isolate cold가 아니다. Local host와 deployed 결과를 구분한다. Generator headroom·host/kernel 제약·미측정 matrix 조건·provider resource 경계 때문에 capacity/parity를 결론내리지 않는다.

Node candidate elapsed 2818.790038989s는 첫 recorded run start부터 마지막 end까지이며 준비·초기 parent verification을 제외한다. Fastify/Express elapsed는 2822.562464627s / 2815.567175816s로 rollup에 기록되며 정확한 합산 경계는 별도 미확보다. Bun candidate의 1323.373550365s도 정확한 경계는 미확보다. Bun calibration은 measurement 1144.8981166319998s·initial provisioning 355s·build/verification 635.827s를 구분한다. Workers/Next의 168984s = 46.94시간은 43 complete groups의 양 arm 계획 비용이다. 실패 group·builds·startup/teardown·authentication·추가 controls를 제외하며 실제 CI elapsed나 성공 forecast가 아니다.

## 보존과 focused verification

모든 .omo 경로는 repository-root local durable locator이며 공개 다운로드가 아니다. Pre-exclusion archive receipt/plan은 candidate-history.bundle (be6410c2898cb3d3aa331990aa9d0e5c5f235ec273628f1c56ba9de9ca1249d4), worktree-raw-before-exclusion.tar.gz (00cfc4ebe237154e8a1330fb7fd9ad6d546b9698ae35b3e52dd224104b3f5b98), 5235 members, command/listing/bundle verify exit 0을 보존한다. Final reports보다 앞선 snapshot이며 root .omo evidence·retrospective 기록·separatelyPreserved archives는 범위 밖이다.

Final closure-3911/3912/3913/3914 receipts는 별도의 post-exclusion archives를 연결한다. #3914 final tar는 2980 members / 10374267 bytes이며 relocated historical test artifacts·root NAS raw는 별도다. lane-measurement-closure-20261012/receipt.json은 measurement HEAD 8개의 bundles와 results/.omo archives를 기록하며 inclusion/listing/bundle 검증은 lead receipt 근거다. 원래 measurement worktrees는 final lane cleanup 대기 중이고 issue/review worktrees·issue branches는 정리됐다. 직접 재확인한 것은 issue/pre-exclusion archive hashes 10개와 Node raw hashes 64개다. 나머지 raw 및 measurement archive 검증은 receipt 기반이지 이번 개별 재해시로 주장하지 않는다.

이 디렉터리에서 node verify-artifacts.mjs와 node --test verify-artifacts.test.mjs를 실행한다. Checker는 외부 .omo 접근·추가 dependency·benchmark·배포·network request 없이 containment·bytes hashes·산출물 machine consistency만 검사한다. REPORT machine blocks는 두 locale을 같은 policy/dispositions/evidence에 연결하고 tests는 prose를 고정하지 않는다. Focused check receipts는 logs/에 보존한다. 승인된 세션 지시대로 full local CI는 실행하지 않았고 독립 exact-head review·full GitHub CI는 후속 gate다. Public package behavior·API·contents·release metadata를 바꾸지 않는 private benchmark report/checker/tests라 Changeset은 불필요하다.

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
