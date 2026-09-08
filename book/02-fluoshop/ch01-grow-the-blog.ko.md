# 기존 블로그에 상점을 붙이기

<!-- book:volume=02-fluoshop;chapter=01 -->

[이전: 1권 · 첫 출시와 첫 운영 회고](../01-fluoblog/ch24-first-release.ko.md) · [2권 목차](./toc.ko.md) · [다음: 콘텐츠·상품·주문의 경계 나누기](./ch02-domain-boundaries.ko.md)

## 댓글에서 시작한 두 번째 제품

FluoBlog를 처음 열었을 때 운영자가 확인하던 숫자는 발행한 글의 수였다. 이제는 새 글을 공개하면 익숙한 독자들이 돌아오고, 구독 알림을 보고 들어온 사람이 지난 글까지 읽는다. 어느 날 회고 글에 올린 로고 티셔츠 사진 아래로 구매 문의가 모인다. “스티커도 같이 살 수 있나요?”라는 댓글은 블로그를 버리고 쇼핑몰을 다시 만들라는 요청이 아니다. 독자가 이미 믿고 찾아오는 장소에서 물건도 사고 싶다는 요청이다.

그래서 이 권의 작업 디렉터리도 `fluo-blog`다. 1권에서 만든 `src/app.ts`, `src/main.ts`, `AccountsModule`, `PostsModule`을 유지한다. PostgreSQL 연결, 로그인 검증, 설정, 요청 식별자, 관측과 종료 절차도 그대로 이어 간다. FluoShop은 제품이 얻은 새 역할이지 새 계정 체계나 별도 배포의 이름이 아니다. 새 애플리케이션 생성 명령을 실행하고 기존 사용자 데이터를 복사하는 것으로 시작하지 않는다.

다만 성공한 블로그가 곧 판매 가능한 상점인 것은 아니다. 글의 제목을 바꾸는 일과 구매 당시의 티셔츠 이름을 보존하는 일은 다르다. 삭제한 글은 공개 목록에서 사라질 수 있지만, 판매를 중단한 상품 때문에 지난 주문의 항목이 사라져서는 안 된다. 두 기능이 같은 프로세스에 있다고 해서 같은 수명주기를 갖지는 않는다. 이번 장에서는 그 차이가 커지기 전에 상품을 놓을 자리를 만들고, 기존 블로그를 훼손하지 않고 새 데이터를 추가하는 방법을 익힌다.

이번 장의 완성 상태는 결제 가능한 상점이 아니다. 기존 글과 계정이 유지되는 애플리케이션에 독립된 상품 모델과 공개 조회 서비스가 추가된 상태다. 가격과 사이즈는 3장, 독자가 방문할 화면은 4장에서 붙인다. 이 순서는 핵심 처리를 빈 함수로 남기는 방식과 다르다. 여기서 제공하는 조회는 실제로 동작하며, 아직 약속하지 않은 구매 기능을 성공한 것처럼 흉내 내지 않는다.

이 책의 코드는 독자가 자신의 애플리케이션에 적용하는 구현이다. 저장소에 각 장의 완성 앱이 별도 체크포인트로 이미 있다는 뜻은 아니다. 기존 `examples/fluo-blog`는 초기 HTTP·DI 경로를 확인하는 실행 근거이며, 아래 상품 테이블이나 상점 서비스를 제공하는 완성 저장소가 아니다.

## 먼저 보존할 것을 정한다

상품 기능의 첫 설계 회의에서 새 데이터보다 먼저 적을 것은 변하지 않을 식별자다. 독자가 고객이 되어도 계정 ID는 바뀌지 않는다. 기존 JWT의 subject로 확인한 사용자와 주문의 `customerId`가 가리키는 사용자는 같아야 한다. 상점 전용 `Customer` 테이블을 만들고 이메일 주소로 기존 계정과 느슨하게 연결하면, 이메일 변경·대소문자 처리·계정 병합마다 같은 사람이 둘로 나뉜다. 고객에게 필요한 배송 정보는 기존 계정과 연결된 별도 정보로 확장하되 로그인 주체를 새로 만들지 않는다.

