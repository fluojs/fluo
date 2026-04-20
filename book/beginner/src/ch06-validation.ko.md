<!-- packages: @fluojs/http, @fluojs/validation -->
<!-- project-state: FluoBlog v1.3 -->

# Chapter 6. Request Data and DTO Validation

## Learning Objectives
- DTO가 느슨한 요청 객체보다 왜 더 나은지 이해합니다.
- FluoBlog 게시글 생성 입력을 설명하는 검증 데코레이터를 사용합니다.
- `@RequestDto()`가 HTTP 바인딩과 DTO materialization을 어떻게 연결하는지 배웁니다.
- 업데이트 작업에 optional 및 partial DTO 패턴을 적용합니다.
- fluo가 암시적 스칼라 강제 변환을 피하는 이유를 이해합니다.
- 전송 데이터와 서비스 로직 사이에 더 깔끔한 경계를 만듭니다.

## Prerequisites
- 5장을 완료했습니다.
- `PostsController` 라우트 예제에 대한 기본 이해가 있습니다.
- TypeScript 클래스와 프로퍼티에 익숙합니다.
- 짧은 검증 예제를 읽는 데 불편함이 없습니다.

## 6.1 Why Loose Input Becomes a Problem Quickly

5장에서는 create 라우트가 일반 객체를 그대로 받았습니다.

라우팅을 소개하는 단계에서는 충분했습니다.

하지만 장기적인 입력 전략으로는 부족합니다.

일반 객체는 어떤 필드가 필수인지 알려 주지 않습니다.

어떤 값이 문자열이어야 하는지도 설명하지 못합니다.

최소 길이나 선택 필드도 표현하지 못합니다.

무엇보다 서비스 경계를 보호하지 못합니다.

DTO는 요청 데이터에 이름 있는 형태를 부여함으로써 이 문제를 해결합니다.

검증 데코레이터는 그 형태를 실행 가능한 계약으로 바꿉니다.

```typescript
class CreatePostDto {
  title = '';
  body = '';
}
```

아직 검증 규칙을 붙이지 않았더라도 이 코드는 익명 인라인 객체보다 이미 더 읽기 쉽습니다.

클래스 이름이 이 페이로드가 무엇을 위한 것인지 말해 줍니다.

프로퍼티는 라우트가 무엇을 기대하는지 보여 줍니다.

### DTOs Are a Boundary Tool

DTO는 단순한 TypeScript 편의 기능이 아닙니다.

전송 경계를 만드는 도구입니다.

경계 바깥에서는 클라이언트가 알 수 없는 입력을 보냅니다.

경계 안쪽에서는 서비스가 신뢰 가능한 구조를 기대합니다.

그 전환을 안전하게 만드는 것이 검증입니다.

### 왜 인터페이스가 아니라 클래스인가요?

DTO에 TypeScript 인터페이스(interface) 대신 클래스(class)를 사용하는 이유가 궁금할 수 있습니다. TypeScript에서 인터페이스는 컴파일 중에 삭제되어 런타임에는 존재하지 않습니다. 반면 클래스는 JavaScript 표준의 일부이며 런타임에도 남아 있습니다. fluo는 이러한 런타임 존재감을 활용하여 데코레이터를 통해 검증 메타데이터를 부착합니다. 이는 순수 인터페이스로는 불가능한 일입니다.

## 6.2 Defining CreatePostDto with Validation Rules

이제 FluoBlog에서 유효한 게시글 생성 요청이 무엇인지 설명하는 규칙을 추가해 봅시다.

```typescript
import { IsBoolean, IsOptional, IsString, MinLength } from '@fluojs/validation';

export class CreatePostDto {
  @IsString()
  @MinLength(3)
  title = '';

  @IsString()
  @MinLength(10)
  body = '';

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
```

이 클래스는 이제 세 가지 유용한 역할을 합니다.

요청에 이름을 붙입니다.

기대하는 필드를 문서화합니다.

런타임 검증 규칙을 정의합니다.

### Why Field Defaults Help Beginners

