# fluo new 지원 매트릭스

<p><a href="./fluo-new-support-matrix.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 페이지는 현재 `fluo new`가 실제로 스캐폴딩하는 범위와, fluo가 다른 문서에서 설명하는 더 넓은 런타임/어댑터 생태계를 구분하기 위한 기준 문서입니다.

## 현재 스타터 범위 vs 더 넓은 생태계 지원

| 표면 | 현재 상태 | `fluo new`에 실제로 연결된 항목 | 다음 단계 |
| --- | --- | --- | --- |
| **애플리케이션 스타터** | **지금 스캐폴딩됨** | `--shape application --transport http --runtime node --platform fastify|express|nodejs`로 생성되는 Node.js + HTTP, `--runtime bun --platform bun`으로 생성되는 Bun, `--runtime deno --platform deno`로 생성되는 Deno, `--runtime cloudflare-workers --platform cloudflare-workers`로 생성되는 Cloudflare Workers | `--platform`을 생략하면 Fastify가 기본 스타터 기준선으로 유지되며, Express, raw Node.js, Bun, Deno, Cloudflare Workers가 모두 공식 애플리케이션 스타터가 되었습니다. |
| **마이크로서비스 스타터** | **지금 스캐폴딩됨** | `--shape microservice --transport tcp --runtime node --platform none`으로 생성되는 Node.js + 비HTTP 플랫폼 + TCP, `--transport redis-streams`로 생성되는 Redis Streams, `--transport nats`로 생성되는 NATS, `--transport kafka`로 생성되는 Kafka, `--transport rabbitmq`로 생성되는 RabbitMQ, `--transport mqtt`로 생성되는 MQTT, `--transport grpc`로 생성되는 gRPC | `--transport`를 생략하면 TCP가 가장 단순한 기본 스타터 기준선으로 유지됩니다. Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC는 이제 transport별 dependency/env/proto 구성을 갖춘 runnable starter로 제공되며, `@fluojs/redis` 같은 더 넓은 메시징 패키지는 스캐폴딩 이후에 선택하는 생태계 옵션으로 남고 추가 `fluo new --transport` 값은 아닙니다. |
| **mixed 스타터** | **지금 스캐폴딩됨** | `--shape mixed --transport tcp --runtime node --platform fastify`로 생성되는 Node.js + Fastify HTTP 앱 + 연결된 TCP microservice | 이것이 현재 공개된 유일한 혼합 스타터 변형입니다. |
| **더 넓은 어댑터/런타임 생태계** | **일부는 스캐폴딩됨, 일부는 문서 전용** | `@fluojs/platform-fastify`, `@fluojs/platform-express`, `@fluojs/platform-nodejs`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers`는 모두 이제 공식 애플리케이션 스타터 경로를 가집니다. 그 외 런타임/패키지 조합은 여전히 더 넓은 생태계 문서 범주에 남습니다. | 남아 있는 문서 전용 어댑터는 스캐폴딩 이후나 수동 구성에서 아래 런타임/패키지 문서를 사용해 채택하세요. |

## 다른 문서를 읽는 방법

- `fluo new` 문서는 스타터 계약으로 읽고, 문서화된 모든 어댑터가 이미 스타터 프리셋을 가진다고 해석하지 마세요.
- 런타임/패키지 참조 문서는 현재 스타터 매트릭스 밖에서 채택 가능한 어댑터, 플랫폼, 배포 대상을 설명하는 더 넓은 생태계 지도입니다.
- 어떤 페이지가 Node.js HTTP 플랫폼(Fastify, Express, raw Node.js), Bun, Deno, Cloudflare Workers를 언급할 때 명시적인 `fluo new --shape application --transport http --runtime ... --platform ...` 명령이 함께 있다면 그것이 실행 가능한 스타터 계약입니다. 마이크로서비스의 경우 문서화된 `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, `grpc` 명령 변형을 runnable starter 계약으로 읽으세요. 그 밖의 어댑터/패키지 언급은 여전히 더 넓은 패키지 생태계를 설명합니다.

## 기준 출처

- `packages/cli/src/new/resolver.ts`는 현재 스캐폴딩되는 `fluo new` 매트릭스의 기준 소스입니다.
- [Package Surface](./package-surface.ko.md#canonical-runtime-package-matrix)는 더 넓은 런타임/패키지 생태계의 기준 소스입니다.
- [Bootstrap Paths](../getting-started/bootstrap-paths.ko.md), [Package Chooser](./package-chooser.ko.md), [NestJS에서 마이그레이션하기](../getting-started/migrate-from-nestjs.ko.md)는 제공 중인 스타터 매트릭스와 더 넓은 패키지 생태계를 구분해야 할 때 이 문서로 연결되어야 합니다.
