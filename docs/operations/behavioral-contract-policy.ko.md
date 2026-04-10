# 동작 계약 정책 (Behavioral Contract Policy)

<p>
  <strong>한국어</strong> | <a href="./behavioral-contract-policy.md">English</a>
</p>

이 정책은 fluo 프레임워크 내에서 동작 계약을 보존하기 위한 거버넌스와 규칙을 정의합니다. 코드 변경이 문서화된 런타임 기대치, 부수 효과 또는 생명주기 보장을 암묵적으로 파괴하지 않도록 보장합니다.

## 이 문서가 필요한 경우

- **코어 리팩토링**: 기존 `@fluojs/*` 패키지나 내부 런타임 로직을 수정할 때.
- **API 작성**: 새로운 공개 데코레이터, 프로바이더 또는 플랫폼 어댑터를 도입할 때.
- **문서화**: 패키지 수준의 `README.md` 파일이나 운영 가이드를 작성하거나 업데이트할 때.
- **풀 리퀘스트(PR) 검토**: 관리자가 계약 준수 여부를 확인하기 위한 주요 체크리스트로 활용할 때.

---

## 정책 정의 (Policy Definition)

### 1. 동작 계약이란 무엇인가?
동작 계약은 패키지의 런타임 동작에 대해 문서화된 약속입니다. TypeScript 타입이 **인터페이스**(무엇이 들어가고 나가는지)를 정의한다면, 동작 계약은 **의미론(Semantics)**(구현이 어떻게 동작하는지)을 정의합니다.

**계약의 예시:**
- "이 데코레이터는 항상 모듈이 초기화되기 전에 평가됩니다."
- "이 프로바이더는 `API_KEY`가 누락된 경우 `ConfigurationError`를 던집니다."
- "이 어댑터는 종료 신호를 받은 후 5초 이내에 모든 유휴 keep-alive 연결을 닫습니다."

### 2. 문서화 요구사항
모든 `@fluojs/*` 패키지는 `README.md`(및 한국어 미러)에 다음 사항을 반드시 유지해야 합니다.
- **지원되는 작업**: 공개 메서드 및 데코레이터의 상세한 의미론.
- **런타임 불변성**: 플랫폼(Node.js, Bun, Deno) 간에 일관되게 유지되어야 하는 동작.
- **생명주기 보장**: 초기화, 정리 및 정상 종료에 대한 명시적인 동작.
- **의도적인 제한**: 실수로 기능이 비대해지는 것을 방지하기 위해 명시적으로 문서화된 "비목표(non-goals)".

---

## 거버넌스 규칙 (Governance Rules)

### 규칙 1: 계약 보존 (Contract Preservation)
패키지의 README나 운영 문서에 명시된 모든 동작은 구속력 있는 계약으로 간주됩니다. **파괴적 변경 정책**을 따르지 않고 이 동작을 수정하는 것은 이 거버넌스를 위반하는 것입니다.

### 규칙 2: 파괴적 변경 정책 (Breaking Change Policy)
- **0.x 단계**: 파괴적 변경은 **마이너(Minor)** 릴리스(`0.X.0`)에서 허용되지만, 반드시 `CHANGELOG.md`에 마이그레이션 노트를 동반해야 합니다.
- **1.0+ 단계**: 파괴적 변경은 마이너/패치 릴리스에서 엄격히 금지되며, 반드시 종합적인 마이그레이션 가이드와 함께 **메이저(Major)** 버전 업데이트를 트리거해야 합니다.

### 규칙 3: 환경 격리 (Environment Isolation)
패키지는 `process.env`에 직접 액세스해서는 안 됩니다. 모든 환경 기반 구성은 애플리케이션 경계(일반적으로 `@fluojs/config`)를 통해 시스템에 유입되어야 하며, 명시적인 매개변수나 주입된 옵션으로 전달되어야 합니다.

---

## 강제 사항 (Enforcement)

fluo는 준수 여부를 보장하기 위해 자동화된 게이트를 사용합니다.
1.  **구조적 동등성**: 영어와 한국어 문서 구조가 틀어질 경우 `pnpm verify:platform-consistency-governance`가 실패합니다.
2.  **액세스 제어**: 정적 분석 도구가 코어 패키지 내에서의 직접적인 `process.env` 액세스를 차단합니다.
3.  **회귀 테스트**: 문서화된 모든 계약은 패키지의 테스트 스위트에 대응하는 테스트 케이스로 뒷받침되어야 합니다.

---

## 관련 문서
- [릴리스 거버넌스 (Release Governance)](./release-governance.ko.md)
- [제3자 확장 기능 계약 (Third-Party Extension Contract)](./third-party-extension-contract.ko.md)
- [플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)](./platform-conformance-authoring-checklist.ko.md)
- [테스트 가이드 (Testing Guide)](./testing-guide.ko.md)
