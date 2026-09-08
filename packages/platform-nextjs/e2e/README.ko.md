# Next compiler 회귀 fixture

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 fixture는 현재 checkout의 배포 파일과 공개 export만 사용합니다.
새로 publish한 package의 검증이 아닙니다. Node.js `>=24.0.0 <27`,
독립적으로 설치한 worktree dependencies와 affected dependency closure build가
필요합니다. 저장소 root에서 실행하세요.

```bash
pnpm --filter '@fluojs/platform-nextjs...' build
pnpm --filter @fluojs/platform-nextjs test:e2e
```

기본 실행은 worktree에 설치된 Next 16을 사용합니다. 다른 Next 버전은 같은
worktree의 무시되는 디렉터리에 설치할 수 있습니다. Next와 React renderer가
서로 다른 React를 로드하지 않도록 세 package를 같은 설치에서 가져옵니다.

```bash
mkdir -p .omo/next-16.3
pnpm --dir .omo/next-16.3 add --ignore-workspace next@16.3.4 react@19.2.7 react-dom@19.2.7
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" pnpm --filter @fluojs/platform-nextjs test:e2e
```

같은 방식으로 `next@16.0.0`을 별도 `.omo/next-16.0`에 설치하여 peer 범위의
하한을 실행할 수 있습니다. 모든 16.x patch를 검증했다고 해석하지 마세요.
`FLUO_E2E_NEXT_ROOT`는 worktree 안에 있어야 합니다.

## 자동 회귀

- App Router와 Pages Router의 decorated server controller/field DTO,
  GET과 JSON POST, cookie conversion, malformed JSON/404를 실제 HTTP로 검증합니다.
- `'use client'` TypeScript store를 server page에서 import합니다. 주석의
  `@store`는 기존 content 조건에 의도적으로 일치합니다. HTML의
  `<output id="store">FLUO_SSR_STORE_OK</output>`을 dev와 build/start에서 확인합니다.
- Production build가 backend를 시작하지 않는지, 동시 첫 GET이 bundle마다
  하나의 bootstrap을 공유하는지, SSE와 실패 시 cleanup이 완료되는지 검증합니다.
- Next build는 `next-config.types.ts`로 배포된 public option 타입을 검사합니다.
  Rule 순서·비변이·scope 조건은 `src/next-config.test.ts`가 담당합니다.

Consumer config는 helper와 범위 선언만 사용합니다. Custom loader 경로나
`type: 'ecmascript'` 규칙은 작성하지 않습니다. `preserveModulePaths`는
`as`를 생략하고 원래 `.ts` 경로를 유지합니다.

## 비교 실험

`FLUO_E2E_COMPILER`는 fixture 전용 선택이며 public package API가 아닙니다.

| 값 | Helper 옵션 | 목적 |
| --- | --- | --- |
| 생략 / `scoped` | include + exclude + preserveModulePaths | 권장 scoped 소비자 경로 |
| `scope-only` | include + exclude | 출력 경로 변경 없이 scope를 독립 검증 |
| `preserve` | preserveModulePaths | Scope 없이 경로 보존을 독립 검증 |
| `legacy` | 빈 옵션 | 기존 헬퍼의 SSR import 실패 재현 |

```bash
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" FLUO_E2E_COMPILER=preserve pnpm --filter @fluojs/platform-nextjs test:e2e
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" FLUO_E2E_COMPILER=scope-only pnpm --filter @fluojs/platform-nextjs test:e2e
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" FLUO_E2E_COMPILER=legacy pnpm --filter @fluojs/platform-nextjs test:e2e
```

Next 16.3.4의 legacy 모드는 의도적으로 실패합니다. Dev GET `/`가 500을
반환하고 build가 `Can't resolve './store.ts.js'`로 종료됩니다. Scope만
사용하면 SSR store를 변환하지 않고, 경로 보존만 사용하면 변환된 store도
원래 import 경로로 해석합니다. 이 오류 재현과 scope 옵션의 필요성은 별개의
회귀입니다. 기존 기본값은 호환성을 위해 유지합니다.

각 실행은 고유 `.omo/platform-nextjs-e2e-*` 디렉터리와 ephemeral port를
사용합니다. Readiness/stream 이벤트를 action 전에 구독하고 timeout으로
실패를 제한합니다. Sleep이나 readiness polling은 사용하지 않습니다.
`report.json`과 command log는 유지하고 임시 앱과 서버는 종료합니다.
자동 회귀와 별도의 수동 브라우저/hydration 시연을 혼동하지 마세요.

## Bounded parser regression

같은 fixture는 text/custom route에 공개 `bodyParser` callback을, 기존 JSON/DTO route에는
`context.parseDefault()`를 사용합니다. App/Pages HTTP case는 원래 MIME, 정확한 raw byte,
빈/잘못된/비-JSON body, UTF-8 byte-limit 413, 명시적 인증 후 handler가 소유한 JSON 해석을
비교합니다. Request 재구성이나 header 재작성은 사용하지 않습니다. 기존 HEAD, SSE,
compiler, lifecycle case도 이 parser 설정에서 계속 실행합니다.
