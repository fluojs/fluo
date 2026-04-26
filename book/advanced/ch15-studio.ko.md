<!-- packages: @fluojs/studio, @fluojs/runtime, @fluojs/cli -->
<!-- project-state: FluoBlog v0 -->

# Chapter 15. Studio: Visual Diagnostics and Observability

이 장은 런타임이 만든 모듈 그래프 snapshot, 진단, 타이밍 데이터, inspect report를 사람이 읽을 수 있는 artifact로 바꾸는 Studio 생태계를 다룹니다. Chapter 14가 계약 검증으로 런타임 일관성을 확인했다면, 이 장은 그 내부 상태를 내보내고 저장하고 보고 해석하는 도구로 넘어갑니다.

## Learning Objectives

- `@fluojs/studio`가 아키텍처 진단과 관찰성에서 맡는 역할을 이해합니다.
- `fluo inspect`로 런타임 snapshot, report, Mermaid diagram, timing payload를 생성합니다.
- raw JSON 출력, `--report` artifact, `--output` 파일, `--timing` 진단을 구분합니다.
- `PlatformShellSnapshot`과 `PlatformDiagnosticIssue` 계약이 무엇을 담는지 학습 흐름 수준에서 파악합니다.
- Studio가 inspect artifact를 소비하고 검증하고 필터링하고 그래프를 렌더링하는 방식을 살펴봅니다.
- Studio가 소유한 Mermaid 렌더링과 프로그래밍 방식의 artifact 소비로 아키텍처 가드를 구성하는 방법을 정리합니다.

## Prerequisites

- Chapter 14 완료.
- fluo 모듈 시스템과 의존성 주입 해석 흐름에 대한 기본 이해.
- `fluo inspect`를 포함한 fluo CLI 사용 경험.
- JSON, Mermaid, 브라우저 기반 시각화 도구에 대한 기본 감각.

## 15.1 Beyond the Terminal: Why Studio?

애플리케이션이 커질수록 의존성 그래프는 머릿속에 담아두기에는 너무 복잡해집니다. 순환 의존성, scope 불일치, provider 해석 실패, 느린 bootstrap 단계는 터미널 로그만으로 추적하기 어려워집니다. 마이크로서비스 아키텍처에서는 이런 복잡성이 여러 독립 서비스에 걸쳐 커지고, 각 서비스는 자신만의 내부 Module Graph를 가집니다.

`@fluojs/studio`는 이 복잡성을 다루기 위한 fluo의 진단 계층입니다. inspect artifact를 파일로 받아 구조를 검증하고, 팀이 함께 검토할 수 있는 view로 바꿉니다. 다시 말해 DI 컨테이너의 "black box"를 추측의 대상이 아니라 검사할 수 있는 구조로 드러냅니다.

Studio는 정적 및 bootstrap-time 아키텍처에 집중합니다. "왜 이 요청이 느린가"를 묻기 전에 "왜 시작되지 않았는가"를 확인하게 합니다. inspect 데이터는 inspection-safe bootstrap에서 나오므로, 팀은 애플리케이션이 트래픽을 받기 전에 graph shape, readiness, diagnostics, timing을 검토할 수 있습니다.

## 15.2 The Studio Ecosystem

`packages/studio/README.md`에 정의된 inspection 및 Studio 흐름은 세 가지 주요 계층으로 구성됩니다.

1. **Snapshot producer**: fluo Runtime과 platform shell은 inspection-safe bootstrap 중 Module Graph를 컴파일하고 `PlatformShellSnapshot` 데이터를 생산합니다.
2. **CLI exporter/delegator**: `fluo inspect` 명령은 런타임이 생산한 데이터를 JSON으로 직렬화하고, 요청 시 report로 감싸고, `--output`으로 artifact 경로에 쓰며, `--mermaid`가 요청되면 Mermaid 렌더링을 Studio에 위임합니다.
3. **Studio contract and viewer**: `@fluojs/studio` 루트 export, `@fluojs/studio/contracts` subpath, `@fluojs/studio/viewer` entrypoint는 snapshot parsing, filtering, graph rendering, browser viewing을 소유합니다.