DTO 필드가 간단한 기본값으로 초기화된 예제를 자주 보게 됩니다.

이 패턴은 클래스를 materialize하고 눈으로 확인하기 쉽게 만들어 줍니다.

클래스 기반 검증을 처음 배우는 독자에게도 더 부담이 적습니다.

### What These Rules Mean

`title`은 문자열이어야 하며 최소 세 글자여야 합니다.

`body`는 문자열이어야 하며 최소 열 글자여야 합니다.

`published`는 생략할 수 있지만 존재한다면 boolean이어야 합니다.

규칙은 작습니다.

하지만 이 정도만으로도 시스템의 가치를 보여 주기에 충분합니다.

### 왜 데코레이터인가요?

fluo가 클래스 프로퍼티에 직접 `@IsString()` 같은 데코레이터를 사용하는 것을 보셨을 겁니다. 이러한 "선언적(declarative)" 스타일은 fluo 프레임워크의 특징입니다. 데이터를 체크하기 위해 긴 `if/else` 블록을 작성하는 대신, 데이터가 어떠해야 하는지 선언만 하면 됩니다. 이렇게 하면 DTO가 코드이자 문서의 역할을 동시에 수행하며, 규칙을 보호 대상 데이터와 가깝게 유지할 수 있습니다.

### 흔히 사용되는 검증 데코레이터

`@fluojs/validation` 패키지는 다양한 데이터 유형에 대한 광범위한 데코레이터를 제공합니다.

- **문자열 검사**: `@IsString()`, `@MinLength()`, `@MaxLength()`, `@IsEmail()`, `@IsUrl()`
- **숫자 검사**: `@IsNumber()`, `@Min()`, `@Max()`, `@IsInt()`
- **타입 검사**: `@IsBoolean()`, `@IsDate()`, `@IsEnum()`, `@IsArray()`
- **존재 여부 검사**: `@IsOptional()`, `@IsNotEmpty()`, `@IsDefined()`

초보자로서 이 모든 것을 외울 필요는 없습니다. 일반적인 데이터 요구 사항이 있다면 그에 맞는 데코레이터가 이미 존재할 가능성이 높다는 점만 기억하세요.

## 6.3 Connecting DTOs to the HTTP Layer

검증은 컨트롤러가 실제로 DTO materialization을 요청할 때 비로소 의미가 생깁니다.

그 역할을 맡는 것이 `@RequestDto()`입니다.

```typescript
import { Controller, Post, RequestDto } from '@fluojs/http';
import { CreatePostDto } from './create-post.dto';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return input;
  }
}
```

이 데코레이터가 붙으면 HTTP 계층은 더 이상 원시 body만 그대로 넘기지 않습니다.

요청 데이터를 바인딩합니다.

DTO 인스턴스를 materialize합니다.

서비스가 보기 전에 결과를 검증합니다.

전송 경계에서 우리가 원하는 순서가 바로 이것입니다.

### `materialize()` vs Plain Assignment

검증 패키지는 타입이 있는 인스턴스를 만드는 일과 이미 존재하는 값을 검증하는 일을 구분합니다.

HTTP 바인딩은 보통 첫 번째 경로가 필요합니다.

알 수 없는 입력을 받아 DTO 인스턴스로 바꾸어야 하기 때문입니다.

그래서 문서에서 hydration과 validation을 함께 처리하는 `materialize()`를 강조합니다.

초보자 관점의 핵심은 단순합니다.

들어오는 페이로드는 비즈니스 로직이 실행되기 전에 먼저 알려진 DTO 형태로 바뀌어야 합니다.

### 메타데이터의 역할 (The Role of Metadata)

내부적으로 `@fluojs/validation`은 클래스를 청사진(blueprint)으로 사용합니다. 데코레이터를 읽어 데이터가 어떤 모습이어야 하는지 파악합니다. `materialize`가 호출되면 들어오는 데이터를 이 청사진과 비교합니다. 이것이 fluo가 효율적인 이유입니다. 모든 요청에 대해 느리고 무거운 리플렉션을 사용하는 대신, 여러분이 이미 제공한 구조화된 메타데이터를 활용하기 때문입니다.

