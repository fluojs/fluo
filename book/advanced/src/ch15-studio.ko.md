<!-- packages: @fluojs/studio, @fluojs/runtime, @fluojs/cli -->
<!-- project-state: FluoBlog v0 -->

# Chapter 15. Studio — 시각적 진단과 관찰성

## What You Will Learn in This Chapter
- 개발 생명주기에서 `@fluojs/studio`의 역할
- `fluo inspect`를 이용한 플랫폼 스냅샷 생성 및 파싱
- `PlatformShellSnapshot` 및 `PlatformDiagnosticIssue` 계약의 이해
- 의존성 그래프 시각화를 위한 Studio Viewer 사용법
- 초기화 병목 현상 및 프로바이더 진단 시나리오 해결 방법

## Prerequisites
- fluo 모듈 시스템 및 의존성 주입에 대한 친숙함
- fluo CLI 명령어에 대한 이해
- JSON 및 웹 기반 시각화 도구에 대한 기초 지식

## 15.1 Beyond the Terminal: Why Studio?

애플리케이션이 커질수록 의존성 그래프는 머릿속에 담아두기에는 너무 복잡해집니다. 순환 의존성, 스코프 불일치, 프로바이더 해석 실패 등은 터미널 로그만으로는 추적하기가 점점 더 어려워집니다.

**@fluojs/studio**는 이러한 복잡성에 대한 fluo의 해답입니다. 애플리케이션의 내부 상태에 대해 시각적이고 실행 가능한 개요를 제공하도록 설계된 파일 우선(File-first) 공유 플랫폼 스냅샷 뷰어입니다.

무거운 APM(Application Performance Monitoring) 도구와 달리, Studio는 **정적 및 부트스트랩 타임 아키텍처**에 집중합니다. 단순히 "왜 지금 느린가"가 아니라 "왜 시작되지 않았는가"를 찾을 수 있도록 도와줍니다.

## 15.2 The Studio Ecosystem

Studio는 세 가지 주요 계층으로 구성됩니다.

1. **생성자(Producer)**: 모듈 그래프를 탐색하고 JSON 스냅샷을 내보내는 `fluo inspect` 명령어(`@fluojs/cli`의 일부)입니다.
2. **계약(Contracts)**: 스냅샷 및 타이밍 데이터에 대한 스키마와 검증 로직을 제공하는 `@fluojs/studio/contracts` 서브패스입니다.
3. **뷰어(Viewer)**: 이러한 스냅샷을 로드하고 탐색하기 위한 React/Vite 기반 웹 인터페이스인 `@fluojs/studio/viewer` 패키지입니다.

## 15.3 Generating Snapshots with `fluo inspect`

Studio와 상호작용하는 기본 방법은 애플리케이션의 스냅샷을 생성하는 것입니다.

```bash
fluo inspect ./src/app.module.ts --json > platform-state.json
```

이 명령어는 프로바이더가 해석되고 그래프가 구축되지만 실제 서버가 리스닝을 시작하지 않는 특수한 "검사 모드(Inspection mode)"로 fluo 런타임을 호출합니다. 결과 JSON에는 다음이 포함됩니다.
- 등록된 모든 컴포넌트(모듈, 컨트롤러, 프로바이더)
- 전체 의존성 매핑
- 상태(Health) 및 준비성(Readiness) 상태
- 단계별 상세 부트스트랩 타이밍

## 15.4 Understanding the Snapshot Contract

CLI에서 내보낸 데이터는 `packages/studio/src/contracts.ts`에 정의된 `PlatformShellSnapshot` 계약을 따릅니다.

### PlatformShellSnapshot Structure

```typescript
export interface PlatformShellSnapshot {
  generatedAt: string;
  readiness: { status: 'ready' | 'not-ready' | 'degraded'; critical: boolean };
  health: { status: 'healthy' | 'unhealthy' | 'degraded' };
  components: PlatformComponent[];
  diagnostics: PlatformDiagnosticIssue[];
}
```

### PlatformDiagnosticIssue: The Heart of Troubleshooting

각 진단 이슈는 구성 오류를 수정하는 데 도움이 되는 실행 가능한 메타데이터를 제공합니다.

```typescript
export interface PlatformDiagnosticIssue {
  code: string;           // 예: "FL0042"
  severity: 'error' | 'warning' | 'info';
  componentId: string;    // 실패한 컴포넌트
  message: string;        // 사람이 읽을 수 있는 설명
  cause?: string;         // 근본 원인 분석
  fixHint?: string;       // 명시적인 제안: "X에 @Injectable()을 추가하세요"
  dependsOn?: string[];   // 해석을 방해하는 차단 요소들
}
```

## 15.5 Using the Studio Viewer

Studio Viewer는 독립 실행형 웹 애플리케이션입니다. 모노레포 내에서 로컬로 실행하거나 공개된 버전을 사용할 수 있습니다.

```bash
pnpm --dir packages/studio dev
```

뷰어가 열리면 `platform-state.json` 파일을 브라우저로 드래그 앤 드롭하기만 하면 됩니다.

### Key Features of the Viewer