이 분리는 중요합니다. Runtime은 진실을 생산합니다. CLI는 artifact shape를 고릅니다. Studio는 viewer와 Mermaid rendering semantics를 소유합니다. CLI는 graph rendering logic을 중복하지 않고, Studio는 애플리케이션을 직접 bootstrap할 필요가 없습니다.

## 15.3 Generating Inspect Artifacts with `fluo inspect`

Studio와 상호작용하는 기본 방법은 root module에서 inspect artifact를 생성하는 것입니다.

```bash
fluo inspect ./src/app.module.ts --json > artifacts/inspect-snapshot.json
```

명시적인 출력 mode가 없으면 `fluo inspect`는 JSON snapshot 출력을 기본값으로 사용합니다. Runtime은 inspection-safe application context를 통해 provider를 해석하고 platform shell을 만든 뒤, CLI가 snapshot을 stdout에 씁니다. 검사 대상 애플리케이션은 inspection을 위해 bootstrap된 뒤 닫힙니다. 서버 listener는 시작하지 않습니다.

CI와 support workflow에서는 shell redirection보다 명시적인 artifact 경로를 사용하는 편이 좋습니다.

```bash
fluo inspect ./src/app.module.ts --json --output artifacts/inspect-snapshot.json
```

`--output <path>`는 선택된 payload를 파일에 쓰고 필요한 parent directory를 만듭니다. 실패한 bootstrap check 이후 CI 시스템이 `artifacts/`를 업로드할 때 유용합니다. 이 옵션은 애플리케이션을 쓰기 가능하게 만들지 않으며, 정상적인 bootstrap 및 close cycle 외에 module graph state를 바꾸지 않습니다.

snapshot 옆에 bootstrap timing이 필요하면 `--timing`을 사용합니다.

```bash
fluo inspect ./src/app.module.ts --json --timing --output artifacts/inspect-with-timing.json
```

summary, 전체 snapshot, diagnostics, timing이 함께 들어 있는 CI-friendly support artifact가 필요하면 `--report`를 사용합니다.

```bash
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json
```

문서화나 review를 위한 text diagram이 필요하면 `--mermaid`를 사용합니다.

```bash
fluo inspect ./src/app.module.ts --mermaid --output artifacts/module-graph.mmd
```

Mermaid 렌더링은 `renderMermaid(snapshot)` 계약을 통해 `@fluojs/studio`에 위임됩니다. 이 출력이 필요하면 명령을 실행하는 프로젝트에 Studio를 설치합니다.

```bash
pnpm add -D @fluojs/studio
```

비대화형 실행에서는 Studio dependency가 없을 때 install guidance와 함께 빠르게 실패합니다. 대화형 실행은 확인을 물을 수 있지만, `fluo inspect`는 패키지를 조용히 설치하지 않습니다.

## 15.4 Understanding the Snapshot and Report Shapes

CLI가 내보내는 데이터는 `@fluojs/runtime`이 생산하고 Studio가 소비하는 계약을 따릅니다. 이 절은 학습 모델을 설명합니다. 필드 단위의 reference 세부 정보는 contract docs와 package README가 맡습니다.

### Raw JSON snapshot

Raw JSON은 가장 작은 Studio 입력입니다. `--json` 또는 기본 inspect mode로 생성됩니다.

```bash
fluo inspect ./src/app.module.ts --json --output artifacts/inspect-snapshot.json
```

payload는 `PlatformShellSnapshot`입니다. 큰 흐름에서 다음 정보를 포함합니다.

- `generatedAt`, snapshot이 생성된 시각.
- `readiness`와 `health`, platform-level status signal.
- `components`, 해석된 graph 안의 modules, controllers, providers, related platform components.
- `diagnostics`, platform shell을 만들거나 검사하는 동안 발견된 구조화된 issue.

Studio는 이 파일을 직접 로드할 수 있습니다. `parseStudioPayload(rawJson)`로 JSON을 파싱하고, 지원하는 version 및 schema expectation을 검증한 뒤, graph, diagnostics, filtering view에 snapshot을 전달합니다.