게시글의 의미도 보존한다. `id`, `authorId`, `title`, `content`, `slug`, `status`, `version`, `publishedAt`는 여전히 콘텐츠의 규칙을 설명한다. 상품을 소개하는 글이라고 해서 게시글의 `status`에 `sold_out`을 추가하지 않는다. 글은 발행되어 있지만 물건은 품절일 수 있고, 판매가 끝난 물건을 다룬 회고 글도 계속 읽을 가치가 있다. 두 상태를 하나로 합치면 운영자가 재고를 정리하는 순간 검색으로 들어온 독자의 글까지 사라진다.

새 요구를 화면부터 구현하면 이런 결합을 놓치기 쉽다. 예를 들어 게시글에 `price`와 `stock` 열을 붙인 뒤 “가격이 있으면 상품”으로 해석하는 구현은 처음에는 빠르다. 그러나 같은 티셔츠를 여러 글에서 소개하거나, 한 글에 티셔츠와 스티커를 함께 연결하면 어디의 가격과 재고가 진짜인지 정할 수 없다. 작성 권한이 판매 가격 변경 권한으로 번지는 문제도 생긴다. 이번에는 글은 상품을 소개하고 상품은 자기 식별자로 존재하도록 처음부터 분리한다.

출시 전후를 비교할 기준도 준비한다. 발행된 글 하나의 ID와 URL, 초안 하나의 비공개 상태, 기존 독자 한 명의 ID, 로그인 성공 여부를 기록한다. 비밀번호 해시나 토큰 원문을 기록하라는 뜻이 아니다. 상품 마이그레이션 뒤에도 같은 요청의 의미가 유지되는지 확인할 비밀이 아닌 관측값을 남기는 것이다. “상점 페이지가 열린다”만으로는 블로그 확장이 성공했다고 판단할 수 없다.

## 상품 테이블 하나를 더한다

첫 상품은 로고 티셔츠다. 아래는 `prisma/schema.prisma`에 **추가하는 스키마 조각**이다. 기존 `generator`, PostgreSQL `datasource`, 게시글과 계정 모델은 보존한다. 모델은 애플리케이션이 소유하며 `@fluojs/prisma`가 자동 생성하지 않는다.

```prisma
enum ProductStatus {
  draft
  published
  archived
}

model Product {
  id      String        @id @default(cuid())
  slug    String        @unique
  name    String
  status  ProductStatus @default(draft)
  version Int           @default(1)

  @@index([status, id])
}
```

`id`와 `slug`를 나누는 이유는 주소와 정체성의 변경 빈도가 다르기 때문이다. 내부 참조에는 변하지 않는 ID를 쓰고, 사람이 읽는 주소에는 슬러그를 쓴다. 이름을 “첫 로고 티셔츠”에서 “Fluo 로고 티셔츠”로 고쳐도 같은 상품이다. 슬러그 변경은 과거 링크 보존이라는 별도 정책이 필요하므로 이번 실습의 `fluo-logo-tee`는 유지한다.

`draft`는 아직 공개 목록에 올리지 않는 상품, `published`는 공개 대상으로 선택한 상품, `archived`는 판매 목록에서 내려 보존하는 상품이다. 여기서 `published`는 재고가 남았거나 결제가 가능하다는 보증이 아니다. 이번 장에는 재고 모델이 없고 3장에서는 실제 판매 단위가 없는 상품도 공개 조회에서 제외한다. 용어의 범위를 좁게 잡아야 다른 계층이 상품 상태 하나를 재고 예약의 근거로 사용하지 않는다.

`version`은 지금 당장 모든 조회에 낙관적 잠금을 적용하라는 신호가 아니다. 변경 충돌을 구별할 수 있는 데이터 자리를 마련한 것이다. 추후 수정 작업은 읽었던 버전을 조건으로 갱신하고 성공할 때 증가시킬 수 있다. 무조건 증가시키는 카운터만 두고 충돌을 검사하지 않으면 동시 수정 문제는 해결되지 않는다. 이번 장의 조회에서는 버전이 필요하지 않으므로 응답에 내보내지 않는다.