- **그래프 뷰(Graph View)**: 애플리케이션을 Mermaid 기반 의존성 다이어그램으로 렌더링합니다. 어떤 서비스가 어떤 레포지토리에 의존하는지 한눈에 볼 수 있습니다.
- **진단 탭(Diagnostics Tab)**: 모든 `PlatformDiagnosticIssue` 항목을 나열합니다. 심각도별로 그룹화하고 컴포넌트별로 필터링할 수 있습니다.
- **타이밍 탭(Timing Tab)**: 부트스트랩 시퀀스를 시각화하여 각 단계(모듈 그래프 구축, 인스턴스 해석, 생명주기 훅 등)가 몇 밀리초씩 걸렸는지 정확히 보여줍니다.

### Visualizing Scopes and Lifecycles

Studio의 가장 강력한 측면 중 하나는 프로바이더 스코프(Scope)를 시각화하는 능력입니다. 복잡한 애플리케이션에서는 실수로 Request 스코프 프로바이더를 Singleton 스코프 프로바이더에 주입하여 런타임 오류나 메모리 누수를 유발하기 쉽습니다.

Studio는 컴포넌트 상세 뷰에서 이러한 스코프 불일치를 표시합니다. 컴포넌트를 선택하면 해석된 스코프와 의존성 체인의 잠재적인 위반 사항을 확인할 수 있습니다.

또한 뷰어는 각 컴포넌트에 대한 "생명주기 추적(Lifecycle Trace)"을 제공하여, 언제 인스턴스화되었고 다양한 훅(`onModuleInit`, `onApplicationBootstrap` 등)이 언제 실행되었는지 보여줍니다. 이는 코드만으로는 보이지 않는 초기화 순서 문제를 디버깅하는 데 매우 유용합니다.

스코프 시각화와 생명주기 추적을 결합함으로써, Studio는 fluo 런타임 내에서 애플리케이션 컴포넌트가 어떻게 살아가고 상호작용하는지에 대한 전체적인 그림을 제공합니다.

## 15.6 Scenario: Diagnosing a Provider Deadlock

애플리케이션이 시작 중에 멈췄다고 가정해 봅시다. Studio에서 스냅샷을 검사하면 진단 탭에서 "순환 의존성(Circular Dependency)" 오류를 발견할 수 있습니다.

1. **확인(Identify)**: Studio는 문제가 되는 컴포넌트를 빨간색으로 표시합니다.
2. **분석(Analyze)**: `dependsOn` 필드는 순환 고리를 보여줍니다: `ServiceA -> ServiceB -> ServiceA`.
3. **수정(Fix)**: `fixHint`는 `forwardRef()`를 사용하거나 공통 로직을 제3의 서비스로 리팩토링할 것을 제안할 수 있습니다.

## 15.7 Programmatic Consumption of Snapshots

커스텀 CI/CD 도구를 구축하는 경우, `@fluojs/studio`를 라이브러리로 사용하여 스냅샷을 파싱하고 검증할 수 있습니다.

```typescript
import { parseStudioPayload, applyFilters } from '@fluojs/studio';
import { readFileSync } from 'node:fs';

const raw = readFileSync('platform-state.json', 'utf8');
const { payload } = parseStudioPayload(raw);

if (payload.snapshot) {
  const errors = applyFilters(payload.snapshot, {
    query: '',
    readinessStatuses: [],
    severities: ['error']
  });
  
  if (errors.diagnostics.length > 0) {
    console.error('플랫폼에 심각한 문제가 있습니다!');
  }
}
```

## 15.8 Mermaid Export for Documentation

Studio를 사용하면 시각적 그래프를 Mermaid 텍스트로 내보낼 수 있습니다. 이는 직접 그리지 않고도 `README.md`나 Notion 페이지에 최신 아키텍처 문서를 유지하는 데 매우 유용합니다.

`renderMermaid(snapshot)` 헬퍼는 유효하고 읽기 쉬운 그래프 구조를 보장하기 위해 이스케이프 처리 및 노드 해싱을 수행합니다.

### Studio as an Architecture Guard

Studio 스냅샷은 대화형 도구로 사용하는 것 외에도 CI/CD 파이프라인에 아키텍처 가드(Architecture Guard)로 통합될 수 있습니다. `PlatformShellSnapshot`을 프로그래밍 방식으로 분석함으로써 린터(Linter)만으로는 확인하기 어려운 규칙을 강제할 수 있습니다.

예를 들어, `billing` 모듈의 서비스가 `inventory` 모듈의 레포지토리에 의존하는 경우 빌드를 실패하게 만드는 스크립트를 작성하여 엄격한 도메인 격리를 보장할 수 있습니다.

```typescript
// 아키텍처 가드 스크립트 예시
const snapshot = loadSnapshot('platform-state.json');
const violations = snapshot.components.filter(c => 
  c.id.startsWith('Billing') && 
  c.dependencies.some(d => d.startsWith('InventoryRepository'))
);

if (violations.length > 0) {
  process.exit(1);
}
```

fluo의 투명한 메타데이터를 활용한 이러한 "코드로서의 정책(Policy as Code)" 접근 방식은 대규모 TypeScript 프로젝트에 새로운 수준의 거버넌스를 제공합니다. 더 이상 관례에 의존하지 않고 그래프 구조를 직접 강제하게 됩니다.