## 6.4 Updating FluoBlog Create and Update Flows


이제 게시글 서비스가 DTO 기반 입력을 사용하도록 바꿔 보겠습니다.

업데이트 DTO도 함께 준비하겠습니다.

```typescript
import { PartialType } from '@fluojs/validation';

export class UpdatePostDto extends PartialType(CreatePostDto) {}
```

이 코드는 mapped DTO helper를 보여 주는 아주 좋은 초보자 예제입니다.

`PartialType(CreatePostDto)`는 create DTO의 모든 필드가 update에서는 optional이 된다는 뜻입니다.

이는 patch 스타일 업데이트의 일반적인 의미와 잘 맞습니다.

이제 컨트롤러는 두 DTO를 모두 사용할 수 있습니다.

```typescript
import { Controller, FromPath, Patch, Post, RequestDto } from '@fluojs/http';
import { CreatePostDto } from './create-post.dto';
import { UpdatePostDto } from './update-post.dto';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }

  @Patch('/:id')
  @RequestDto(UpdatePostDto)
  update(@FromPath('id') id: string, input: UpdatePostDto) {
    return this.postsService.update(id, input);
  }
}
```

이것은 FluoBlog에 의미 있는 업그레이드입니다.

생성 라우트는 이제 명시적인 규칙을 갖습니다.

업데이트 라우트는 partial update의 의미를 분명하게 전달합니다.

원래 규칙과 동작적으로 연결된 상태를 유지합니다.

### Why Mapped DTO Helpers Matter

초보자는 비슷한 DTO를 손으로 반복해서 작성하기 쉽습니다.

처음에는 그 방법도 동작합니다.

하지만 빠르게 반복적이고 실수하기 쉬운 코드가 됩니다.

`PartialType`, `PickType`, `OmitType` 같은 helper는 중복을 줄이면서도 검증 메타데이터를 보존합니다.

### 특정 DTO 변형 생성하기

예를 들어 제목만 포함하는 DTO가 필요하다면 다음과 같이 할 수 있습니다.

```typescript
export class UpdateTitleDto extends PickType(CreatePostDto, ['title']) {}
```

또는 특정 필드를 제외하고 싶다면 다음과 같습니다.

```typescript
export class PublicCreateDto extends OmitType(CreatePostDto, ['published']) {}
```