개발용 PostgreSQL을 대상으로 다음 순서로 마이그레이션을 만든다. 운영 DB의 URL을 사용하지 않는지 먼저 확인한다. 이 명령은 독자의 재현 절차이며 이 원고 집필 과정에서 실행한 기록이 아니다.

```bash
pnpm exec prisma migrate dev --name add_catalog --create-only
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

첫 명령으로 생성된 SQL을 적용 전에 읽는다. 예상 변화는 새 enum, `Product` 테이블, 고유 제약과 인덱스다. 기존 게시글·계정 테이블의 삭제, 필수 열의 예기치 않은 변경, 데이터 초기화가 포함되면 여기서 멈춘다. 두 번째 명령이 개발 DB에 마이그레이션을 적용하고, 세 번째 명령이 새 모델을 아는 Prisma Client를 생성한다. 클라이언트 생성은 DB 변경을 대신하지 않으며 그 역도 마찬가지다.

이번처럼 기존 코드가 모르는 테이블을 더하는 변경은 구버전 애플리케이션과 비교적 잘 공존한다. 새 테이블이 남아 있어도 구버전은 읽지 않으므로 앱 배포만 되돌릴 수 있다. 그렇다고 모든 스키마 변경이 되돌릴 수 있는 것은 아니다. 이후 기존 열을 지우거나 의미를 바꿀 때는 별도의 전환 절차가 필요하다. “Prisma migration이 있으니 롤백도 자동”이라는 가정 대신, 현재 구버전이 새 스키마에서 계속 동작하는지를 확인한다.

## 연결은 공유하되 기능은 합치지 않는다

상점을 추가하면서 흔히 하는 실수는 `CatalogModule` 안에서 새 `PrismaClient`를 만드는 것이다. 이미 게시글과 계정이 사용하는 연결이 있는데 기능마다 클라이언트를 더 만들면 커넥션 풀과 종료 소유자가 늘어난다. 같은 DB에 연결했다는 이유만으로 트랜잭션 컨텍스트까지 공유되는 것도 아니다. 이번 제품은 같은 PostgreSQL과 같은 Prisma 등록을 사용한다.

연결의 주인은 [1권 10장](../01-fluoblog/ch10-prisma-persistence.ko.md)의 `src/database/blog-database.module.ts`다. 아래는 **이미 존재하는 등록 파일의 재확인**이며 새 파일이나 두 번째 등록이 아니다. `AppSettingsModule`이 전역으로 제공하는 기존 `AppSettings`를 받아 애플리케이션 컨테이너마다 클라이언트를 만든다. 모듈 바깥에 새 `prisma` 변수를 만들거나 `DatabaseModule` 클래스로 감싸지 않는다.

```ts
// src/database/blog-database.module.ts
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { AppSettings } from '../config/app-settings.js';