### Future Directions: Live Studio

현재 버전의 Studio는 스냅샷에 의존하는 파일 우선 방식입니다. 그러나 기본 계약은 라이브 업데이트를 지원하도록 설계되었습니다. 향후 fluo 런타임 버전에서는 Studio가 실행 중인 프로세스에 연결할 수 있도록 진단 소켓을 노출할 수 있습니다.

이를 통해 요청 흐름의 실시간 시각화, 디버깅을 위한 프로바이더의 동적 교체, 전체 재시작 없이 구성 변경에 대한 즉각적인 피드백 등이 가능해질 것입니다.

오늘날 Studio 생태계에 투자함으로써, 우리는 미래의 더욱 대화형이고 반응성이 뛰어난 개발 경험을 위한 길을 닦고 있습니다.

## 15.9 Why Line-by-Line Consistency Matters

fluo 프로젝트에서는 영어와 한국어 문서가 동일한 제목(Heading)을 유지해야 한다는 엄격한 정책을 따릅니다. 이는 단순히 미적인 이유가 아닙니다. CI/CD 파이프라인이 자동화된 diff를 수행하여 번역 과정에서 기술적인 섹션이 누락되지 않았는지 확인할 수 있도록 하기 위함입니다.

이 파일의 모든 제목은 한국어 버전의 섹션과 정확히 일치합니다. 이러한 관행을 따름으로써 서로 다른 언어 간에도 기술적 정확성과 조직적 명확성이 유지되도록 보장합니다.

이러한 일관성은 Studio 진단 자체에도 매우 중요합니다. Studio 이슈는 종종 문서 URL로 매핑되므로, 안정적이고 동기화된 제목 구조를 가짐으로써 프레임워크가 영어 및 한국어 독자 모두에게 정확한 링크를 제공할 수 있게 됩니다.

오류 코드를 찾거나 특정 시각화 기능에 대해 읽을 때, 모든 언어 버전의 책에서 해당 정보가 동일한 위치에 있음을 확신할 수 있습니다.

## Summary

Studio는 DI 컨테이너의 "블랙박스"를 투명하고 시각적인 지도로 변환합니다. 스냅샷, 진단 및 타이밍 데이터를 활용하면 의존성이 실패한 이유를 추측하는 대신 정확한 차단 요소와 제안된 해결책을 직접 확인할 수 있습니다.

시각적 검사를 통해 모듈 구조가 설계 의도와 일치하는지 확인할 수 있습니다. 컨트롤러가 올바른 모듈에 부착되었는지, 프로바이더가 기대한 대로 싱글톤으로 공유되고 있는지 등을 Studio가 제공하는 증거를 통해 확인할 수 있습니다.

효과적인 진단은 신입 개발자의 피드백 루프도 단축시킵니다. 모듈 그래프의 모든 세부 사항을 가르치는 대신, Studio 뷰어를 통해 스스로 시스템을 탐색하게 할 수 있습니다.

또한 Mermaid로 내보내는 기능을 통해 문서가 코드베이스의 살아있는 일부로 유지되도록 할 수 있습니다. 실제 구현과 일치하지 않는 오래된 아키텍처 다이어그램은 이제 더 이상 필요하지 않습니다.

생태계가 성숙해짐에 따라 이러한 표준 스냅샷을 기반으로 하는 더 많은 도구가 등장하여, 다양한 환경과 조직 규모에서 fluo 애플리케이션의 관찰성을 더욱 향상시킬 것으로 기대합니다.

고성능 백엔드를 구축하려면 효율적인 코드 이상의 것이 필요합니다. 코드가 어떻게 조직화되어 있고 그 조각들이 어떻게 상호작용하는지에 대한 깊은 이해가 필요합니다. Studio는 소스 코드와 런타임 동작 사이의 잃어버린 고리를 제공합니다.

스냅샷 형식을 표준화함으로써 다양한 시각화 도구가 공존할 수 있게 되었습니다. 한 팀은 Mermaid 기반의 그래프를 선호할 수 있고, 다른 팀은 3D 의존성 탐색기나 정적 그래프 위에 실시간 메트릭을 오버레이하는 모니터를 개발할 수도 있습니다.

Studio의 목표는 단순히 현재 상태를 보여주는 것이 아니라, 더 나은 아키텍처 결정을 내리도록 안내하는 것입니다. 명시적인 의존성 관리, 명확한 컴포넌트 경계, 관찰 가능한 생명주기는 잘 설계된 fluo 애플리케이션의 특징입니다.

앞으로 나아가면서 진단 워크플로우에 "Studio 우선" 사고방식을 유지하시기 바랍니다. 복잡한 구성 문제에 부딪힐 때마다 `fluo inspect`를 활용하고 시각적 데이터가 문제 해결을 안내하도록 하십시오.

이 시리즈의 마지막 부분에서는 커스텀 패키지를 만들고 프레임워크에 기여함으로써 fluo 생태계 자체를 확장하는 방법을 살펴보겠습니다.
