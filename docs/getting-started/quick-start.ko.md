# 퀵 스타트

<p><strong><kbd>한국어</kbd></strong> <a href="./quick-start.md"><kbd>English</kbd></a></p>

1분 안에 **표준 데코레이터**와 **명시적 의존성 주입**의 강력함을 경험해 보세요. 레거시 컴파일러 플래그나 마법 같은 리플렉션 없이, 깨끗하고 검증 가능한 TypeScript를 만나보실 수 있습니다.

### 대상 독자
기존의 레거시 데코레이터에서 벗어나 현대적이고 고성능인 TypeScript 프레임워크를 즉시 경험해보고 싶은 개발자.

### 1. CLI 설치
fluo CLI는 프로젝트 스캐폴딩과 컴포넌트 생성을 위한 핵심 도구입니다.

```sh
pnpm add -g @fluojs/cli
```

### 2. 첫 번째 프로젝트 생성
새로운 애플리케이션을 초기화합니다. 기본적으로 Node.js 환경에서 고성능 **Fastify** 어댑터가 구성됩니다.

```sh
fluo new my-konekti-app
cd my-konekti-app
```

### 3. 개발 시작
Konekti 스타터 앱에는 TypeScript 컴파일과 파일 변경 시 자동 재시작을 처리하는 최적화된 개발 환경이 포함되어 있습니다.

```sh
pnpm dev
```

### 4. 확인 및 탐색
서버가 시작되면(기본 3000번 포트), 내장된 관측성 엔드포인트와 샘플 API를 확인해 보세요.

- **헬스 체크**: `curl http://localhost:3000/health`  
  *기대 결과: `{"status":"ok"}`*
- **샘플 모듈**: `curl http://localhost:3000/health-info/`  
  *표준 데코레이터 패턴이 실제로 어떻게 작동하는지 확인하세요.*

### 왜 Konekti인가요?
생성된 프로젝트의 `tsconfig.json`을 열어보세요. 무언가 다른 점을 발견하셨나요?
```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```
Konekti는 **TypeScript의 표준 기본 설정**만으로 동작합니다. 지난 10년간의 "실험적(experimental)" 기능이라는 짐 없이, 완벽한 IDE 지원과 타입 안정성을 누릴 수 있습니다.

### 다음 단계
- **진짜 서비스 만들기**: [첫 번째 기능 구현 경로](./first-feature-path.ko.md)를 따라 나만의 로직을 추가해 보세요.
- **CLI 마스터하기**: [제너레이터 워크플로우](./generator-workflow.ko.md)를 통해 기능 슬라이스 전체를 자동으로 생성하는 방법을 배워보세요.
- **Node.js 그 너머로**: Bun, Deno, Edge 런타임을 위한 [부트스트랩 경로](./bootstrap-paths.ko.md)를 확인해 보세요.