export const BlogDatabaseModule = PrismaModule.forRootAsync({
  global: true,
  inject: [AppSettings],
  useFactory: (settings: unknown) => {
    if (!(settings instanceof AppSettings)) throw new Error('Expected AppSettings from DI.');
    return {
    client: new PrismaClient({
      datasources: { db: { url: settings.databaseUrl } },
    }),
      strictTransactions: true,
    };
  },
});
```

루트 `src/app.ts`는 기존 `AppSettingsModule`, `BlogDatabaseModule` 등록을 유지한다. `PostsModule`과 `AccountsModule`도 그 전역 서비스를 계속 사용한다. 아래 상품 모듈처럼 의존성을 imports에 명시할 때에도 이 파일의 같은 `BlogDatabaseModule` 객체만 참조한다. 각 파일에서 `forRoot`나 `forRootAsync`를 다시 호출하지 않는다. 같은 등록 객체를 참조하는 것과 같은 옵션으로 새 등록을 만드는 것은 다르다. 후자는 provider와 연결 수명주기를 분리할 수 있다.

`strictTransactions: true`는 트랜잭션을 지원하지 않는 클라이언트에서 헬퍼가 직접 실행으로 물러서는 것을 막는다. 모든 조회에 트랜잭션이나 잠금을 추가하는 옵션은 아니다. 지금의 목록 조회에는 수동 트랜잭션이 필요하지 않지만, 뒤의 주문·재고 조합은 이 동일한 등록이 제공하는 활성 트랜잭션 문맥을 필요로 한다.

이 앱은 이미 `global: true`인 이름 없는 등록을 선택했다. `global`은 factory가 반환하는 클라이언트 옵션이 아니라 바깥의 모듈 가시성 옵션이다. 기능 모듈의 명시적인 import는 같은 등록에 대한 의존성을 기록할 뿐 별도 연결을 만들지 않는다. 전역 등록을 없애거나 새 wrapper를 추가해서 1권의 계정·게시글 구성을 바꾸지 않는다.

아래 두 코드는 각각 **완전한 파일**이다. 앞서 생성한 Prisma Client와 `src/database/blog-database.module.ts`가 준비되어 있어야 한다.

```ts
// src/catalog/catalog.reader.ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class CatalogReader {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async list() {
    return this.db.current().product.findMany({
      where: { status: 'published' },
      select: { id: true, slug: true, name: true },
      orderBy: { id: 'asc' },
      take: 24,
    });
  }
}
```

```ts
// src/catalog/catalog.module.ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CatalogReader } from './catalog.reader.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [CatalogReader],
  exports: [CatalogReader],
})
export class CatalogModule {}
```

생성자의 타입 표기만으로 주입이 생기지 않는다. `@Inject(PrismaService)`는 클래스 수준에서 실제 런타임 토큰을 선언한다. `providers`는 이 모듈이 `CatalogReader`를 생성하도록 등록하고, `exports`는 이를 import한 다른 모듈에 조회 능력을 공개한다. 반대로 `PrismaService`는 상품 모듈의 공개 API로 다시 내보내지 않는다. 다른 기능이 상품을 읽는 데 상품 모듈의 DB 접근 권한까지 받을 이유는 없다.

`current()`는 활성 트랜잭션이 있으면 그 클라이언트를, 없으면 루트 클라이언트를 반환한다. 따라서 메서드가 호출되는 시점에 핸들을 얻는다. 생성자에서 `current()`를 한 번 호출해 필드에 저장하면 훗날 트랜잭션 안에서 이 서비스를 사용해도 과거에 잡은 루트 핸들을 사용할 수 있다. 지금은 단순 조회지만 나중의 조합을 깨뜨리지 않는 작은 선택이다.

조회는 공개 상태, 공개 필드, 최대 개수를 함께 정한다. DB 행 전체를 반환하지 않으므로 관리용 상태나 앞으로 추가할 내부 필드가 자동 노출되지 않는다. 24개는 초기 상점의 진열 한도이며 완성된 페이지네이션 계약은 아니다. 데이터가 한도를 넘으면 별도 탐색 기능을 설계해야 한다. 이름순 대신 고정된 ID 순서로 조회하는 것은 이름을 수정했을 때 순서가 예기치 않게 흔들리는 일을 줄이기 위한 선택이다.

`src/app.ts`에서는 기존 `@Module` 선언의 `imports`에 `CatalogModule`을 추가한다. 아래는 **변경 지점만 표현한 메타데이터 조각**이다. 이미 등록한 설정·관측·준비 상태 모듈을 지우고 이 목록으로 대체하지 않는다. `AccountsModule`은 `src/accounts/accounts.module.ts`, `PostsModule`은 `src/posts/posts.module.ts`, `CatalogModule`은 방금 만든 파일의 export를 가리킨다.

```ts
({
  imports: [AppSettingsModule, BlogDatabaseModule, AccountsModule, PostsModule, CatalogModule],
})
```

새 HTTP 서버나 두 번째 `main.ts`는 만들지 않는다. 기존 시작 경로가 모듈 그래프를 초기화하고 기존 종료 경로가 Prisma 연결을 닫는다. Prisma 통합은 등록된 클라이언트의 연결·해제 수명주기를 소유하므로, 상품 서비스의 생성자에서 `$connect()`를 부르거나 요청이 끝날 때 `$disconnect()`를 호출하지 않는다.

## 이름표를 진열하기 전에 실패를 관찰한다

첫 실험은 DB가 없어도 할 수 있다. 아래는 `src/catalog/catalog.metadata.test.ts`의 **완전한 테스트 파일**이다. 1권에서 마련한 Vitest와 표준 데코레이터 테스트 변환 구성을 사용한다. 등록 객체를 import하는 것만으로 `useFactory`가 실행되지는 않는다. 실제 컨테이너 초기화 없이 모듈 메타데이터와 등록 정체성만 검사한다.

```ts
import { getModuleMetadata } from '@fluojs/core';
import { expect, it } from 'vitest';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CatalogModule } from './catalog.module.js';
import { CatalogReader } from './catalog.reader.js';

