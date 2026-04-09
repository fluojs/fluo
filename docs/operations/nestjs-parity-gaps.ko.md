# NestJS 기능 격차 (NestJS Parity Gaps)

<p>
  <strong>한국어</strong> | <a href="./nestjs-parity-gaps.md">English</a>
</p>

이 문서는 Konekti와 NestJS 간의 기능적 및 아키텍처적 차이를 추적합니다. **표준 기반, 메타데이터 없음**이라는 Konekti의 핵심 철학을 유지하면서 기능적 동등성(Parity)을 달성하기 위한 전략적 로드맵 역할을 합니다.

## 이 문서가 필요한 경우

- **마이그레이션 계획**: NestJS 애플리케이션을 Konekti로 포팅할 때의 실현 가능성을 평가할 때.
- **전략적 개발**: 핵심 프레임워크의 새로운 기능 개발 우선순위를 정할 때.
- **생태계 확장**: 호환성 계층이나 제3자 어댑터를 작성할 때.

---

## 활성 기능 격차 (Active Functional Gaps)

우리는 프로덕션 워크플로우에 미치는 영향에 따라 격차를 분류합니다.

### 1단계: 생태계 격차
- **안정성 성숙도**: Konekti는 현재 `0.x` 안정화 단계에 있습니다. 대규모 기업 채택을 위해서는 `1.0` (LTS)으로의 전환이 가장 큰 과제입니다.
- **공개 쇼케이스**: 프로덕션 사용자의 사례 및 커뮤니티에서 기여한 "Konekti Awesome" 목록과 같은 공개 쇼케이스가 부족합니다.

### 2단계: 개발자 경험 (DX)
- **CLI 범위**: NestJS는 다양한 스키매틱(Schematic) 생성기(예: `nest g res`)를 제공합니다. Konekti의 CLI는 현재 `new`, `build`, `repo` 슬라이스에 집중하고 있습니다.
- **하이브리드 애플리케이션 사용성**: `@konekti/microservices`에는 이미 기본 전송 계층과 문서화된 어댑터가 제공됩니다(참고: [package-surface.ko.md](../reference/package-surface.ko.md), [`packages/microservices/README.ko.md`](../../packages/microservices/README.ko.md)). 현재 남아 있는 격차는 gRPC/RabbitMQ 지원 부재가 아니라, NestJS식 하이브리드 애플리케이션 조합 방식과 관련 DX입니다.

---

## 해결된 격차 및 철학적 차이

Konekti는 TC39 표준을 준수하기 위해 일부 영역에서 NestJS와 의도적으로 차별화됩니다.

| 기능 | Konekti 입장 | NestJS 입장 |
| :--- | :--- | :--- |
| **데코레이터** | 표준 TC39 Stage 3 사용. | 레거시 리플렉션 (Experimental). |
| **DI 해석** | 명시적 토큰 및 클래스 사용. | 리플렉션 기반 (`reflect-metadata`). |
| **유효성 검사** | 표준 기반 (Zod, Valibot). | 클래스 기반 (`class-validator`). |
| **독립형 모드** | 네이티브 및 경량 구현. | 보조 부트스트랩 모드. |

### 최근 해결된 격차
- **[2026-03] 독립형 애플리케이션 컨텍스트**: `@konekti/runtime`에 배포됨.
- **[2026-02] 스키마 기반 유효성 검사**: 모든 HTTP 런타임에서 Standard Schema 지원 구현됨.
- **[2025-11] 마이크로서비스 베이스 및 전송 어댑터**: `@konekti/microservices`에 기본 전송 계층과 1차 전송 어댑터가 배포됨.

---

## 유지 관리 정책

1.  **격차 해결**: 격차가 해결되면 **해결된 격차** 표로 이동하고 해당 패키지의 `README.md`를 업데이트합니다.
2.  **격차 추가**: 새로운 격차는 먼저 **GitHub Issue**로 등록한 다음, 장기 추적을 위해 여기에 반영해야 합니다.
3.  **철학적 분리**: 의도적으로 피하는 NestJS 기능(예: "Experimental Decorators")이 있다면 **철학적 차이** 섹션에 문서화해야 합니다.

---

## 관련 문서
- [릴리스 거버넌스 (Release Governance)](./release-governance.ko.md)
- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [NestJS에서 마이그레이션](../getting-started/migrate-from-nestjs.ko.md)