이러한 유틸리티를 사용하면 기본 DTO에서 검증 규칙을 **한 번만** 정의하고 애플리케이션 전체에서 재사용할 수 있습니다. 이는 "DRY"(Don't Repeat Yourself) 개발의 핵심 원칙입니다.

## 6.5 No Implicit Scalar Coercion

검증 패키지 문서에서 특별히 주목할 디테일이 하나 있습니다.

검증기는 의도적으로 엄격합니다.

전송 계층이 `'42'`를 주었는데 DTO가 `number`를 기대한다면, 문자열을 이미 숫자였던 것처럼 조용히 처리하지 않습니다.

이것은 건강한 설계 선택입니다.

조용한 강제 변환은 버그를 숨길 수 있습니다.

입력 동작을 예측하기 어렵게 만들 수도 있습니다.

### What This Means for FluoBlog

나중에 `?page=2`나 `?limit=10` 같은 쿼리 파라미터를 추가한다고 생각해 봅시다.

그 값은 전송 데이터로 도착합니다.

자동으로 신뢰 가능한 애플리케이션 숫자가 되는 것이 아닙니다.

변환이 필요하다면 바인딩 또는 전송 계층에서 의도적으로 처리해야 합니다.

그 명시성이 검증을 정직하게 유지합니다.

### Beginner Rule of Thumb

네트워크가 원하는 타입을 그대로 보내 줄 것이라고 가정하지 마세요.

기대하는 타입을 설명하세요.

검증하세요.

변환은 어디에 속하는지 설명할 수 있을 때만 하세요.

이 규칙이 나중의 미묘한 버그를 막아 줍니다.

### 쿼리 파라미터 변환하기

만약 쿼리 파라미터에서 꼭 숫자를 받아야 한다면, 커스텀 변환 로직과 함께 `@FromQuery()` 데코레이터를 사용할 수 있습니다.

```typescript
@Get('/')
findAll(@FromQuery('page', (v) => parseInt(v, 10)) page: number) {
  return this.postsService.findAll(page);
}
```

이렇게 하면 변환 과정이 명시적이고 가시적이게 됩니다. 프레임워크가 무엇을 할지 추측하는 것이 아니라, 데이터를 어떻게 처리할지 프레임워크에 정확히 지시하는 방식입니다.

## 6.6 What FluoBlog Looks Like After Validation

이제 posts 기능은 한층 더 현실적인 구조가 되었습니다.

라우팅은 여전히 중요합니다.

하지만 서비스가 더 이상 형태 없는 입력에 그대로 노출되지 않습니다.

이것은 큰 아키텍처 개선입니다.

```typescript
// src/posts/posts.service.ts
import { Injectable } from '@fluojs/di';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

@Injectable()
export class PostsService {
  create(input: CreatePostDto) {
    return {
      id: '2',
      title: input.title,
      body: input.body,
      published: input.published ?? false,
    };
  }

  update(id: string, input: UpdatePostDto) {
    return { id, ...input };
  }
}
```

서비스 시그니처도 이제 훨씬 더 분명합니다.

다른 개발자도 create와 update가 검증된 DTO를 기대한다는 사실을 바로 이해할 수 있습니다.

이런 명확함은 이후 리팩터링을 쉽게 만듭니다.

### 신뢰와 안정성 (Reliability and Trust)

입력이 유효하다는 것을 알고 있다면 더 단순한 서비스 코드를 작성할 수 있습니다. DTO가 이미 처리했다는 사실을 알고 있기 때문에 서비스 내부에서 `if (input.title.length < 3)` 같은 체크를 할 필요가 없습니다. 이는 전송 계층과 비즈니스 로직 사이의 신뢰를 구축하며, 시스템의 각 부분이 핵심 책임에 집중할 수 있게 해 줍니다.

### Common Beginner Mistakes with Validation

- DTO가 이미 있는데도 컨트롤러 메서드에 인라인 객체 타입을 남겨 두는 실수.
- 검증 데코레이터는 달아 놓고 `@RequestDto()`를 빼먹는 실수.
- 쿼리 문자열이 자동으로 숫자가 될 것이라 기대하는 실수.
- mapped helper를 쓰지 않고 create DTO 필드를 update DTO에 손으로 복사하는 실수.
- DTO 클래스를 전송 경계 모델이 아니라 도메인 모델처럼 취급하는 실수.

### Why This Chapter Stops Before Error Details

검증이 생기면 독자는 자연스럽게 실패했을 때 무엇이 일어나는지 묻게 됩니다.

아주 좋은 질문입니다.

그 답은 곧 다룰 것입니다.

하지만 먼저 성공 경로의 응답 형태도 정리할 필요가 있습니다.

모든 오류 경로를 다루기 전에 성공 결과가 어떤 모습이어야 하는지부터 정하는 편이 더 좋습니다.

## Summary
- DTO는 느슨한 요청 객체를 이름 있는 검증 가능한 입력 계약으로 바꿉니다.
- `@RequestDto()`는 HTTP 바인딩과 DTO materialization 및 validation을 연결합니다.
- 검증 데코레이터는 FluoBlog 생성 및 업데이트 라우트를 더 안전하게 만듭니다.
- `PartialType()`은 update DTO를 만들 때 유용한 초보자 패턴입니다.
- fluo는 암시적 스칼라 강제 변환을 피하므로 입력 처리가 예측 가능해집니다.
- 이제 posts 서비스는 더 깔끔한 전송 경계 데이터를 받습니다.

## Next Chapter Preview
7장에서는 API의 응답 측면으로 이동합니다. FluoBlog는 내부 데이터와 외부 응답 데이터가 꼭 같을 필요는 없다는 점을 배우면서 output DTO를 통해 응답 형태를 다듬기 시작할 것입니다.
