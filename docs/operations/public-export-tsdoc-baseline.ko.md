# Public Export TSDoc 기준선

<p>
  <a href="./public-export-tsdoc-baseline.md">English</a> | <strong>한국어</strong>
</p>

이 문서는 `@fluojs/*` 패키지에서 변경되는 public export에 적용할 소스 레벨 TSDoc 최소 기준을 정의합니다. 이후 패키지군별 확장 작업 전에 IDE hover 도움말, 코드 리뷰 기대치, 패키지 README 예제를 같은 기준으로 맞추기 위한 출발점입니다.

## 이 문서가 중요한 경우

- **공개 API 작성**: `packages/*/src` 아래의 exported function, class, interface, type, enum, const를 추가하거나 변경할 때.
- **패키지군 문서화 wave**: 이번 baseline 이후 패키지별로 rich TSDoc 범위를 넓혀갈 때.
- **PR 리뷰**: 변경된 export가 다운스트림 기여자에게 충분한 설명력을 갖췄는지 점검할 때.

---

## 최소 기준

변경된 모든 public export는 반드시 다음을 포함해야 합니다.

- 계약을 평이한 언어로 설명하는 한 줄 이상의 summary.
- 이름이 있는 각 함수 파라미터에 대한 `@param`.
- `void`가 아닌 exported function 반환값에 대한 `@returns`.

다음 태그는 런타임 의미를 분명히 할 때 강하게 권장되지만, 초기 자동 게이트의 필수 항목은 아닙니다.

- 호출자가 처리해야 할 계약 수준의 오류나 실패 상태를 설명하는 `@throws`.
- hover 문서만으로는 사용법이 추상적으로 느껴지는 1급 진입점, 데코레이터, 팩토리 helper를 위한 `@example`.
- summary에 넣기엔 장황한 주의사항, 라이프사이클 메모, 동작 맥락을 설명하는 `@remarks`.

## 소스 `@example` 와 README 예제의 역할 분담

- **소스 `@example`** 블록은 짧고 hover 친화적으로 유지합니다. 즉, “이 심볼을 어떻게 올바르게 호출하나?”에 답합니다.
- **README 예제**는 시나리오 중심으로 유지합니다. 즉, “이 기능이 패키지 워크플로우 안에서 어떻게 쓰이나?”에 답합니다.
- 라이프사이클 보장, 런타임 불변식, 의도된 제한사항은 README에서 빼지 않습니다. 이 내용은 behavioral contract 표면에 계속 남아 있어야 합니다.

---

## 골든 예제

작성 스타일은 다음 레포 내부 예제를 우선 기준으로 삼으세요.

- `packages/graphql/src/dataloader/dataloader.ts`: 1급 팩토리를 위한 summary + `@example` + `@param` + `@returns` 조합.
- `packages/cache-manager/src/decorators.ts`: 간결한 데코레이터 summary와 안정적인 `@param` / `@returns` 문구.
- `packages/di/src/container.ts`: 컨테이너 라이프사이클 연산에 대한 behavioral `@throws` 문서화.
- `packages/graphql/README.md`, `packages/cache-manager/README.md`, `packages/di/README.md`: 소스 hover 문서를 보완하는 시나리오 중심 README 예제.

## 작성 체크리스트

- [ ] 변경한 모든 public export에 소스 레벨 summary가 있다.
- [ ] exported function의 각 named parameter가 `@param`으로 문서화되어 있다.
- [ ] `void`가 아닌 반환형을 가진 exported function이 `@returns`를 문서화한다.
- [ ] 호출자 관점에서 중요한 실패 동작은 `@throws`로 드러난다.
- [ ] entry-point API는 hover 문서만으로 부족할 때 짧은 `@example`을 추가한다.
- [ ] 패키지 README 예제는 여전히 시나리오 중심이며, 변경된 API의 워크플로우 수준 사용법을 보여준다.

## 자동화

- `pnpm lint`는 이제 `pnpm verify:public-export-tsdoc`를 함께 실행합니다.
- 게이트는 `packages/*/src` 아래 변경 파일만 대상으로 하므로, repo-wide rollout을 패키지군 단위로 현실적으로 진행할 수 있습니다.
- re-export barrel은 자동 검사에서 제외되며, 실제 심볼이 정의된 위치에 문서를 작성해야 합니다.

## 관련 문서

- [Contributing](../../CONTRIBUTING.md)
- [Release Governance](./release-governance.ko.md)
- [Behavioral Contract Policy](./behavioral-contract-policy.ko.md)
