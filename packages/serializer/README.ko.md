# @konekti/serializer

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti용 응답 직렬화(serialization) 데코레이터 및 인터셉터입니다.

이 패키지는 NestJS 클래스 직렬화와 유사한 클래스 기반 응답 셰이핑(shaping)을 제공합니다.

- `@Exclude()`는 직렬화된 출력에서 필드를 제거합니다.
- `@Expose()`는 포함할 필드를 표시하며, 클래스 레벨의 `excludeExtraneous` 모드를 지원합니다.
- `@Transform(fn)`은 재귀 직렬화 전에 필드 값을 변환합니다.
- `SerializerInterceptor`는 핸들러 응답에 `serialize()`를 자동으로 적용합니다.

## 설치

```bash
pnpm add @konekti/serializer
```

## 빠른 시작

```typescript
import { Controller, Get, UseInterceptors } from '@konekti/http';
import { Exclude, Expose, SerializerInterceptor } from '@konekti/serializer';

@Expose({ excludeExtraneous: true })
class UserView {
  @Expose()
  id: string;

  @Exclude()
  password: string;

  constructor(id: string, password: string) {
    this.id = id;
    this.password = password;
  }
}

@Controller('/users')
class UsersController {
  @Get('/')
  @UseInterceptors(SerializerInterceptor)
  listUsers() {
    return [new UserView('u-1', 'secret')];
  }
}
```

## 전역 등록

부트스트랩 시 시리얼라이저를 전역으로 등록합니다.

```typescript
import { bootstrapApplication } from '@konekti/runtime';
import { SerializerInterceptor } from '@konekti/serializer';

await bootstrapApplication({
  rootModule: AppModule,
  interceptors: [SerializerInterceptor],
});
```

## API

- `Exclude(): FieldDecorator` — 직렬화된 출력에서 필드를 제거합니다.
- `Expose(options?): ClassDecorator | FieldDecorator` — 포함할 필드를 표시하며 클래스 레벨의 `excludeExtraneous` 모드를 지원합니다.
- `Transform(fn): FieldDecorator` — 재귀 직렬화 전에 필드 값을 변환합니다.
- `serialize(value: unknown): unknown` — 수동 직렬화 헬퍼입니다.
- `class SerializerInterceptor implements Interceptor` — 응답 자동 직렬화를 위한 인터셉터입니다.

## 직렬화 규약 (Contract)

- 출력 결과가 JSON 안전성을 유지하도록 순환 참조는 순환 경계에서 `undefined`로 절단됩니다.
- 공유 참조는 보존됩니다. 이미 직렬화된 객체를 다시 방문하면 동일한 직렬화 노드를 반환합니다.
- 일반 객체의 열거 가능한 심볼 키(symbol-keyed) 속성은 문자열 키와 함께 직렬화됩니다.
