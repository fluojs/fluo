# 2권 목차 — FluoShop: 인기를 얻은 블로그가 상점을 열다

[시리즈 소개](../README.ko.md) · [이 권을 읽는 방법](./README.ko.md)

## 1부. 독자가 고객이 되다

1. [기존 블로그에 상점을 붙이기](./ch01-grow-the-blog.ko.md)
2. [콘텐츠·상품·주문의 경계 나누기](./ch02-domain-boundaries.ko.md)
3. [티셔츠 한 장을 상품으로 표현하기](./ch03-catalog-and-money.ko.md)
4. [블로그에서 구매로 이어지는 경험 만들기](./ch04-storefront.ko.md)

## 2부. 주문과 재고의 일관성

5. [장바구니 가격을 믿으면 안 되는 이유](./ch05-cart-and-pricing.ko.md)
6. [주문을 상태 머신으로 설계하기](./ch06-order-state-machine.ko.md)
7. [마지막 티셔츠를 두 사람이 구매한다면](./ch07-inventory-concurrency.ko.md)
8. [구매 버튼을 두 번 눌러도 주문은 한 번만](./ch08-idempotent-checkout.ko.md)

## 3부. 실패하는 외부 시스템과 협력하기

9. [결제사를 애플리케이션 밖에 두기](./ch09-payment-boundary.ko.md)
10. [결제 웹훅을 안전하게 처리하기](./ch10-payment-webhooks.ko.md)
11. [취소와 환불은 되돌리기 버튼이 아니다](./ch11-refunds-and-compensation.ko.md)
12. [중간에 멈춘 주문을 다시 맞추기](./ch12-reconciliation.ko.md)

## 4부. 비동기 작업을 믿을 수 있게 만들기

13. [주문 완료를 다른 기능에 알리기](./ch13-domain-events.ko.md)
14. [저장은 됐는데 이벤트가 사라졌다면](./ch14-outbox-and-inbox.ko.md)
15. [실패한 작업을 다시 실행하기](./ch15-reliable-jobs.ko.md)
16. [쓰기 모델과 조회 모델의 요구가 달라지다](./ch16-cqrs-projections.ko.md)
17. [여러 단계의 주문 처리를 조율하기](./ch17-order-sagas.ko.md)

## 5부. 고객과 운영자가 보는 시스템

18. [이메일·Slack·Discord로 같은 사건 전달하기](./ch18-notification-channels.ko.md)
19. [주문 상태를 실시간으로 보여주기](./ch19-realtime-orders.ko.md)
20. [운영 대시보드에 맞는 조회 API 만들기](./ch20-graphql-dashboard.ko.md)
21. [상품은 캐시해도 재고 판단은 캐시만 믿지 않기](./ch21-commerce-caching.ko.md)
22. [해외 독자에게도 판매하기](./ch22-international-commerce.ko.md)

## 6부. 필요한 곳만 분리하고 대안 비교하기

23. [배송 처리를 별도 서비스로 꺼내기](./ch23-extract-fulfillment.ko.md)
24. [메시지 전송 방식을 선택하는 실험실](./ch24-transport-lab.ko.md) — 비교 실습
25. [같은 저장소 계약을 Prisma와 Drizzle로 구현하기](./ch25-drizzle-lab.ko.md) — 비교 실습
26. [리뷰·상품 문서 모델을 MongoDB로 구성해 보기](./ch26-mongoose-lab.ko.md) — 비교 실습

## 7부. 주문이 몰리고 장애가 생기는 날

27. [판매 이벤트를 관측하고 병목 찾기](./ch27-sale-observability.ko.md)
28. [장애 훈련으로 FluoShop 완성하기](./ch28-failure-drills.ko.md)
