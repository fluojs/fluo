# Upcoming Node 24 Release Migration

<p><strong><kbd>한국어</kbd></strong> <a href="./migrate-node24.md"><kbd>English</kbd></a></p>

## Release preparation status

이 가이드는 #3169의 일부인 #3679 coordinated release를 위한 소비자 마이그레이션
준비 문서입니다. npm 출시나 문서 배포를 발표하지 않습니다. 실제 출시와 이
마이그레이션 문서 공개는 maintainer가 수행합니다. 아래 패키지 업그레이드 예제는
maintainer가 릴리스를 공개한 뒤에 실행하세요.

현재 public manifest 집합은 42개입니다. Stable(`1.0+`) 패키지 41개 모두에
명시적 `major` Changeset intent가 있습니다. `@fluojs/react@0.1.0`은 `0.2.0`을
위한 `minor` intent로 참여하며 `0.x`를 유지하고 `1.0`으로 승격하지 않습니다.
모든 패키지가 같은 버전으로 바뀌는 것이 아니라 패키지별 bump입니다. Listener,
Vite compatibility, Vitest peer, 생성 starter 변경을 포함한 pending feature와
fix 노트는 패키지별 하나의 다음 Changesets 릴리스에 함께 반영됩니다.

**모든 환경의 Node를 먼저, Fluo 패키지를 두 번째, 이동한 import를 세 번째**로
변경한 뒤 config와 toolchain을 조정하세요.

## 1. Upgrade Node everywhere

새 Fluo 패키지를 설치하기 전에 로컬 개발, CI runner, container build/runtime
stage, production host를 Node.js `>=24.0.0 <27`로 옮기세요. 일반적인 개발 및
production 경로는 최신 Node 24 LTS를 사용합니다. Node 20과 Node 22 지원은
제거되며 Node 24 미만과 Node 27 이상은 지원하지 않습니다. 이는 지원 정책
결정이며 새 dependency가 Node 24를 요구한다는 주장이 아닙니다.

- Version manager pin, CI `node-version`, 애플리케이션 `engines.node`를
  변경하세요. 대화형 shell뿐 아니라 각 환경에서 `node --version`을 확인하세요.
- `node:20-slim`, `node:22-slim` 같은 이미지를 **양쪽** container stage에서
  `node:24-slim`으로 교체하세요. 이미지를 다시 빌드하고 dependency와 native
  addon을 새 runtime에서 재설치하세요. `--ignore-engines`로 우회하지 마세요.
- Lockfile을 유지하고 Node 24에서 dependency를 변경할 때 갱신한 뒤, 갱신된
  lockfile로 CI frozen install을 수행하세요.
- Exact Node `24.0.0`, 최신 `24.x`, 최신 `26.x`는 별개 검증 대상입니다.
  애플리케이션이 전체 범위를 지원한다고 명시한다면 각 대상을 검증하세요.
  Fluo release automation은 최신 Node `24.x`를 사용하며 Node 26은 publish
  runtime이 아닙니다.

아래 8개 engine omission은 의도적으로 유지합니다. Bun, Deno, Cloudflare Workers
배포는 native runtime metadata와 deployment 명령을 유지하세요. Node-hosted
CLI/build tooling은 별도로 업그레이드합니다. Workers starter의 Node engine은
배포 isolate가 아니라 로컬 CLI/Wrangler tooling을 설명합니다.

## 2. Upgrade the Fluo package set together

`pnpm list --depth 0`으로 direct dependency와 dev dependency를 확인하세요.
출시 후 Changesets가 생성한 release note에서 설치된 각 패키지의 coordinated
version을 선택하세요. Platform adapter와 optional integration도 포함합니다.
Dependency propagation이 계약까지 마이그레이션한다고 가정하면서 direct
dependency를 이전 major에 남겨 두지 마세요.

예를 들어 runtime, config, raw Node adapter를 사용하는 애플리케이션은 해당
패키지와 설치된 tooling을 다음과 같이 업데이트합니다.

```bash
pnpm add @fluojs/runtime@^3 @fluojs/config@^2 @fluojs/platform-nodejs@^2
pnpm add -D @fluojs/cli@^3 @fluojs/testing@^3 @fluojs/vite@^2
```