### Timing envelope

모든 workflow가 bootstrap phase 측정을 필요로 하지는 않으므로 timing data는 opt-in입니다.

```bash
fluo inspect ./src/app.module.ts --json --timing --output artifacts/inspect-with-timing.json
```

`--json --timing`을 사용하면 CLI는 `snapshot`과 `timing` key를 가진 envelope를 씁니다. `timing` 값은 `BootstrapTimingDiagnostics`를 따르며, `totalMs`와 phase list를 포함합니다. Studio는 이 데이터를 사용해 module graph construction, provider resolution, lifecycle hooks 같은 bootstrap 시간이 어디에 쓰였는지 설명할 수 있습니다.

Timing은 변경이 startup을 깨지는 않지만 눈에 띄게 느리게 만들 때 특히 유용합니다. snapshot 옆에 timing을 보관하면 reviewer가 graph shape와 bootstrap cost를 연결해서 볼 수 있습니다.

### Report artifact

Report는 CI triage와 support handoff에 가장 좋은 artifact입니다.

```bash
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json
```

Report는 런타임이 생산한 snapshot을 stable summary와 timing data로 감쌉니다. Summary에는 components, diagnostics, errors, warnings, health, readiness, total timing count가 들어 있습니다. 그래서 CI job이나 reviewer가 전체 graph를 먼저 파싱하지 않아도 기본 질문에 답할 수 있습니다.

Report가 raw snapshot을 대체하는 것은 아닙니다. Report는 support와 automation이 보통 필요로 하는 추가 context와 함께 snapshot을 포장합니다. Studio는 여전히 snapshot 부분을 소비할 수 있고, script는 build를 실패시킬지 ticket에 artifact를 붙일지 결정하기 전에 summary를 먼저 읽을 수 있습니다.

## 15.5 Using the Studio Viewer

Studio Viewer는 독립 실행형 web application입니다. 모노레포 안에서 로컬로 실행하거나, install path가 제공하는 packaged viewer entry를 사용할 수 있습니다.

```bash
pnpm --dir packages/studio dev
```

Viewer가 열리면 inspect artifact를 브라우저로 drag and drop합니다. Raw `--json` snapshot이 가장 단순한 입력입니다. `--json --timing` envelope는 viewer에 timing data도 제공합니다. `--report` artifact는 report를 canonical CI file로 보관하고 그 안의 snapshot 및 timing data를 Studio-aware tool에 전달하는 workflow에서 사용할 수 있습니다.

내부적으로 Studio는 렌더링 전에 `parseStudioPayload(rawJson)`를 사용합니다. 덕분에 viewer는 임의의 JSON을 유효한 platform graph로 취급하지 않습니다. Parsing 이후 Studio는 `applyFilters(snapshot, filter)`로 filter를 적용하고, severity별 diagnostics를 보여주며, CLI의 Mermaid path와 같은 graph ownership model을 통해 graph를 렌더링할 수 있습니다.

### Key Features of the Viewer

- **Graph View**: 애플리케이션 dependency graph를 렌더링해 modules, providers, dependency edges를 한눈에 보게 합니다.
- **Diagnostics Tab**: `PlatformDiagnosticIssue` 항목을 severity, message, cause, fix hints, blockers, docs links와 함께 나열합니다.
- **Timing View**: Timing data가 있을 때 `BootstrapTimingDiagnostics`를 사용해 total bootstrap time과 phase-level cost를 보여줍니다.
- **Filtering**: 로드된 snapshot을 변경하지 않고 query, readiness, severity filter를 적용합니다.
- **Mermaid Export**: Internal dependency edges와 external dependency nodes를 포함해 Studio가 소유한 `renderMermaid(snapshot)` logic으로 text diagram을 생성합니다.

이 기능들은 팀에 공유 artifact review flow를 제공합니다. CLI가 파일을 내보내고, CI가 저장하고, Studio가 같은 파일을 graph, issue list, timing explanation으로 바꿉니다.

