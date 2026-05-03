# 개발 리로드 아키텍처

<p><a href="./dev-reload-architecture.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 리로드 전략

| 변경 종류 | 이 저장소에서 활성화된 메커니즘 | 런타임 효과 | 근거 소스 |
| --- | --- | --- | --- |
| 생성된 Node 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, 이 명령이 `node --env-file=.env --watch --watch-preserve-output --import tsx src/main.ts`를 실행합니다. | 호스트 프로세스는 Node watch mode에 의해 재시작됩니다. fluo는 인프로세스 코드 교체 대신 새 부트스트랩을 받습니다. | `packages/cli/src/commands/scripts.ts` |
| 생성된 Bun 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, 이 명령이 `bun --watch src/main.ts`를 실행합니다. | Bun watch mode는 애플리케이션 진입점을 기준으로 실행을 다시 시작합니다. | `packages/cli/src/commands/scripts.ts` |
| 생성된 Deno 스타터의 소스 코드 변경 | 기본 생성 `dev` 스크립트는 `fluo dev`이며, 이 명령이 `deno run --allow-env --allow-net --watch src/main.ts`를 실행합니다. | Deno watch mode는 기존 프로세스 상태를 재사용하지 않고 진입점을 다시 실행합니다. | `packages/cli/src/commands/scripts.ts` |
| config reload가 활성화된 설정 파일 변경 | `createConfigReloader(...)`는 `watch: true`일 때 설정된 env 파일을 감시할 수 있고, `ConfigReloadModule`은 `onApplicationBootstrap()`에서 그 watcher를 활성화합니다. | 검증이 성공하면 `ConfigService` 스냅샷이 프로세스 내부에서 교체됩니다. | `packages/config/src/load.ts:186-268`, `packages/config/src/reload-module.ts:80-121` |
| 수동 config refresh | `ConfigReloader.reload()`는 파일 시스템 watch 없이 같은 reload 경로를 실행합니다. | 호출자는 새로 검증된 스냅샷을 명시적으로 요청할 수 있습니다. | `packages/config/src/load.ts:251-267` |

이 저장소가 노출하는 리로드 계열은 둘뿐입니다. 코드에 대해서는 호스트가 소유하는 재시작 흐름, 설정 입력에 대해서는 config 스냅샷 교체 흐름입니다.

## 제약 사항

| 제약 | 사실 문장 | 근거 소스 |
| --- | --- | --- |
| 문서화된 HMR 계약 부재 | 현재 배포된 lifecycle runner는 런타임별 watch 기능에 의존합니다. 확인한 소스 중 TypeScript 소스 파일에 대한 부분 모듈 교체를 수행하는 공개 런타임 계약은 없습니다. | `packages/cli/src/commands/scripts.ts` |
| config reload의 watch 범위 | `startReloaderWatcher(...)`는 정규화된 env 파일 경로만 감시하며, `watch`가 꺼져 있거나 env 파일이 없으면 watcher를 만들지 않습니다. | `packages/config/src/load.ts:186-204` |
| 검증 장벽 | 감시 중인 config 업데이트가 검증에 실패하면 reload error listener가 호출되고 현재 스냅샷은 바뀌지 않습니다. | `packages/config/src/load.ts:197-202`, `packages/config/src/load.test.ts:321-379` |
| 마지막 정상 스냅샷 보장 | watch mode 테스트는 잘못된 업데이트 뒤에도 `PORT=4000`을 유지하고, 유효한 교체가 도착한 뒤에만 `PORT=4300`으로 전진합니다. | `packages/config/src/load.test.ts:365-373` |
| 활성화 시점 | `ConfigReloadManager`는 reloader를 지연 생성하며, `options.watch`가 참일 때만 `onApplicationBootstrap()`에서 이를 생성합니다. | `packages/config/src/reload-module.ts:80-97` |
| listener 실패 시 롤백 | 스냅샷 교체 중 reload listener가 예외를 던지면 `replaceConfigServiceSnapshot(...)`은 이전 스냅샷으로 롤백됩니다. | `packages/config/src/reload-module.ts:99-117` |
| 종료 시 정리 | `ConfigReloadManager.onModuleDestroy()`는 종료 과정에서 watcher를 닫고 listener를 비웁니다. | `packages/config/src/reload-module.ts:88-90` |
| 운영 환경 경계 | 확인한 저장소 소스는 config reload를 가능한 메커니즘으로 문서화하지만, 운영 환경에서의 자동 활성화를 선언하지는 않습니다. watch 활성화는 애플리케이션 경계에서의 명시적 `watch: true` 선택에 달려 있습니다. | `packages/config/src/reload-module.ts:80-86`, `packages/config/src/load.ts:193-204` |

이 아키텍처는 애플리케이션 코드 리로드를 런타임 계약 바깥에 둡니다. 런타임이 직접 관리하는 리로드는 `@fluojs/config`를 통과하는 검증된 설정 스냅샷으로 제한됩니다.

## 관련 문서

- [패키지 아키텍처 참조](./architecture-overview.ko.md)
- [구성 및 환경](./config-and-environments.ko.md)
- [라이프사이클 및 종료 보장](./lifecycle-and-shutdown.ko.md)
- [CLI README](../../packages/cli/README.ko.md)