이는 모든 애플리케이션의 전체 패키지 목록이 아닙니다. 직접 사용하는
`@fluojs/core`, `@fluojs/di`, `@fluojs/http`, adapter, integration도 각각의
coordinated major로 올리세요. Global CLI를 사용한다면 별도로 업데이트하세요.
이 program guide와 함께 각 패키지에 보존된 feature 및 breaking-change 노트도
읽으세요. 이 가이드는 다른 마이그레이션을 대체하지 않습니다.

React consumer는 `0.2` line을 명시적으로 선택합니다.

```bash
pnpm add @fluojs/react@^0.2.0
```

React `1.0`을 요청하거나 다른 패키지의 major bump로부터 승격을 추론하지
마세요. Pending Vite patch 노트와 CLI minor 노트는 보존되지만 coordinated
major intent와 합산되며 두 번째 릴리스를 예약하지 않습니다.

## 3. Replace moved Node imports

애플리케이션이나 integration이 Node helper를 import하는 곳에
`@fluojs/platform-nodejs`를 direct dependency로 설치한 뒤 source, test,
tooling을 변경하세요.

| Removed import | Replacement |
| --- | --- |
| `@fluojs/runtime/node` | `@fluojs/platform-nodejs` |
| `@fluojs/runtime/internal-node` | `@fluojs/platform-nodejs/internal` |

```ts
import {
  createNodeHttpAdapter,
  runNodeApplication,
} from '@fluojs/platform-nodejs';
```

이동한 symbol은 이름을 유지하며 이전 경로에는 compatibility shim이 없습니다.
Node listener, filesystem asset, logger, compression, process-signal helper가
포함됩니다. 기존 internal Node seam을 사용하는 integration 작성자는 private
source path가 아니라 platform-owned internal seam으로 옮겨야 합니다.
Express와 Fastify도 같은 platform-owned 경계를 사용합니다.
Portable bootstrap은 `@fluojs/runtime`, fetch-style helper는
`@fluojs/runtime/web`에 유지됩니다. Custom HTTP method와 body-bearing `QUERY`
추가는 이전 listener 전용 Node 20/22 floor가 아니라 최종 Node 24 지원 범위를
따릅니다.

## 4. Preserve portable configuration boundaries

이웃 패키지와 맞추기 위해 다음 8개 public root에 `engines.node`를 추가하지 마세요.

`@fluojs/config`, `@fluojs/email`, `@fluojs/i18n`, `@fluojs/platform-bun`,
`@fluojs/platform-cloudflare-workers`, `@fluojs/platform-deno`, `@fluojs/react`,
`@fluojs/runtime`.

Config의 in-memory load, merge, validation, clone, service access는 portable하게
유지됩니다. Portable host에서는 application-owned map을 전달하고 env file을
명시적으로 끄세요.

```ts
import { loadConfig } from '@fluojs/config';

const config = loadConfig({
  envFilePaths: [],
  defaults: { PORT: 3000 },
  processEnv: { PORT: '8080' },
  runtimeOverrides: {},
});
```

Config는 ambient environment variable을 자동으로 읽지 않습니다. 애플리케이션
경계에서 snapshot을 전달하세요. `loadConfig({})`와 `ConfigModule.forRoot()`는
여전히 기본 `<cwd>/.env`를 선택하므로 in-memory 전용 호출이 아닙니다.
명시적 env file, 기본 `.env` loading, `watch: true`는 `>=24.0.0 <27`에서
지원하는 Node 전용 기능입니다.

기존 lazy `process.getBuiltinModule(...)` capability 경계는 host가 Node builtin을
제공하지 못하면 `CONFIG_RUNTIME_UNAVAILABLE`을 발생시킵니다. In-memory option을
사용하거나 Node에서 해당 기능을 실행하세요. 이 guard는 Node version 비교가
아니며 portable root import를 거부하지 않습니다.

## 5. Migrate the Vite and testing toolchain

CLI를 업그레이드해도 기존 생성 프로젝트는 **자동 수정되지 않습니다**.
새 non-Deno generated baseline을 채택하는 프로젝트는 다음을 함께 변경하세요.

