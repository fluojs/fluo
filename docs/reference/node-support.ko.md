# Node.js Support

<p><strong><kbd>한국어</kbd></strong> <a href="./node-support.md"><kbd>English</kbd></a></p>

## Support matrix

Private root workspace와 34개 Node-bound public package는 `engines.node: ">=24.0.0 <27"`을 선언합니다. Node 24 LTS 채택은 lifecycle 및 지원 정책 결정이며 dependency나 새 runtime API가 Node 24를 요구한다는 주장이 아닙니다. 다음 major release부터 Node 20과 Node 22는 지원하지 않습니다.

| Runtime | CI verification | Release role |
| --- | --- | --- |
| Exact Node `24.0.0` | Frozen install, 전체 `pnpm verify`, 생성 starter sandbox matrix | 최소 지원 floor이며 release runtime은 아님 |
| Latest Node `24.x` | Frozen install, canonical `pnpm verify`, `pnpm verify:docs`, 생성 starter sandbox matrix | Canonical 개발 및 Changesets release runtime |
| Latest Node `26.x` | Frozen install, 전체 `pnpm verify`, 생성 starter sandbox matrix | Forward verification 전용이며 publish에 사용하지 않음 |
| Bun, Deno, Cloudflare Workers | 기존의 독립 adapter/native-runtime lane | Runtime-native 배포 계약 |

`.github/workflows/ci.yml`의 `node-support` job은 aggregate `verify` gate의 필수 조건입니다. 모든 matrix 항목은 `pnpm verify`로 전체 build, typecheck, lint, test suite를 실행합니다. 집중 검증 명령인 `test:node-floor`는 로컬 확인용으로 유지하며 전체 CI 검증을 대체하지 않습니다. 이 명령은 manifest 분류, 모든 scaffold profile, config env-file/watch 동작, 배포 portable runtime import, Node HTTP listener, adapter portability, 기존 Vite compatibility seam을 검증합니다. CI는 exact 24.0.0 검증을 더 최신인 24.x patch로 대체하지 않습니다.

## Portable package boundaries

다음 8개 public root는 의도적으로 `engines.node`를 생략합니다: `@fluojs/config`, `@fluojs/email`, `@fluojs/i18n`, `@fluojs/platform-bun`, `@fluojs/platform-cloudflare-workers`, `@fluojs/platform-deno`, `@fluojs/react`, `@fluojs/runtime`. 이웃 manifest와 모양을 맞추려고 engines를 복원하지 마세요.

Package-wide Node metadata는 모든 conditional export나 runtime-native adapter에 대한 주장이 아닙니다. 기존 Bun, Deno, Workers 동작은 각 package README의 계약을 따릅니다. Config의 in-memory root는 portable하게 유지됩니다. Env-file/기본 `.env` loading과 watch mode는 `>=24.0.0 <27`에서 지원하는 Node 전용 기능입니다. 기존 capability guard는 host가 builtin 경계를 제공하지 못할 때 계속 `CONFIG_RUNTIME_UNAVAILABLE`을 발생시킵니다. Import나 feature 호출에 새 Node version 검사는 없습니다.

생성된 Node HTTP(Fastify, Express, raw Node), mixed, 7개 microservice transport, React SSR + Fastify starter는 같은 engine range를 선언하고 `node24`로 빌드하며 `@types/node@^24.0.0`을 사용합니다. Bun과 Deno의 engine 및 native build/start 명령은 유지됩니다. Workers의 기존 Node engine은 배포 isolate가 아니라 로컬 CLI/Wrangler tooling을 설명합니다.

## Migration

1. 영향받는 package를 업그레이드하기 전에 Node 20/22 로컬 설치, CI runner, 배포 host를 최신 Node 24 LTS로 교체하세요. 애플리케이션 `engines.node`에는 `>=24.0.0 <27`을 사용하고, `--ignore-engines`를 migration 대신 사용하지 마세요.
2. Build 및 runtime stage의 `node:20-slim` 같은 container base image를 `node:24-slim`으로 교체하세요. 이미지를 다시 빌드하고 native addon을 포함한 dependency를 새 runtime에서 다시 설치하세요.
3. CLI를 업그레이드해도 기존 생성 Node 프로젝트는 자동 수정되지 않습니다. Vite server build target을 `node20`에서 `node24`로, Node typings를 `@types/node@^24.0.0`으로 변경하고 프로젝트에서 선택한 package manager로 lockfile을 갱신하세요.
4. Node 24에서 애플리케이션 install, build, typecheck, test를 실행하세요. HTTP listener와 microservice startup/shutdown, 해당하는 경우 첫 React page 및 hydration도 확인하세요. 애플리케이션이 이 전체 범위를 광고한다면 exact `24.0.0`과 최신 `26.x` 검증도 유지하세요.
5. 비 Node 배포에서는 native engine metadata와 배포 명령을 유지하고 Node-hosted 개발 tooling만 업그레이드하세요. Portable host에서는 Node env-file/watch 지원을 가정하지 말고 명시적인 in-memory config map을 전달하세요.

다음 coordinated release의 전체 순서(Node → 패키지 → import → config/toolchain)는 [소비자 마이그레이션 가이드](../getting-started/migrate-node24.ko.md)를 따릅니다. Config의 Node 전용 feature 지원을 포함해 stable public package마다 explicit major intent를 선언하며 React는 0.x minor를 유지합니다. Package version과 changelog는 Changesets만 생성하고 실제 출시와 문서 공개는 maintainer가 수행합니다. #3169는 user-run release까지 umbrella로 유지됩니다.
