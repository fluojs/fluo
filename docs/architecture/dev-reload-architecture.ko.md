# 개발 리로드 아키텍처

<p><a href="./dev-reload-architecture.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 리로드 전략

| 변경 종류 | 이 저장소에서 활성화된 메커니즘 | 런타임 효과 | 근거 소스 |
| --- | --- | --- | --- |
| 생성된 Node 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, `--raw-watch` 또는 `FLUO_DEV_RAW_WATCH=1`로 native Node watch mode를 선택하지 않는 한 fluo가 소유한 restart runner를 통과합니다. 공식 Node React/Vite starter는 변환된 client graph의 `.tsx`/CSS 갱신을 Vite에 위임합니다. | 다른 소스/config는 child를 재시작합니다. 호환 가능한 React 수정은 Fast Refresh, CSS는 app origin의 HMR을 사용합니다. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| 생성된 Bun 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, Bun native watch loop(`bun --watch src/main.ts`)를 기본값으로 사용합니다. `fluo dev --runner fluo`는 fluo 소유 restart runner를 복원합니다. | Bun 런타임이 기본 watch/reload를 소유하므로 Node-supervised dev process를 줄이고, 명시적 fluo restart fallback은 유지합니다. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| 생성된 Deno 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, Deno native watch loop(`deno run --watch --allow-env --allow-net --allow-read=.env src/main.ts`)를 기본값으로 사용합니다. Broad env access는 generated `Deno.env.toObject()` snapshot이 소비하는 모든 application-owned key를 보존하며 signal listener에는 별도의 Deno permission이 필요하지 않습니다. `fluo dev --runner fluo`는 같은 env, network 및 제한된 .env read permission을 사용하는 fluo 소유 restart runner를 복원합니다. | Deno 런타임이 기본 watch/reload를 소유하므로 Node-supervised dev process를 줄이고, 명시적 fluo restart fallback은 유지합니다. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| 생성된 Workers 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, Wrangler native dev loop(`wrangler dev --show-interactive-dev-session=false`)를 기본값으로 사용합니다. `fluo dev --runner fluo`는 fluo 소유 restart runner를 복원합니다. | Wrangler가 기본 watch/reload를 소유하므로 fluo Node supervisor boundary를 줄이고, 명시적 fluo restart fallback은 유지합니다. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| config reload가 활성화된 설정 파일 변경 | `ConfigModule.forRoot({ watch: true, ... })`가 하나의 injectable `CONFIG_RELOADER`를 소유하고 `onApplicationBootstrap()`에서 watcher를 활성화합니다. `ConfigReloadManager.create(...)`는 별도의 standalone manager입니다. watcher는 최종 순서형 env-file content가 마지막으로 commit된 watch baseline과 같으면 reload를 건너뜁니다. | content가 바뀌고 검증이 성공하면 기존 `ConfigService` 스냅샷이 프로세스 내부에서 교체됩니다. | `packages/config/src/load.ts`, `packages/config/src/module.ts` |
| 수동 config refresh | `ConfigReloader.reload()`는 파일 시스템 watch 없이 같은 reload 경로를 실행합니다. | 호출자는 새로 검증된 스냅샷을 명시적으로 요청할 수 있습니다. | `packages/config/src/load.ts:770-785` |

이 저장소는 일반 code의 호스트 소유 재시작, 공식 Node React/Vite starter의 범위가 정해진 HMR, config 입력의 검증된 스냅샷 교체를 구분합니다.

**공식 Node React starter**에서 Vite가 browser 소유 `.tsx`와 CSS를 변환하고
Fastify server의 WebSocket으로 Fast Refresh/CSS 갱신을 전달합니다. Hydration 전에
refresh preamble을 제공합니다. Supervisor는 Vite가 변환한 client graph를 제외하고,
HTTP page handler는 DTO validation 후 최신 SSR module을 로드합니다. 호환되지 않는
React export/hook 변경은 remount/reload로 local state를 잃을 수 있습니다.
Server-only, graph 밖, 감시 대상 Vite/source config 수정은 계속 child를 재시작합니다.
macOS/Windows의 native Node raw watch는 process-restart escape hatch이며 Linux에서는
fluo runner를 계속 사용합니다. Bun, Deno, Workers는 기존 native-watch 선택을 유지하고
React Fast Refresh 지원 범위가 아닙니다. 별도로
`ConfigModule.forRoot({ watch: true })`는 검증된 env-file snapshot을 in-process에서
교체할 수 있고, 잘못된 업데이트에서는 마지막 정상 snapshot을 유지합니다. CLI watcher가
감지한 config/build code 수정은 application module hot swap 대신 child를 재시작합니다.
[React 제품 계약](../contracts/react-fullstack-product.ko.md)은 범위가 정해진 React/CSS
갱신을 #3876에, 일반 server/shared/config restart·drain·복구 정책을 #3877에
할당합니다. 모든 module hot swap이나 모든 state 보존은 약속하지 않습니다.

## 제약 사항

