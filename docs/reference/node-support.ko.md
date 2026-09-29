# Node.js Support

<p><strong><kbd>한국어</kbd></strong> <a href="./node-support.md"><kbd>English</kbd></a></p>

## Support matrix

Node floor는 역할별로 분류됩니다. 순수 runtime인 32개 Node-bound public package([`@fluojs/platform-fastify`](../../packages/platform-fastify/README.ko.md) 포함)는 `engines.node: ">=24.0.0 <27"`을 유지합니다. Babel 8 compiler tooling package인 [`@fluojs/cli`](../../packages/cli/README.ko.md), [`@fluojs/vite`](../../packages/vite/README.ko.md), [`@fluojs/platform-nextjs`](../../packages/platform-nextjs/README.ko.md)와 private root workspace, examples, 생성 Node toolchain 프로젝트는 `engines.node: ">=24.11.0 <27"`으로 올립니다. Babel 8은 upstream에서 Node `^22.18.0 || >=24.11.0`을 요구하고 fluo는 Node 22를 계속 제외하기 때문입니다. 컴파일하지 않는 package에 대해 exact Node `24.0.0`은 여전히 지원되는 runtime floor입니다. Node 24 LTS 채택은 lifecycle 및 지원 정책 결정이며 dependency나 새 runtime API가 Node 24를 요구한다는 주장이 아닙니다. 다음 major release부터 Node 20과 Node 22는 지원하지 않습니다.

| Runtime | CI verification | Release role |
| --- | --- | --- |
| Exact Node `24.0.0` | Runtime-only floor lane: 지원되는 compiler Node에서 빌드한 artifact로 실제 public runtime entry import와 HTTP listener, dispatch, config, shutdown 동작을 수행; Babel 8 로딩과 24.0.0 설치 없음 | 최소 지원 runtime floor이며 release runtime은 아님 |
| Exact Node `24.11.0` | PR: frozen install, fresh build, 모든 package test와 4종 starter smoke; extended: 전체 검증과 browser journey | Babel 8의 최소 compiler toolchain floor |
| Locked Node `24.x` | 전체 primary PR 검증, `pnpm verify:docs`, 생성 starter dev/production browser matrix | Canonical 개발 검증 및 Changesets release runtime |
| Locked Node `26.x` | PR: frozen install, fresh build, 모든 package test와 4종 starter smoke; extended: 전체 검증과 browser journey | Forward verification 전용이며 publish에 사용하지 않음 |
| Bun, Deno, Cloudflare Workers | 기존의 독립 adapter/native-runtime lane | Runtime-native 배포 계약 |

`.github/workflows/ci.yml`은 plan 확정과 필수 `Verify` 집계를 포함해 18개 job으로 확장됩니다. 16개 실행 task는 `tooling/ci/local-verification-manifest.json`의 공통 catalog와 `tooling/ci/verification-runner.mjs`를 사용하며, `.github/workflows/node-verification.yml`은 호출마다 task 하나를 실행합니다. Primary package test는 4개 shard, tooling은 2개 shard를 유지하고 apps/examples는 첫 tooling shard에서 한 번 실행합니다. Primary build는 package artifact와 runtime-floor bundle을 제공합니다. Exact Node `24.0.0`은 workspace dependency 설치와 Babel 로딩 없이 bundle을 실행합니다.

이 정책은 기존의 세 버전 전체 PR matrix를 전체 primary profile과 두 compatibility profile로 대체합니다. Package engine 지원 범위는 바꾸지 않지만 보조 버전의 PR 검증 범위는 좁아집니다. 보조 버전의 전체 typecheck, lint, tooling, apps/examples, browser 검증은 `.github/workflows/extended-verification.yml`과 `.github/workflows/release.yml`의 exact-source 선행 검증으로 이동합니다. 이전 정기 실행의 성공은 publishing commit의 extended 검증을 대신하지 않습니다.

`tooling/ci/environment.lock.json`은 runner마다 floating Node tag를 독립적으로 해석하는 대신 정확한 버전과 다운로드 checksum을 고정합니다. 새 버전을 채택할 때는 리뷰된 변경으로 lock을 갱신합니다. 로컬과 원격 task는 같은 Debian Linux/amd64 image recipe, browser, native runtime 버전을 사용합니다.