it('imports the shared database and exports only catalog reads', () => {
  const metadata = getModuleMetadata(CatalogModule);

  expect(metadata?.imports).toContain(BlogDatabaseModule);
  expect(metadata?.providers).toContain(CatalogReader);
  expect(metadata?.exports).toEqual([CatalogReader]);
});
```

이 실험은 모듈 선언을 증명하지 DB 연결 성공을 증명하지 않는다. `imports`에서 공유 등록을 제거하면 첫 검사가 실패해야 한다. 이후 실제 앱을 시작해 `CatalogReader`를 사용하는 경로까지 해석해야 모듈 간 가시성도 확인할 수 있다. 선언 검사를 통과했다는 이유로 bootstrap이나 SQL 검사를 생략하지 않는 것이 중요하다.

개발 DB에는 초안 상태의 티셔츠를 하나 등록한다. 다음은 `src/catalog/seed-catalog.ts`의 **완전한 함수 파일**이다. 기존 개발용 실행 경계에서 루트 등록의 `PrismaService`를 해석해 전달하며, 서버 시작마다 호출하지 않는다. 이 함수는 연결을 생성하거나 닫지 않는다. `update: {}`는 재실행했을 때 운영자가 수정한 이름과 공개 상태를 덮지 않기 위한 의도적인 빈 갱신이다.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export async function seedCatalog(db: PrismaService<PrismaClient>) {
  return db.current().product.upsert({
    where: { slug: 'fluo-logo-tee' },
    update: {},
    create: {
      slug: 'fluo-logo-tee',
      name: 'Fluo Logo Tee',
      status: 'draft',
    },
  });
}
```

다음 관찰은 실제 PostgreSQL이 필요한 수동 재현 절차다. 초안 하나만 있을 때 `CatalogReader.list()`는 빈 배열을 반환해야 한다. 개발 DB에서 그 상품을 `published`로 바꾸면 `id`, `slug`, `name`만 있는 항목 하나가 나온다. `archived`로 바꾸면 다시 사라지지만 행은 남는다. 같은 슬러그로 새 행을 두 번 생성하려 하면 고유 제약이 중복을 거부해야 한다. 동시에 두 생성 요청이 “없음”을 읽어도 최종 판정은 DB 제약이 한다.

그 뒤 앱을 정상 종료하고 재시작한다. 티셔츠와 기존 게시글은 그대로 있어야 하며, 기존 독자로 로그인한 결과의 계정 ID도 달라지지 않아야 한다. 상품을 숨기는 것과 데이터를 지우는 것을 구별했으므로 상품 목록을 내리더라도 블로그 URL은 살아 있어야 한다. 재시작 때 seed를 강제 실행해 테스트를 통과시키면 영속성을 증명한 것이 아니라 데이터를 다시 만든 것이다.

부분 실패도 구별한다. 마이그레이션은 적용했는데 클라이언트를 생성하지 않았다면 TypeScript에서 `product` 모델을 찾지 못할 수 있다. 클라이언트는 새것인데 DB가 구버전이면 실제 쿼리가 실패한다. 이 둘을 빈 상품 목록으로 바꾸면 장애가 정상 상태처럼 보인다. 예상하지 못한 DB 오류는 기존 오류·관측 경로로 전달하고, “진열 상품 없음”은 성공한 쿼리의 결과가 0건일 때만 사용한다.

이 장의 테스트와 DB 실험은 독자가 위 애플리케이션을 구성한 뒤 수행할 절차다. 원고 자체의 링크·코드 구조 확인과 실제 PostgreSQL 연결 검증은 별개의 증거다. 이 문서는 후자를 실행해 통과했다고 주장하지 않는다.