| 제약 | 사실 문장 | 근거 소스 |
| --- | --- | --- |
| 범위가 정해진 HMR 계약 | 생성된 Node React/Vite client graph만 Fast Refresh/CSS HMR을 사용합니다. 다른 Node source와 native-watch escape hatch는 process restart를 유지하며 일반 runtime TypeScript hot swap은 제공하지 않습니다. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| config reload의 watch 범위 | `startReloaderWatcher(...)`는 env file의 존재 여부와 관계없이 parent directory를 감시하며, env file 존재 여부로 file과 directory watch target 중 하나를 선택하지 않습니다. `watch`가 꺼져 있거나 env-file path가 해석되지 않거나 parent directory가 없으면 watcher를 만들지 않습니다. | `packages/config/src/load.ts:663-713` |
| config watch content dedupe | Watch로 트리거된 reload는 적용 전에 env file content를 마지막으로 commit된 watch baseline과 비교하므로, 내용이 바뀌지 않은 저장과 변경 후 되돌림 burst는 reload listener를 호출하지 않습니다. | `packages/config/src/load.ts:688-711`, `packages/config/src/load.test.ts:893-930` |
| 등록 시점 option snapshot | `ConfigModule.forRoot(...)`는 module registration 중 공유 service, reloader, 순서형 env-file options를 동기적으로 캡처하고, `ConfigReloadManager.create(...)`는 standalone options를 생성 시 캡처합니다. Config dictionary, `processEnv`, Standard Schema descriptor는 bootstrap이나 이후 reload가 caller mutation을 관찰하기 전에 분리되며, callable value는 그 경계에서 캡처한 reference를 유지합니다. | `packages/config/src/options.ts`, `packages/config/src/module.ts`, `packages/config/src/module.test.ts`, `packages/config/src/reload-module.test.ts` |
| 검증 장벽 | 감시 중인 config 업데이트가 검증에 실패하면 reload error listener가 호출되고 현재 스냅샷은 바뀌지 않습니다. | `packages/config/src/load.ts:608-626`, `packages/config/src/load.ts:688-711`, `packages/config/src/load.test.ts:795-846` |
| 마지막 정상 스냅샷 보장 | watch mode 테스트는 잘못된 업데이트 뒤에도 `PORT=4000`을 유지하고, 유효한 교체가 도착한 뒤에만 `PORT=4300`으로 전진합니다. | `packages/config/src/load.test.ts:795-846` |
| 활성화 시점 | `ConfigModule`이 export한 `CONFIG_RELOADER`는 첫 수동 `reload()`에서 reloader를 지연 생성합니다. `onApplicationBootstrap()`은 `options.watch`가 참이고 manager가 종료되지 않았을 때만 reloader를 즉시 생성합니다. | `packages/config/src/module.ts` |
| listener 실패 시 롤백 | 스냅샷 교체 중 reload listener가 예외를 던지면 `replaceConfigServiceSnapshotUnchecked(...)`이 이전 스냅샷을 복구합니다. | `packages/config/src/module.ts`, `packages/config/src/reload-module.test.ts` |
| 종료 시 정리 | `ConfigReloadManager.onModuleDestroy()`는 종료 과정에서 watcher를 닫고 listener를 비웁니다. | `packages/config/src/module.ts` |
| 종료의 최종성 | manager 종료는 최종 상태입니다. `close()` 또는 `onModuleDestroy()` 이후 `reload()`, `subscribe()`, `subscribeError()`는 `InvariantError`를 던지고, `onApplicationBootstrap()`은 no-op이 되며, 대체 reloader나 watcher는 생성되지 않습니다. | `packages/config/src/module.ts`, `packages/config/src/reload-module.test.ts` |
| 운영 환경 경계 | 확인한 저장소 소스는 config reload를 가능한 메커니즘으로 문서화하지만, 운영 환경에서의 자동 활성화를 선언하지는 않습니다. watch 활성화는 애플리케이션 경계에서의 명시적 `watch: true` 선택에 달려 있습니다. | `packages/config/src/module.ts`, `packages/config/src/load.ts` |

이 아키텍처는 일반 application code reload를 runtime 계약 바깥에 둡니다. 생성된 Node React 개발 host가 범위가 정해진 Vite 통합을 소유하며 runtime 관리 스냅샷 reload는 `@fluojs/config`의 검증된 설정으로 제한됩니다.

## CLI 라이프사이클 출력 계약

- 기본 lifecycle 출력은 fluo lifecycle UI 없이 child `stdout`/`stderr`를 전달합니다. 앱 로그 전용 출력은 fluo runner가 process boundary를 소유하는 경로에 적용됩니다.
- fluo lifecycle UI와 `app │` prefix 출력은 `--reporter pretty`에서만 opt-in으로 노출됩니다.
- fluo 소유 runner 경로에서 런타임/도구 watcher 원본 출력은 `--verbose` 또는 `FLUO_VERBOSE=1`로 opt-in할 때 노출됩니다. runtime-native Bun, Deno, Workers watch loop는 자체 도구 출력을 기본으로 표시할 수 있습니다.
- Node restart notice는 기본으로 숨겨지고, opt-in 모드에서만 출력됩니다.
- Node dev 명령은 기본적으로 fluo 소유 restart boundary를 사용합니다. Bun, Deno, Workers dev 명령은 runtime-native watch loop를 기본값으로 사용하며, 앱 로그 전용 출력, 색상 보존, 재시작 clear/header 동작을 fluo restart runner에서 받아야 할 때는 `--runner fluo`를 사용합니다.

## 관련 문서

- [패키지 아키텍처 참조](./architecture-overview.ko.md)
- [구성 및 환경](./config-and-environments.ko.md)
- [라이프사이클 및 종료 보장](./lifecycle-and-shutdown.ko.md)
- [CLI README](../../packages/cli/README.ko.md)
