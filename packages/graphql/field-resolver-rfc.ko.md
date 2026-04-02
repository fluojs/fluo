# @FieldResolver RFC (설계 전용)

상태: Draft (Phase 4)

이 문서는 `@konekti/graphql`의 `@FieldResolver` API와 통합 계획을 정의합니다.
이 단계에서는 런타임 구현을 포함하지 않습니다.

## 목표

- 필드 레벨 resolver decorator 형태 정의
- `parent/source` 및 `context` 전달 규칙 정의
- field resolver discovery/registration 규칙 정의
- object type에 field resolver를 붙이는 schema 규칙 정의

## 비목표 (이 RFC 단계)

- 런타임 실행 구현
- 자동 batching/cache 정책 프레임워크
- interface 레벨 polymorphic resolver 확장

## 제안 API 형태

```ts
@Resolver('User')
class UserFieldResolver {
  @FieldResolver('displayName')
  displayName(@Parent() user: UserEntity, @Context() ctx: GraphQLContext): string {
    return `${user.firstName} ${user.lastName}`;
  }
}
```

### Decorator

- `@FieldResolver(fieldNameOrOptions?)`
  - `fieldName?: string`
  - `type?: GraphqlRootOutputType` (scalar/object/union/list wrapper)
  - `nullable?: boolean` (미래 호환용 표면만 정의)
- `@Parent()`
  - object field 실행 시 parent object(`source`) 바인딩
- `@Context()`
  - GraphQL context(`GraphQLContext`) 바인딩

## Discovery 규칙

1. `@Resolver('TypeName')`를 object type 소유 연결점으로 유지합니다.
2. `@FieldResolver(...)` 메서드는 root operation과 분리 수집합니다.
3. 충돌 규칙:
   - 같은 `TypeName.fieldName` 중복 등록은 에러 처리
   - root operation 이름(`Query/Mutation/Subscription`)과 field resolver 이름 공간은 분리
4. scope 의미론은 기존 provider scope(singleton/request/transient)를 그대로 따릅니다.

## Schema 연결 규칙

- Field resolver 메서드는 `@Resolver(typeName)` 대상 object type에 연결됩니다.
- 대상 object type이 named GraphQL object type으로 제공되면 해당 field config에 resolver를 확장합니다.
- 반환 타입 규칙은 root operation과 동일:
  - scalar literal, `GraphQLObjectType`, `GraphQLUnionType`, `listOf(...)`

## Parent/Source 전달 계약

- `@Parent()`는 GraphQL `source` 인자에 매핑됩니다.
- decorator 기반으로 `(parent, input, context)` 시그니처를 구성할 수 있습니다.
  - `@Parent()`, `@Context()`를 명시적 파라미터 바인딩 decorator로 정의합니다.
- DTO 입력 바인딩(`@Arg`)은 root operation 중심 유지, field resolver arg 바인딩은 런타임 단계 후속 범위로 둡니다.

## 통합 계획 (런타임 단계, 이 단계에서는 미구현)

1. Metadata 계층
   - field resolver metadata symbol 및 parameter-binding metadata 추가
2. Discovery 계층
   - `typeName` 단위 `FieldResolverDescriptor` 생성
3. Schema 빌더
   - code-first schema 조립 시 object type에 field resolver config 병합
4. Invocation 파이프라인
   - scope에 맞는 provider instance 해석 후 `(parent, context)` 매핑 호출
5. Validation/Error
   - root operation 파이프라인의 GraphQL 에러 변환 전략 재사용

## 호환성/마이그레이션

- 이 단계는 breaking change가 없습니다.
- 기존 root operation resolver 동작은 유지됩니다.
- 이후 런타임 구현은 새로운 decorator를 통한 additive 방식으로 도입됩니다.

## 열린 질문

- `nullable`를 첫 런타임 릴리즈에 포함할지 여부
- implicit/explicit 바인딩이 동시에 있을 때 파라미터 decorator 우선순위
- field-level argument DTO 바인딩을 첫 런타임 릴리즈에 포함할지 후속 슬라이스로 분리할지