### Visualizing Scopes and Lifecycles

Studio의 중요한 역할 중 하나는 scope와 lifecycle 문제를 보이게 만드는 것입니다. 복잡한 애플리케이션에서는 request-scoped provider를 singleton path에 잘못 주입하거나, dependency chain만 봐서는 분명하지 않은 느린 provider를 도입하기 쉽습니다.

Snapshot은 Studio에 해석된 component graph와 diagnostics를 제공합니다. Timing data는 bootstrap phase cost를 제공합니다. 두 artifact를 함께 보면 viewer는 구조와 startup behavior를 모두 설명할 수 있습니다. Graph는 어떤 component가 느린 provider에 의존하는지 보여주고, timing view는 지연이 graph construction, instance resolution, lifecycle hooks 중 어디에서 발생했는지 보여줄 수 있습니다.

## 15.6 Scenario: Diagnosing a Provider Deadlock

애플리케이션이 startup 중 멈추거나 실패한다고 가정해 봅니다. 로그에만 의존하지 말고 report artifact를 생성합니다.

```bash
fluo inspect ./src/app.module.ts --report --output artifacts/deadlock-report.json
```

그다음 artifact trail을 따라갑니다.

1. **Check the summary**: `summary.errorCount`, `summary.warningCount`, `summary.readinessStatus`, `summary.timingTotalMs`를 읽어 failure shape를 파악합니다.
2. **Open the snapshot in Studio**: Viewer로 graph와 diagnostics를 검사합니다. Diagnostics tab은 가능한 경우 `dependsOn`, `cause`, `fixHint`를 포함한 structured issue를 보여줍니다.
3. **Render a diagram if needed**: Architecture review가 PR이나 decision record 안의 text diagram을 필요로 하면 `fluo inspect --mermaid --output artifacts/deadlock-graph.mmd`를 사용합니다.
4. **Keep the artifact**: 다른 개발자가 같은 inspection view를 재현할 수 있도록 report를 CI log나 support ticket에 첨부합니다.

이 workflow는 터미널 출력을 채팅에 복사하는 방식보다 반복 가능합니다. Report는 summary, snapshot, diagnostics, timing을 함께 보관합니다. Studio는 그 사실들을 reviewer가 직접 앱을 bootstrap하지 않아도 검사할 수 있는 graph와 issue list로 바꿉니다.

## 15.7 Consuming Inspect Artifacts Programmatically

Custom CI/CD tooling을 만든다면 `parseStudioPayload`, `applyFilters`, `renderMermaid` 같은 `@fluojs/studio` helper로 inspect artifact를 프로그래밍 방식으로 파싱하고 검증할 수 있습니다.

```typescript
import { applyFilters, parseStudioPayload, renderMermaid } from '@fluojs/studio';
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('artifacts/inspect-with-timing.json', 'utf8');
const { payload } = parseStudioPayload(raw);

if (payload.snapshot) {
  const errors = applyFilters(payload.snapshot, {
    query: '',
    readinessStatuses: [],
    severities: ['error'],
  });

  if (errors.diagnostics.length > 0) {
    writeFileSync('artifacts/module-graph.mmd', renderMermaid(payload.snapshot));
    throw new Error('Inspect diagnostics include errors. See artifacts/module-graph.mmd.');
  }
}
```

이 pattern은 architecture check를 사람이 검사하는 artifact와 가깝게 유지합니다. CI job은 심각한 diagnostics에서 실패하고, report JSON을 업로드하고, Mermaid graph를 review comment에 붙일 수 있습니다. 중요한 경계는 그대로입니다. Runtime은 snapshot을 생산하고, CLI는 artifact를 내보내며, Studio는 parsing, filtering, rendering을 맡습니다.

## 15.8 Mermaid Export for Documentation

Studio는 `renderMermaid(snapshot)`을 통해 snapshot-to-Mermaid 계약을 소유합니다. CLI는 명령을 실행하는 프로젝트에서 Studio를 찾을 수 있을 때 `fluo inspect --mermaid`를 이 helper에 위임합니다.