정기 실행은 lock을 자동 변경하지 않고 사용 가능한 Node 24/26 버전을 보고합니다. 생성 starter의 PR 검증은 `tooling/cli/verification-locks/`의 리뷰된 snapshot 4개를 사용합니다. 외부 resolution은 고정하고, 현재 소스의 internal tarball integrity는 dependency graph가 snapshot과 일치할 때만 다시 연결합니다. Graph가 바뀌면 재생성 안내와 함께 실패합니다. 실제 fresh 설치 결과를 `tooling/cli/starter-lockfile.mjs`의 `captureStarterSnapshot`과 고정된 Bun YAML parser로 수집하고 dependency 변경을 리뷰한 뒤 locked matrix를 실행하세요. 독립 sandbox 명령은 기본 fresh resolution을 유지하며 extended profile도 별도의 fresh-resolution starter matrix를 실행합니다.

Plan job과 canonical local 명령은 task fan-out 전에 host에서 실제 Docker runner fixture를 실행합니다. 테스트 container 안에서 Docker fixture를 재귀 실행하지 않고 source 격리, artifact 복원, 실패 증거를 검증합니다. Daemon을 사용할 수 없으면 이 gate를 skip하지 않고 실패합니다.

Task는 pnpm의 integrity 검증을 거친 package store를 재사용하지만 checkout과 `node_modules` 배치는 분리합니다. Workspace build output은 검증된 build archive로만 task 경계를 넘습니다. 재실행 job은 attempt별 task 증거를 저장한 뒤 canonical artifact alias를 갱신하므로 이전 실패 log와 browser trace도 보존합니다.

`pnpm verify:local --base-ref <sha>`는 격리된 Linux/amd64 container에서 같은 PR task를
실행하고 exact-head receipt를 기록합니다. `--plan`은 성공 증거 없이 고정 계획만
출력하며 `--profile extended`는 보조 버전의 전체 검증도 실행합니다.
Docker는 amd64 실행, Linux 소유 writable volume, Unix socket 접근, host-network
fixture 연결을 지원해야 합니다. Apple Silicon은 emulation을 사용하므로 hosted x64보다
느릴 수 있습니다. Source와 file-watch 검증은 macOS bind mount가 아닌 Linux volume에서
실행합니다. 환경을 사용할 수 없으면 실패하며 native macOS나 arm64 실행으로 조용히
대체하지 않습니다.

Receipt는 source tree, base/diff, profile, catalog, environment lock, 실제 runtime/browser
버전, 필수 task 결과와 log/artifact digest를 묶습니다. 이전 host-native receipt는 이
Linux profile의 증거가 아닙니다. GitHub 권한, artifact 전달, queueing, 외부 장애는 여전히
원격 증거가 필요합니다. Failure census는 나중 실행이 성공해도 실패한 attempt를 보존합니다.

Receipt identity는 시작, 각 command boundary, finalization의 clean Git status digest도
묶습니다. Artifact consumer는 exact run/name/SHA/digest provenance를 사용하며,
관측된 intermediary `403`와 좁은 transient `5xx`에만 bounded retry를 적용합니다.
Authentication, 일반 authorization, malformed metadata, expired artifact, digest mismatch는
즉시 실패합니다. Census는 attempt detail과 attempt별 job을 조회하고 엄격한 UTC
`[since, until)` window를 적용하며 pagination/completeness limit을 성공으로 숨기지
않고 기록합니다.

전체 검증의 package build는 같은 workflow run, commit, Node 버전 안에서만 전달합니다. Runtime-floor bundle은 compiler Node에서 exact Node `24.0.0`으로 의도적으로 전달하되 같은 run, commit, artifact identity, digest 검증을 유지합니다. 패키지의 `dist`와 CLI의 생성 dependency metadata를 tar로 보존하여 실행 권한과 symbolic link를 유지하며, 공개 선언 검증 fixture나 package global setup을 우회하지 않습니다. 생성 starter 검증은 테스트 종료를 기다리지 않고 빌드 뒤에 실행합니다. 최신 `24.x`가 기존의 중복 PR 검증을 통합하고 `pnpm verify:docs`를 한 번 실행합니다. Aggregate gate는 필수 job의 failure, cancellation, skip을 성공으로 처리하지 않습니다.

두 native task가 모든 runtime별 검증을 보존합니다. `native-bun`은 각자 고정된 버전으로 Bun routing/lifecycle과 Drizzle을 실행합니다. `native-web`은 Deno adapter, 모든 Bun/Deno/Workers portability 사례와 세 native cookie 명령을 실행합니다. Job을 묶어도 floor runtime을 최신 버전으로 대체하지 않습니다. 필수 명령 실패, 증거 누락, 취소, 예상치 못한 skip은 `Verify`를 차단합니다.