```bash
pnpm add -D vite@^8.2.2 vitest@^4.1.11 @vitest/coverage-v8@^4.1.11
```

Workspace는 Vite `8.2.2`와 Vitest `4.1.11`을 검증합니다. Published
`@fluojs/vite` peer는 `vite >=6.2.0`을 유지하며, 이 넓은 peer 계약은 생성
프로젝트가 Vite 6에 남는다는 의미가 아닙니다. `@fluojs/testing`의 required
Vitest peer는 이전 Vitest 3 line에서 `^4.1.11`로 변경됩니다. Mock helper와
`@fluojs/testing/vitest` consumer를 업그레이드하고 consuming workspace에
`@babel/core`를 유지하세요.

1. ESM Vite config의 `build.rollupOptions`를 `build.rolldownOptions`로 옮기고
   애플리케이션의 input, output, external option을 Rolldown 기준으로
   검토하세요. 기존 Node starter의 server target은 `node20`에서 `node24`로,
   `engines.node`는 `>=24.0.0 <27`로, `@types/node`는 `^24.0.0`으로 변경하세요.
2. Application `.ts` decorator를 Rolldown/Oxc보다 먼저 처리하는
   `@fluojs/vite`의 `fluoDecoratorsPlugin()`을 유지하세요.
   `@fluojs/testing/vitest`의 `fluoBabelDecoratorsPlugin()`은 별도 testing
   transform으로 유지합니다.
3. 기존 Babel config에서 생성되었던 `src/**/*.test.ts`의 `ignore` entry를
   제거하세요. Testing plugin이 테스트 내부에 선언한 decorator를 변환할 수
   있어야 합니다. Application plugin은 계속 test를 건너뜁니다.
4. Babel decorator proposal 설정 `version: '2023-11'`과 TypeScript preset을
   유지하세요. `experimentalDecorators`, `emitDecoratorMetadata`를 켜거나
   Babel을 direct Oxc/esbuild decorator processing으로 대체하지 마세요.
   React SSR은 decorator 선언을 `.ts`, JSX를 `.tsx`에 유지합니다.
5. Bun/Deno/Workers의 native build 및 deployment 명령을 보존하세요. Deno
   starter는 이 Vite/Vitest baseline 대신 Deno-native toolchain을 유지합니다.

## 6. Verify the migrated application

Lockfile을 갱신한 뒤 Node 24에서 애플리케이션 install, build, typecheck, test를
수행하세요. 실제 HTTP listener, startup/shutdown, 사용하는 microservice transport를
실행해 확인하세요. Drizzle을 사용한다면 driver별 query와 migration test도
수행합니다. React SSR에서는 첫 페이지, production asset, 경고 없는 hydration을
검증하세요. Decorated class를 포함한 테스트가 Babel testing plugin을 통해
실행되는지 확인하세요.

Peer/engine diagnostic은 숨기지 말고 원인을 해결하세요. 아직 옮길 수 없는
애플리케이션은 기존 release line에 남아야 합니다. 이 program은 새 경계나 Node
floor를 이전 major에 backport하지 않습니다.

## Maintainer release boundary

Version/changelog 생성은 Changesets만 수행합니다. 릴리스 준비 검증 명령은 다음과
같습니다.

```bash
pnpm verify
pnpm verify:docs
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm verify:changeset-release-lane -- --lane=stable --base-ref=main
pnpm changeset status --since=main
```

이번 구현의 major intent와 migration 준비는 승인되었습니다. 실제 공개는
maintainer가 `main`의 `.github/workflows/release.yml`과 검토된 Version Packages
PR을 통해 수행합니다. 로컬 검증 성공은 registry publication이나 문서 deployment
증거가 아닙니다. #3169는 maintainer가 직접 릴리스할 때까지 umbrella로 유지됩니다.

[Node.js Support](../reference/node-support.ko.md),
[Toolchain Contract Matrix](../reference/toolchain-contract-matrix.ko.md),
[Release Governance](../contracts/release-governance.ko.md)를 함께 참고하세요.
