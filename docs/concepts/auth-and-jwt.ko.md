# auth and jwt

<p><a href="./auth-and-jwt.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 현재 인증 스택이 Konekti 패키지들 사이에 어떻게 나뉘어 있는지 설명합니다.

## package boundary

- `@konekti/jwt`: JWT 토큰 핵심 규약, 서명, 검증, 클레임(claim) 유효성 검사 및 principal 정규화를 소유합니다.
- `@konekti/passport`: strategy 등록 metadata, 범용 인증 guard 연결 및 strategy adapter 규약을 소유합니다.
- `@konekti/http`: guard 오케스트레이션, `RequestContext` 및 runtime 실행 순서를 소유합니다.
- `@konekti/config`: 키 자료(key material)와 issuer/audience 로딩을 소유합니다.

## execution ownership

- 토큰 추출: strategy 소유의 adapter 로직
- 서명 및 클레임 검증: `JwtVerifier`
- 검증된 principal 정규화: `JwtVerifier`
- Route 인식 인증 요구사항: passport metadata 및 인증 guard
- `RequestContext`에 principal 첨부: passport guard 경로
- HTTP 인증 에러 매핑: passport + HTTP 예외 레이어

## current default request flow

```text
HTTP 요청
-> route 인식 인증 guard
-> 선택된 인증 strategy
-> 검증된 principal
-> RequestContext.principal 설정
-> controller/service 실행
```

## current stance

- JWT는 하나의 strategy일 뿐, 전체 인증 모델이 아닙니다.
- `@konekti/passport`는 현재 strategy에 구애받지 않습니다(generic).
- `@konekti/jwt`는 내보낸 strategy adapter를 제외하고는 전송 계층에 독립적(transport-agnostic)입니다.
- 애플리케이션 코드는 가급적 원시 JWT 페이로드보다 정규화된 principal을 사용해야 합니다.

## related package docs

- `packages/jwt/README.md`
- `packages/passport/README.md`
- `packages/http/README.md`