## 같은 배포 안에서 지킬 운영 경계

아직 판매 화면을 공개하지 않았다는 점은 배포에서 유리하다. 먼저 추가 스키마를 적용하고, 새 조회 코드를 포함한 앱이 기존 블로그 요청을 계속 처리하는지 확인한 다음 노출을 결정할 수 있다. 상품이 `draft`이면 목록에도 나오지 않는다. 공개 여부를 UI 링크 하나로만 제어하지 않고 조회 조건에 넣었으므로, 링크를 아는 사람이 초안을 우회해 읽는 문제도 줄어든다.

그러나 `draft` 필터는 권한 체계를 대체하지 않는다. 이번 장에는 관리자 HTTP 쓰기 경로를 열지 않는다. 그런 경로를 연결할 때는 1권의 인증 주체와 권한 판단을 재사용해야 한다. 관리자 화면에서 버튼을 숨기는 것, 요청에 `isAdmin: true`를 넣는 것, 판매자 이메일을 비교하는 것은 서버 권한 검증이 아니다.

모듈형 모놀리스에도 비용은 있다. 프로세스와 DB를 공유하므로 상품 쿼리가 연결 풀을 고갈시키면 글 읽기도 영향을 받을 수 있다. 따라서 목록 제한, 느린 쿼리 관측, 요청별 오류 구분이 필요하다. 그렇다고 티셔츠를 처음 등록하는 날부터 계정·상품·주문을 각각 다른 서비스로 나누면 문제가 사라지는 것은 아니다. 네트워크 장애, 분산 배포, 데이터 복제와 교차 서비스 인증이라는 비용을 먼저 얻는다. 이 권은 그런 비용을 설명할 수 있는 실제 요구가 생긴 뒤 23장에서 배송 처리만 분리한다.

현재의 작은 설계도 무조건 확대하지 않는다. 고정된 굿즈 한 종류를 외부 상점 링크로 안내하는 요구뿐이라면 DB 상품 모델 없이 게시글 링크로 충분할 수 있다. 여기서는 같은 계정으로 장바구니와 주문 이력을 제공하고, 재고와 주문을 직접 다루는 제품으로 발전할 것이기 때문에 모델을 추가했다. 구현 선택은 미래의 모든 가능성이 아니라 이미 받아들인 제품 범위에 근거해야 한다.

이제 블로그 안에 상품이 생겼다. 하지만 공개한 `CatalogReader`의 메서드가 늘어나면 다른 기능이 상품 내부 구조에 기대기 쉽다. 다음 장에서는 콘텐츠가 상품을 소개하고 주문이 상품을 구매한다는 서로 다른 관계를 나누고, DI 토큰과 모듈 export로 그 경계를 표현한다.

## 구현 근거

- [`@fluojs/core` README](../../packages/core/README.ko.md): 클래스 수준 `@Inject`, 모듈 메타데이터, 표준 데코레이터 계약.
- [core 공개 export](../../packages/core/src/index.ts), [모듈 메타데이터 테스트](../../packages/core/src/module-defaults.test.ts): `Module`, `getModuleMetadata`의 실제 공개 경로와 선언 관찰.
- [`@fluojs/prisma` README](../../packages/prisma/README.ko.md): 등록, `current()`, 트랜잭션과 종료 소유권.
- [Prisma 등록 구현](../../packages/prisma/src/module.ts), [등록 옵션 타입](../../packages/prisma/src/types.ts), [등록 테스트](../../packages/prisma/src/module.test.ts): 기본 비전역 등록, 서비스 토큰, `strictTransactions` 근거.
- [공통 집필·데이터 계약](../EDITORIAL.ko.md), [확정 시리즈 목차](../series.json): 같은 블로그의 연속성과 실행 환경.

[이전: 1권 · 첫 출시와 첫 운영 회고](../01-fluoblog/ch24-first-release.ko.md) · [2권 목차](./toc.ko.md) · [다음: 콘텐츠·상품·주문의 경계 나누기](./ch02-domain-boundaries.ko.md)
