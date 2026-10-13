# tooling-tsconfig

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

이 디렉터리는 저장소 개발용 private 설정입니다. 애플리케이션에 별도 패키지로 설치하지 않습니다.

## 시작할 파일

[base.json](./base.json)은 strict 검사와 ES2022/ESNext, Bundler module resolution 등 공통 compiler option을 정의합니다. 개별 `tsconfig`의 `extends`와 override를 함께 확인해야 실제 설정을 알 수 있습니다. 이 설정만으로 데코레이터 코드가 변환되는 것은 아닙니다.

새 앱의 TypeScript·변환 설정은 [CLI 스타터](../../packages/cli/README.ko.md)가 제공합니다. 저장소의 빌드·검증 절차는 [기여 가이드](../../CONTRIBUTING.ko.md)를 참고하세요.