```bash
fluo inspect ./src/app.module.ts --mermaid --output docs/generated/module-graph.mmd
```

Mermaid output은 architecture decision records, README diagrams, review threads에 유용합니다. 텍스트이므로 일반 version control에서 graph 변화를 시간에 따라 보여줄 수 있습니다. 이는 architecture diagram과 실제 Module Graph 사이의 drift를 줄입니다.

Mermaid는 raw snapshot이나 report와 같은 artifact가 아닙니다. Graph를 렌더링한 view입니다. Diagnostics, readiness, health, timing, machine-readable details가 필요하면 raw JSON이나 report artifact를 보관합니다. 독자가 빠르게 훑을 수 있는 diagram이 필요하면 Mermaid를 보관합니다.

### Studio as an Architecture Guard

Studio artifact는 CI/CD pipeline 안의 architecture guard가 될 수 있습니다. Guard는 `fluo inspect --report --output artifacts/inspect-report.json`을 실행하고, report를 파싱한 뒤, diagnostics에 error가 있으면 실패할 수 있습니다. 또 다른 guard는 `renderMermaid(snapshot)`을 호출해 graph가 바뀔 때마다 diagram을 게시할 수 있습니다.

이 접근은 architecture regression이 production에 도달하기 전에 발견하게 합니다. 또한 reviewer에게 매번 같은 증거를 제공합니다. Machine-readable facts를 위한 report, exploration을 위한 Studio viewer, discussion을 위한 Mermaid입니다.

### Future Directions: Live Studio

현재 Studio workflow는 file-first입니다. 이는 의도적인 선택입니다. 파일은 CI에 저장하기 쉽고, support ticket에 첨부하기 쉽고, review에서 비교하기 쉽습니다. 같은 계약이 나중에 live 또는 streaming diagnostics를 지원할 수 있지만, 이 장은 artifact를 안정적인 학습 경로로 다룹니다.

미래의 live workflow가 생겨도 inspect artifact의 필요성은 사라지지 않습니다. 팀은 여전히 CI, support, governance를 위한 재현 가능한 증거가 필요합니다. File-first report는 그 증거를 지금 제공합니다.

## 15.9 Why Heading Parity Matters

fluo book은 영어와 한국어 chapter pair를 heading structure 기준으로 맞춥니다. 이는 단순한 형식 문제가 아닙니다. Maintainer가 번역 편집 중 기술 section이 빠지지 않았는지 확인할 수 있는 안정적인 기준을 제공합니다.

Chapter 15는 특히 민감합니다. Studio diagnostics와 inspect artifact는 독자를 문서로 다시 안내하는 경우가 많기 때문입니다. 영어와 한국어 파일이 같은 heading level과 section order를 유지하면 link, review, future sync check를 더 쉽게 판단할 수 있습니다.

이 장을 업데이트할 때는 두 언어 파일을 함께 업데이트합니다. 한 파일에 새 artifact나 viewer behavior에 대한 section을 추가했다면, 같은 변경에서 다른 파일에도 대응 section을 추가합니다.

## Summary

Studio는 runtime inspection data를 공유 가능한 diagnostic workflow로 바꿉니다. `fluo inspect`는 raw JSON snapshot, timing envelope, CI-friendly report, Studio-rendered Mermaid diagram을 생성합니다. `--output`은 이 payload들을 CI와 support workflow가 보관할 수 있는 stable artifact로 만듭니다.

경계는 분명합니다. Runtime은 platform truth를 생산하고, CLI는 그것을 export하거나 delegate하며, Studio는 consume, filter, view, render를 맡습니다. 이 구조 덕분에 Studio는 애플리케이션 동작을 바꾸지 않고도 local debugging, architecture review, CI gate, support handoff에 유용합니다.

복잡한 구성 문제가 나타나면 Studio-first workflow를 유지합니다. Inspect artifact를 생성하고, handoff가 필요하면 report를 보관하고, 탐색이 필요하면 Studio에서 snapshot을 열고, review 가능한 diagram이 필요하면 Mermaid를 사용합니다.
