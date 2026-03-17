# 매니페스트 전략 결정

<p><a href="./manifest-decision.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


컴파일 타임 매니페스트 생성은 기본 아키텍처가 아닌, 여전히 최적화 결정을 위한 선택 사항으로 취급됩니다.

## 현재 결정

현재 상태: `보류(defer)`

이유:

- 런타임에 이미 측정 가능한 부트스트랩 기준선이 존재함
- 컴파일 타임 매니페스트 경로는 도구, 문서 및 생성기 복잡성을 증가시킴
- 이러한 복잡성을 감수할 만큼 초기 구동이나 등록 성능이 유의미하게 개선된다는 벤치마크 증거가 있을 때 도입해야 함

## 벤치마크 산출물

아래 벤치마크 하네스를 사용하여 현재 런타임 기준선을 측정하세요:

```sh
pnpm exec tsx tooling/benchmarks/manifest-decision.ts
```

이 하네스는 다음 항목을 포함합니다:

- `hello-world`
- `medium-rest`
- `module-heavy`

`pnpm exec tsx tooling/benchmarks/manifest-decision.ts` 실행 결과 현재 2026-03-12 기준선:

- `hello-world`: 평균 부트스트랩 `0.35ms`
- `medium-rest`: 평균 부트스트랩 `0.48ms`
- `module-heavy`: 평균 부트스트랩 `0.47ms`

해당 실행의 스냅샷은 `tooling/benchmarks/manifest-decision.latest.json`에 저장되어 있습니다.

## 도입 기준

약 `~20%` 정도의 개선이 있을 경우 도입을 검토하되, 이를 자동적인 규칙으로 삼지는 않습니다. 도입 여부는 다음 사항들을 종합적으로 고려해야 합니다:

- 부트스트랩/초기 구동 시간
- 라우트 및 모듈 등록 시간
- 메모리 비용
- 빌드/툴체인 비용
- 생성기 및 문서 유지 관리 부담

## parity 규칙

- runtime helper reads는 semantic source of truth로 유지됩니다.
- manifest 기반 최적화는 route metadata, module graph 동작, provider registration, DTO binding metadata, diagnostics에 대한 parity를 보존해야 합니다.
- benchmark 이득만으로는 충분하지 않고, parity 근거가 더 중요합니다.
