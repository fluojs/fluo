# @FieldResolver RFC

<p><a href="./field-resolver-rfc.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

상태: 구현됨 (RFC 최소 범위)

이 문서는 `@fluojs/graphql`의 `@FieldResolver` 최소 구현 API와 통합 계약을 정의합니다.

## 목표

- 필드 레벨 resolver decorator 형태 정의
- DTO input, `parent/source`, `context` 전달 규칙 정의
- field resolver discovery/registration 규칙 정의
- object type에 field resolver를 붙이는 schema 규칙 정의

## 비목표

- 자동 batching/cache 정책 프레임워크
- interface 레벨 polymorphic resolver 확장
- Schema-first resolver-map attachment

## 제안 API 형태

```ts
@Resolver('User')
class UserFieldResolver {
  @FieldResolver('displayName')
  @Parent()
  @Context()
  displayName(user: UserEntity, ctx: GraphQLContext): string {
    return `${user.firstName} ${user.lastName}`;
  }
}
```

### Decorator

- `@FieldResolver(fieldNameOrOptions?)`
  - `fieldName?: string`
  - `input?: Function`: 기존 `@Arg(...)` DTO materialization 및 validation pipeline을 재사용
  - `argTypes?: Record<string, GraphqlArgType>`: 명시적 scalar 및 list argument type 지원
  - `type?: GraphqlRootOutputType` (scalar/object/union/list wrapper)
  - `nullable?: boolean` (미래 호환용 표면만 정의)
- `@Args()`
  - materialize 및 validation된 input DTO를 기본 parameter index `0`에 바인딩하는 표준 method decorator
  - 명시적인 zero-based parameter index 허용
- `@Parent()`
  - 기본적으로 parent object(`source`)를 parameter index `0`에 바인딩하는 표준 method decorator
  - 명시적인 zero-based parameter index 허용
- `@Context()`
  - 기본적으로 GraphQL context(`GraphQLContext`)를 parameter index `1`에 바인딩하는 표준 method decorator
  - 명시적인 zero-based parameter index 허용

TC39 표준 데코레이터는 parameter decorator를 정의하지 않습니다. 따라서 구현된 계약은 네 API를 모두 표준 method decorator로 유지하고, legacy parameter-decorator 문법 대신 positional binding index를 명시적으로 기록합니다.

## Discovery 규칙

1. `@Resolver('TypeName')`를 object type 소유 연결점으로 유지합니다.
2. `@FieldResolver(...)` 메서드는 root operation과 분리 수집합니다.
3. 충돌 규칙:
   - 같은 `TypeName.fieldName` 중복 등록은 에러 처리
   - root operation 이름(`Query/Mutation/Subscription`)과 field resolver 이름 공간은 분리
4. scope 의미론은 기존 provider scope(singleton/request/transient)를 그대로 따릅니다.
5. `@FieldResolver({ input })`에는 `@Args()`가 필요하고, `@Args()`에는 `input`이 필요합니다.
6. `@Args()`, `@Parent()`, `@Context()`는 같은 parameter index를 공유할 수 없으며 중복 index는 decorator evaluation 중 실패합니다.

## Schema 연결 규칙

- Field resolver 메서드는 `@Resolver(typeName)` 대상 object type에 연결됩니다.
- 대상 object type은 code-first root operation output에서 도달 가능해야 합니다.
- 대상 object type이 field를 이미 선언하면 resolver function으로 field config를 확장하며, `type`이 없으면 기존 type을 유지합니다.
- 대상 object type이 field를 선언하지 않았다면 `@FieldResolver({ type })`이 field를 추가합니다.
- 반환 타입 규칙은 root operation과 동일:
  - scalar literal, `GraphQLObjectType`, `GraphQLUnionType`, `listOf(...)`

## Parent/Source 전달 계약

- `@Parent()`는 GraphQL `source` 인자에 매핑됩니다.
- Resolver signature는 `@Parent(...)`, `@Context(...)` method decorator가 기록한 index에서 parent와 context를 받습니다.
- `@Args()`는 기존 `@Arg(...)` mapping 및 validation pipeline으로 GraphQL field argument에서 materialize한 DTO를 받습니다.
- Field resolver input validation은 root operation과 동일한 GraphQL `BAD_USER_INPUT` error shape을 반환합니다.
- Field resolver input은 parent resolver와 같은 HTTP 또는 subscription operation container에서 실행됩니다.

## 구현된 통합

1. Metadata 계층
   - Field resolver metadata symbol 및 positional parameter-binding metadata
2. Discovery 계층
   - Field handler를 root operation과 분리 수집하고 `typeName`으로 그룹화
3. Schema 빌더
   - Code-first schema 조립 중 일치하는 object type에 field resolver config 병합
4. Invocation 파이프라인
   - 기존 singleton/request/transient scope에 맞는 provider instance 해석 후 DTO input, parent, context argument 매핑 호출
5. Validation/Error
   - 중복 `TypeName.fieldName`, 도달 불가능한 target type, 누락된 field type, root operation의 잘못된 binding, 누락된 input binding, 중복 parameter index, DTO validation failure를 명시적으로 거부

## 호환성/마이그레이션

- 구현은 additive change입니다.
- 기존 root operation resolver 동작은 유지됩니다.
- 원래 draft의 parameter-decorator 문법은 index 기본값을 갖는 TC39 표준 method decorator로 대체됩니다.

## 열린 질문

- 예약된 `nullable` surface의 실제 활성화
- Schema-first resolver-map attachment의 package 소유 여부
