# Behavioral Contract Rules

<p><a href="./behavioral-contract-policy.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Behavioral contract는 패키지 `README.md`, contract 문서, 패키지 단위 테스트 기대치에 기록된 구속력 있는 런타임 약속입니다. 타입은 형태를 설명합니다. Behavioral contract는 실행 순서, 부수 효과, 실패 방식, 생명주기 보장, 종료 동작을 설명합니다.

## Rule 1: Contract Preservation

- 문서에 기록된 모든 런타임 보장은 유지 대상 contract로 취급해야 합니다.
- contract 동작이 바뀌면 구현, 문서, 테스트를 함께 갱신해야 합니다.
- 패키지 `README.md`와 한국어 미러에는 지원 작업, 생명주기 보장, 런타임 invariant, 의도된 제한을 계속 맞춰 유지해야 합니다.
- 문서화된 실행 순서, 발생 오류, 정리 의미론, adapter 동작, readiness 동작을 조용히 바꾸는 변경은 병합하면 안 됩니다.
- 공개 런타임 surface를 가진 패키지는 문서화된 동작을 실행하는 테스트를 최소 하나 이상 유지해야 합니다.

Behavioral contract의 예시는 다음과 같습니다.

- 데코레이터가 모듈 초기화 전에 실행된다.
- provider가 필수 입력이 없을 때 configuration error를 던진다.
- platform adapter가 종료 중 idle keep alive connection을 닫는다.
- config reload manager가 겹치는 reload 요청을 직렬화하고 reload listener 실패 시 이전 snapshot으로 롤백한다.

## Rule 2: Breaking Change Policy

- `0.x`에서는 breaking behavioral change를 minor release에서만 배포할 수 있고, 릴리스에는 `CHANGELOG.md` migration note가 포함되어야 합니다.
- `1.0+`에서는 breaking behavioral change가 major version bump를 반드시 유발해야 합니다.
- 동작을 유지하려면 사용자 쪽 설정, bootstrap 순서, adapter 사용법, 공개 API 기대치를 바꿔야 하는 경우 minor나 patch로 분류하면 안 됩니다.
- intended publish surface에 있는 패키지의 동작 파괴 변경은 release governance 갱신과 함께 다뤄야 합니다.

릴리스 분류와 릴리스 게이트는 저장소 release workflow로 강제됩니다.

```bash
pnpm verify:release-readiness
```

## Rule 3: Environment Isolation

- 일반 패키지 source는 `process.env`를 직접 읽으면 안 됩니다.
- 설정은 애플리케이션 경계에서, 보통 `@fluojs/config`를 통해 패키지 코드로 들어와야 하며, 이후 명시적 매개변수, 주입 서비스, 타입화된 module option으로 전달되어야 합니다.
- CLI bootstrap과 scaffold 코드는 거버넌스 스크립트가 문서화한 예외입니다. 패키지 내부 코드는 예외가 아닙니다.
- platform 패키지도 같은 isolation 경계를 지켜야 합니다. 올바른 adapter 입력 대신 `@fluojs/config`를 우회하면 안 됩니다.

권장 패턴:

```ts
ConfigModule.forRoot({
  processEnv: process.env,
});
```

패키지 source 내부에서는 다음 패턴을 피해야 합니다.

```ts
const secret = process.env.JWT_SECRET;
```

## Enforcement

contract governing 문서나 governed package behavior를 바꿀 때는 다음 저장소 게이트를 실행해야 합니다.

```bash
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm vitest run tooling/governance/verify-platform-consistency-governance.test.ts
```

이 체크들은 규칙을 다음처럼 구체적으로 강제합니다.

1. `pnpm verify:platform-consistency-governance`는 이 문서 쌍과 다른 governance SSOT 문서의 EN/KO heading parity를 검사합니다.
2. 같은 governance 스크립트는 일반 패키지 source의 직접 `process.env` 접근을 거부하고 위반 파일과 줄 번호를 보고합니다.
3. `pnpm verify:release-readiness`는 release verification 중 governance gate를 재사용하므로 contract 문서와 release evidence가 같이 유지됩니다.
4. 패키지 테스트 스위트는 문서화된 behavioral guarantee를 커버해야 하며, 회귀가 있으면 release 전에 실패해야 합니다.

## Related Docs

- [Release Governance](./release-governance.ko.md)
- [Third-Party Extension Contract](./third-party-extension-contract.ko.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.ko.md)
- [Testing Guide](./testing-guide.ko.md)
