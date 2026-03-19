# konekti 브랜드 색상 가이드

## 상징색: 오렌지

konekti 프레임워크의 상징색은 **오렌지**입니다.

### 색상 철학

- **에너지와 혁신**: 프레임워크의 활기찬 개발 경험을 상징
- **높은 주목도**: 기술 생태계에서 독보적인 정체성 확보
- **드문 색상 선택**: Spring(녹색), NestJS(빨간색)과 차별화된 색상

---

## 메인 색상 팔레트

| 이름 | HEX | RGB | 용도 |
|------|-----|-----|------|
| **Primary** | `#F97316` | `rgb(249, 115, 22)` | 메인 브랜드 색상, CTA 버튼, 로고 |
| **Primary Dark** | `#EA580C` | `rgb(234, 88, 12)` | 호버 상태, 어두운 배경 |
| **Primary Light** | `#FB923C` | `rgb(251, 146, 60)` | 강조, 하이라이트 |
| **Primary Lighter** | `#FDBA74` | `rgb(253, 186, 116)` | 배경 강조, 라이트 테마 |
| **Primary Lightest** | `#FFEDD5` | `rgb(255, 237, 213)` | 밝은 배경, 태그 배경 |

---

## 그라데이션

### 메인 그라데이션
```css
background: linear-gradient(135deg, #F97316 0%, #FB923C 50%, #FBBF24 100%);
```

### 어두운 그라데이션
```css
background: linear-gradient(135deg, #EA580C 0%, #F97316 100%);
```

---

## 상태 색상

| 상태 | HEX | 용도 |
|------|-----|------|
| **성공** | `#10B981` | 성공 메시지, 완료 상태 |
| **경고** | `#F59E0B` | 경고 메시지 |
| **에러** | `#EF4444` | 에러 메시지, 삭제 버튼 |
| **정보** | `#3B82F6` | 정보 메시지, 도움말 |

---

## 뉴트럴 색상

| 이름 | HEX | 용도 |
|------|-----|------|
| **Gray 900** | `#111827` | 어두운 배경, 메인 텍스트 |
| **Gray 800** | `#1F2937` | 카드 배경 |
| **Gray 700** | `#374151` | 보조 텍스트 |
| **Gray 600** | `#4B5563` | 비활성 텍스트 |
| **Gray 400** | `#9CA3AF` | 플레이스홀더 |
| **Gray 200** | `#E5E7EB` | 경계선 |
| **Gray 100** | `#F3F4F6` | 라이트 배경 |

---

## 사용 예시

### 버튼
```css
/* Primary Button */
.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover {
  background: #EA580C;
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  border: 2px solid #F97316;
  color: #F97316;
}

.btn-secondary:hover {
  background: #FFEDD5;
}
```

### 로고 배경
```css
.logo {
  background: linear-gradient(135deg, #F97316, #FB923C);
  color: white;
}
```

### 링크
```css
a {
  color: #F97316;
}

a:hover {
  color: #EA580C;
}
```

---

## 접근성 (Accessibility)

- **Primary (#F97316)** on white background: 대비율 3.04:1 (AA Large)
- **Primary Dark (#EA580C)** on white background: 대비율 3.87:1 (AA Large)
- 텍스트 색상으로 사용 시 반드시 큰 글씨(18px 이상 또는 14px bold)와 함께 사용

---

## 경쟁 프레임워크 색상 비교

| 프레임워크 | 색상 | HEX |
|-----------|------|-----|
| Spring Boot | 녹색 | `#6DB33F` |
| NestJS | 빨간색 | `#E0234E` |
| Django | 녹색 | `#092E20` |
| Express | 검정 | `#000000` |
| Fastify | 검정 | `#000000` |
| **konekti** | **오렌지** | **`#F97316`** |

---

## 파일 위치

이 색상 가이드는 다음 위치에 저장됩니다:
- `docs/branding/color-palette.md`

향후 디자인 시스템이나 컴포넌트 라이브러리가 생기면 이 가이드를 기반으로 CSS 변수나 테마 토큰을 구성합니다.