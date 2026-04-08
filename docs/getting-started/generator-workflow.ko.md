# 제너레이터 워크플로우

<p><strong><kbd>한국어</kbd></strong> <a href="./generator-workflow.md"><kbd>English</kbd></a></p>

Konekti CLI를 사용하여 반복적인 코드를 줄이고 일관된 프로젝트 구조를 유지하세요. 제너레이터는 Konekti의 module-first 규약에 맞는 실제 구성 요소를 빠르게 만들어 줍니다.

### 대상 독자
아키텍처의 일관성을 유지하면서 모듈, 컨트롤러, 서비스 생성을 자동화하여 생산성을 높이고 싶은 개발자.

### 1. 전체 기능 모듈 생성
**모듈(Module)**은 Konekti에서 조직화의 기본 단위입니다. 한 번의 명령으로 모듈 진입점을 만들고, 필요한 구성 요소를 뒤이어 세분화해 추가할 수 있습니다.

```sh
konekti g module catalog
```

**어떤 일이 일어나나요?**
CLI는 `src/catalog/` 디렉토리를 만들고 `catalog.module.ts` 진입점을 생성합니다. 여기에 필요한 컨트롤러, 서비스, DTO를 이어서 붙일 수 있습니다.

### 2. 정밀한 컴포넌트 생성
기존 기능에 단일 구성 요소를 추가해야 하나요? 세분화된 제너레이터를 사용하세요.

- **`konekti g controller name`**: HTTP 컨트롤러를 스캐폴딩합니다.
- **`konekti g service name`**: 비즈니스 로직 서비스를 스캐폴딩합니다.
- **`konekti g repo name`**: 데이터 레포지토리 패턴을 스캐폴딩합니다.
- **`konekti g module name`**: 깨끗한 모듈 정의를 스캐폴딩합니다.

### 3. 유연한 출력 경로
기본적으로 CLI는 `src/`를 타겟으로 합니다. 프로젝트의 디렉토리 구조에 맞게 `--target-directory` (또는 `-o`) 플래그를 사용할 수 있습니다.

```sh
konekti g module auth --target-directory src/shared
```

### 4. 드라이 런을 통한 안전한 실행
변경 사항을 실제로 적용하기 전에 어떤 파일이 수정되거나 생성될지 미리 확인해 보세요.

```sh
konekti g module shop --dry-run
```

### 왜 CLI를 사용해야 하나요?
- **반복 코드 감소**: 디렉토리 생성, 파일 이름 규칙, 기본 import 구성을 손으로 맞출 필요가 줄어듭니다.
- **일관된 구조**: 생성된 파일은 Konekti 레퍼런스 문서가 설명하는 배치 규칙을 따릅니다.
- **조합 가능한 워크플로우**: 모듈로 시작한 뒤 기능이 커질수록 컨트롤러, 서비스, DTO, 이벤트, 레포지토리를 차례대로 추가할 수 있습니다.

### 다음 단계
- **로직 구현하기**: 파일이 준비되었다면 [첫 번째 기능 구현 경로](./first-feature-path.ko.md)를 따라 로직을 추가해 보세요.
- **검증**: 생성된 컴포넌트를 테스트하는 방법은 [테스트 가이드](../operations/testing-guide.ko.md)에서 확인할 수 있습니다.