집중 검증 명령인 `test:node-floor`는 로컬 확인용으로 유지하며 전체 CI 검증을 대체하지 않습니다. 이 명령은 manifest 분류, 모든 scaffold profile, config env-file/watch 동작, 배포 portable runtime import, Node HTTP listener, adapter portability, 기존 Vite compatibility seam을 검증합니다. 필수 runtime-only lane은 exact Node `24.0.0`에서 실행되므로 CI는 runtime floor 검증을 더 최신인 24.x patch로 대체하지 않습니다.

## Portable package boundaries

다음 8개 public root는 의도적으로 `engines.node`를 생략합니다: `@fluojs/config`, `@fluojs/email`, `@fluojs/i18n`, `@fluojs/platform-bun`, `@fluojs/platform-cloudflare-workers`, `@fluojs/platform-deno`, `@fluojs/react`, `@fluojs/runtime`. 이웃 manifest와 모양을 맞추려고 engines를 복원하지 마세요.

Package-wide Node metadata는 모든 conditional export나 runtime-native adapter에 대한 주장이 아닙니다. 기존 Bun, Deno, Workers 동작은 각 package README의 계약을 따릅니다. Config의 in-memory root는 portable하게 유지됩니다. Env-file/기본 `.env` loading과 watch mode는 `>=24.0.0 <27`에서 지원하는 Node 전용 기능입니다. 기존 capability guard는 host가 builtin 경계를 제공하지 못할 때 계속 `CONFIG_RUNTIME_UNAVAILABLE`을 발생시킵니다. Import나 feature 호출에 새 Node version 검사는 없습니다.

생성된 Node HTTP(Fastify, Express, raw Node), mixed, 7개 microservice transport, React SSR + Fastify starter는 compiler toolchain engine range인 `>=24.11.0 <27`을 선언하고 `node24`로 빌드하며 `@types/node@^24.0.0`을 사용하고 Babel 8 의존성과 호환되는 Babel 8 config를 생성합니다. Bun과 Deno의 engine 및 native build/start 명령은 유지됩니다. Workers의 기존 Node engine은 배포 isolate가 아니라 로컬 CLI/Wrangler tooling을 설명합니다.

## Migration

1. 영향받는 package를 업그레이드하기 전에 Node 20/22 로컬 설치, CI runner, 배포 host를 최신 Node 24 LTS로 교체하세요. 애플리케이션 `engines.node`에는 runtime package의 경우 `>=24.0.0 <27`을, CLI 생성 프로젝트 같은 Babel 8 compiler toolchain host는 `>=24.11.0 <27`을 사용하고, `--ignore-engines`를 migration 대신 사용하지 마세요.
2. Build 및 runtime stage의 `node:20-slim` 같은 container base image를 `node:24-slim`으로 교체하세요. 이미지를 다시 빌드하고 native addon을 포함한 dependency를 새 runtime에서 다시 설치하세요.
3. CLI를 업그레이드해도 기존 생성 Node 프로젝트는 자동 수정되지 않습니다. Vite server build target을 `node20`에서 `node24`로, Node typings를 `@types/node@^24.0.0`으로, Babel dependency를 Babel 8 기준선으로, `engines.node`를 `>=24.11.0 <27`로 변경하고 프로젝트에서 선택한 package manager로 lockfile을 갱신하세요.
4. Node 24에서 애플리케이션 install, build, typecheck, test를 실행하세요. HTTP listener와 microservice startup/shutdown, 해당하는 경우 첫 React page 및 hydration도 확인하세요. 애플리케이션이 이 전체 범위를 광고한다면 exact `24.0.0`과 최신 `26.x` 검증도 유지하세요.
5. 비 Node 배포에서는 native engine metadata와 배포 명령을 유지하고 Node-hosted 개발 tooling만 업그레이드하세요. Portable host에서는 Node env-file/watch 지원을 가정하지 말고 명시적인 in-memory config map을 전달하세요.

다음 coordinated release의 전체 순서(Node → 패키지 → import → config/toolchain)는 [소비자 마이그레이션 가이드](../getting-started/migrate-node24.ko.md)를 따릅니다. Config의 Node 전용 feature 지원을 포함해 stable public package마다 explicit major intent를 선언하며 React는 0.x minor를 유지합니다. Package version과 changelog는 Changesets만 생성하고 실제 출시와 문서 공개는 maintainer가 수행합니다. #3169는 user-run release까지 umbrella로 유지됩니다.
