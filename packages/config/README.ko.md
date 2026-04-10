# @fluojs/config

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 설정 로드, 병합, 검증, 타입 안전한 런타임 접근을 제공하는 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/config
```

## 사용 시점

- `.env`와 환경 변수, 런타임 오버라이드를 하나의 설정 스냅샷으로 합쳐야 할 때
- 여러 소스의 우선순위를 명확하게 유지한 채 설정을 병합해야 할 때
- 애플리케이션 시작 전에 설정을 검증해서 잘못된 상태로 부팅되는 일을 막고 싶을 때
- `ConfigService`를 통해 설정 값을 타입 안전하게 읽고 싶을 때

## 빠른 시작

```ts
import { ConfigModule } from '@fluojs/config';
import { Module } from '@fluojs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      defaults: { PORT: '3000' },
      validate: (config) => {
        if (!config.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다');
        return config;
      },
    }),
  ],
})
class AppModule {}
```

등록 후에는 `ConfigService`를 주입해서 값을 읽습니다.

```ts
import { ConfigService } from '@fluojs/config';

class MyService {
  constructor(private readonly config: ConfigService) {
    const port = this.config.get('PORT');
    const dbUrl = this.config.getOrThrow('DATABASE_URL');
  }
}
```

## 주요 기능

### 명확한 소스 우선순위

설정은 `runtimeOverrides` → `process.env` → env 파일 → `defaults` 순서로 병합됩니다.

### 객체 단위 딥 머지

일반 객체는 키 기준으로 깊게 병합되고, 배열과 원시값은 더 높은 우선순위 소스가 전체를 덮어씁니다.

### 부트스트랩 전 검증

`validate` 함수는 모든 소스가 합쳐진 뒤 실행되며, 에러를 던지면 부트스트랩이 즉시 중단됩니다.

## 공개 API 개요

- `ConfigModule`
- `ConfigService`
- `loadConfig(options)`
- `createConfigReloader(options)`

## 관련 패키지

- `@fluojs/runtime`: 부트스트랩 중 `loadConfig()`를 호출합니다.
- `@fluojs/validation`: `validate` 함수 안에서 스키마 기반 검증을 조합할 수 있습니다.

## 예제 소스

- `packages/config/src/load.ts`
- `packages/config/src/service.ts`
- `packages/config/src/load.test.ts`
