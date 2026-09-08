# 3권 목차 — Inside Fluo: 우리가 만든 서비스의 엔진룸

[시리즈 소개](../README.ko.md) · [이 권을 읽는 방법](./README.ko.md)

## 1부. 선언한 코드가 동작이 되기까지

1. [주문 요청 하나를 소스 끝까지 따라가기](./ch01-trace-an-order.ko.md)
2. [표준 데코레이터와 빌드 도구의 역할](./ch02-standard-decorators.ko.md)
3. [메타데이터는 어디에 저장되는가](./ch03-metadata-ownership.ko.md)
4. [커스텀 데코레이터를 안전하게 만들기](./ch04-custom-decorators.ko.md)

## 2부. 의존성 주입과 모듈 그래프

5. [Provider를 내부 표현으로 바꾸기](./ch05-provider-normalization.ko.md)
6. [의존성을 해석하는 알고리즘](./ch06-resolution-algorithms.ko.md)
7. [인스턴스는 언제 만들어지고 사라지는가](./ch07-scopes-and-disposal.ko.md)
8. [모듈 그래프를 컴파일하기](./ch08-module-compilation.ko.md)

## 3부. 런타임과 요청 실행 모델

9. [애플리케이션 시작과 실패 복구](./ch09-bootstrap-and-rollback.ko.md)
10. [HTTP 요청 파이프라인 해부하기](./ch10-http-pipeline.ko.md)
11. [DTO와 응답이 변환되는 과정](./ch11-dto-and-errors.ko.md)
12. [요청이 끝나기 전에 연결이 끊긴다면](./ch12-cancellation-and-streaming.ko.md)

## 4부. 같은 프레임워크, 서로 다른 호스트

13. [Node.js 어댑터 비교하기](./ch13-node-adapters.ko.md)
14. [Fetch 기반 런타임으로 이동하기](./ch14-fetch-adapters.ko.md)
15. [Next.js 안에서 Fluo 실행하기](./ch15-nextjs-hosting.ko.md)
16. [직접 어댑터를 만들고 계약 검증하기](./ch16-custom-adapter.ko.md)

## 5부. 확장하고 진단하고 기여하기

17. [재사용 가능한 Fluo 확장 패키지 만들기](./ch17-extension-package.ko.md)
18. [CLI와 Studio가 애플리케이션을 보는 방법](./ch18-cli-and-studio.ko.md)
19. [성능 주장을 실험으로 검증하기](./ch19-performance-experiments.ko.md)
20. [프레임워크 변경 하나를 끝까지 제출하기](./ch20-contributing-a-change.ko.md)
