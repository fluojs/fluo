# Package Manifest Rules

<p><strong><kbd>한국어</kbd></strong> <a href="./manifest-decision.md"><kbd>English</kbd></a></p>

이 문서는 공개 `@fluojs/*` 워크스페이스 패키지에 대한 현재 패키지 매니페스트 계약을 정의합니다.

## Required Fields

| Field | Rule | Repo grounding |
| --- | --- | --- |
| `name` | 공개 워크스페이스 패키지는 보통 `@fluojs/*` 스코프 아래의 실제 배포 이름을 MUST로 사용합니다. | `packages/*/package.json` 아래의 현재 공개 매니페스트는 `@fluojs/core`, `@fluojs/http`, `@fluojs/cli` 같은 스코프 이름을 사용합니다. |
| `description` | 패키지 표면을 한 문장으로 설명하는 값이 MUST로 있어야 합니다. | `packages/core/package.json`, `packages/microservices/package.json` 같은 현재 공개 매니페스트에 존재합니다. |
| `version` | 모든 패키지 매니페스트에 MUST로 존재해야 합니다. | 현재 워크스페이스 패키지 전반에 존재합니다. |
| `private` | intended publish surface에 있는 패키지는 `false`여야 합니다. | 현재 공개 패키지 매니페스트는 `"private": false`를 사용합니다. |
| `license` | MUST로 선언되어야 합니다. | 현재 공개 패키지 매니페스트는 `MIT`를 사용합니다. |
| `repository` | 모노레포 URL과 패키지 디렉터리 경로를 MUST로 포함해야 합니다. | 현재 매니페스트는 `repository.url`에 `https://github.com/fluojs/fluo.git`, `repository.directory`에 패키지 경로를 넣습니다. |
| `publishConfig.access` | 공개 배포 대상 패키지는 `public`이어야 합니다. | release governance에서 요구하고, 현재 공개 매니페스트에도 존재합니다. |
| `type` | `module`이어야 합니다. | 현재 공개 패키지 매니페스트는 `"type": "module"`을 사용합니다. |
| `exports` | 공개 엔트리포인트를 MUST로 선언해야 합니다. | 현재 공개 패키지 매니페스트 전부가 `exports` 맵을 정의합니다. |
| `main` | dist 빌드된 JavaScript 루트 엔트리포인트를 가리켜야 합니다. | 현재 루트 엔트리포인트는 `./dist/index.js` 같은 값을 사용합니다. |
| `types` | dist 빌드된 declaration 루트 엔트리포인트를 가리켜야 합니다. | 현재 루트 타입 엔트리포인트는 `./dist/index.d.ts` 같은 값을 사용합니다. |
| `files` | 배포 가능한 출력만 whitelist 해야 합니다. | 현재 공개 패키지 매니페스트는 `dist`를 배포하며, `@fluojs/cli`는 `bin`도 포함합니다. |
| `scripts` | 패키지 로컬 `build`, `typecheck`, `test` 명령을 MUST로 포함해야 합니다. | 현재 공개 패키지 매니페스트는 공통적으로 `prebuild` 정리와 함께 이 명령들을 정의합니다. |

- `bin`은 실행 파일을 배포하는 CLI 성격 패키지에서만 필요합니다. `@fluojs/cli`는 `./bin/fluo.mjs`를 통해 `fluo`를 노출합니다.
- `engines.node`는 많은 Node 기반 패키지에서 사용되지만, 현재 공개 패키지 매니페스트 전체에 공통인 필드는 아닙니다.

## exports Map Rules

| Rule | Required shape | Repo grounding |
| --- | --- | --- |
| Root export | `"."`를 MUST로 선언하고 `types`와 `import` 타깃을 함께 가져야 합니다. | `packages/core/package.json`, `packages/http/package.json`, `packages/cli/package.json`이 이 형태를 따릅니다. |
| Code subpath export | 패키지가 별도 JavaScript 표면을 의도적으로 노출할 때 추가 subpath를 MAY로 선언할 수 있습니다. 각 code subpath는 dist 빌드된 `.js`와 `.d.ts`를 가리켜야 합니다. | `@fluojs/email`은 `./queue`, `./node`를 노출하고, `@fluojs/microservices`는 `./tcp`, `./grpc`, `./rabbitmq` 같은 전송 subpath를 노출합니다. |
| Asset-only subpath export | 패키지 README가 해당 subpath를 asset entrypoint로 문서화하고 TypeScript import 해석이 그 subpath 계약에 포함되지 않을 때, `./dist/` 아래 단일 정적 asset을 MAY로 노출할 수 있습니다. | `@fluojs/studio/viewer`는 호출자가 `require.resolve('@fluojs/studio/viewer')`로 패키징된 브라우저 viewer를 찾을 수 있도록 의도적으로 `./dist/index.html`로 해석됩니다. |
| Dist-only targets | 배포 런타임 코드, declaration, 문서화된 정적 asset entrypoint는 모두 `./dist/` 아래 파일을 가리켜야 합니다. | 현재 공개 패키지는 exports를 `./dist/...` 출력으로 매핑합니다. |
| Root manifest alignment | `main`과 `types`는 루트 `exports["."]` 타깃과 맞아야 합니다. | 현재 공개 매니페스트는 루트 export가 같은 파일을 가리킬 때 `main: ./dist/index.js`, `types: ./dist/index.d.ts`를 사용합니다. |
| Subpath TypeScript resolution | 공개 subpath가 루트 `types`만으로 충분하지 않을 때 `typesVersions`를 SHOULD로 추가합니다. | `@fluojs/email`, `@fluojs/runtime`, `@fluojs/websockets`는 공개 subpath를 위해 `typesVersions`를 정의합니다. |
| Internal surface control | 문서화되지 않았거나 우발적인 소스 경로를 매니페스트로 노출하면 안 됩니다. | 현재 패키지는 `.` 또는 명시적 named subpath 같은 공개 barrel만 노출하고, raw `src/*` 경로는 노출하지 않습니다. |

## Constraints

- intended publish surface에 있는 공개 패키지 매니페스트는 `publishConfig.access: public`을 유지해야 하며, `docs/contracts/release-governance.md`와 `docs/reference/package-surface.md` 양쪽에 계속 등재되어야 합니다.
- `dependencies`, `optionalDependencies`, `peerDependencies`, `devDependencies` 안의 내부 `@fluojs/*` 의존성은 `workspace:^`를 MUST로 사용해야 합니다.
- 매니페스트는 소스 트리가 아니라 배포 표면을 설명해야 합니다. 배포 파일 경로는 `src` 입력이 아니라 `dist` 출력을 가리킵니다.
- 선택적 런타임 통합은 루트 패키지 계약을 약화하지 않도록 peer dependency나 명시적 subpath로 유지하는 편이 맞습니다. 현재 예시는 `@fluojs/microservices`의 optional peer와 Node 전용 `@fluojs/email/node` subpath입니다.
- 루트 패키지가 이식성을 유지해야 할 때는 런타임 전용 또는 통합 전용 표면을 루트 export에 넣지 않는 편이 맞습니다. 현재 예시는 `@fluojs/email/node`, `@fluojs/email/queue`, `@fluojs/microservices`의 transport subpath입니다.
- 새 공개 export는 public-export TSDoc baseline과 문서화된 package surface에 맞아야 합니다.
- Asset-only subpath는 패키지 README에 명시적으로 문서화되어야 하며, JavaScript와 declaration target이 필요한 code subpath를 대체하면 안 됩니다.
