---
"@fluojs/cron": major
---

Align scheduling descriptors with immutable snapshots and restore scheduling contracts for long delays, timeout generations, effective singleton/multi DI registrations, distinct Symbol methods, falsy hook failures, full hook lease renewal, and failed default scheduler registration cleanup.

Migration: `SchedulingTaskDescriptor` fields are now `readonly`, including directly constructed descriptors. Use a mutable spread copy for local edits, or registry mutation methods to change a schedule; editing a copy does not change registry state. `getAll()` still returns a mutable array. ISO absolute-time strings and type-bypassed `Date` inputs are rejected by `@Cron`, `addCron`, and `updateCronExpression`; move those schedules to application-owned absolute scheduling. Supported Croner expression grammar and positive integer millisecond delays, including values above the host timer limit, remain supported. The default scheduler's started named live replacement limitation remains: disable, update the expression, then enable.

마이그레이션: 직접 구성하는 descriptor를 포함하여 `SchedulingTaskDescriptor` 필드는 이제 `readonly`입니다. 로컬 수정에는 spread로 만든 mutable copy를 사용하고 실제 예약 변경에는 registry mutation method를 사용하세요. 복사본 수정은 registry 상태를 바꾸지 않으며 `getAll()`의 반환 배열은 계속 mutable입니다. `@Cron`, `addCron`, `updateCronExpression`은 ISO absolute-time 문자열과 타입을 우회한 `Date`를 거부하므로 절대시각 예약은 application-owned code로 옮기세요. 지원되는 Croner 표현식 문법과 host timer 상한을 넘는 양의 정수 millisecond 지연은 유지됩니다. 기본 scheduler의 started named live replacement 제약도 유지되므로 disable, expression update, enable 순서로 변경하세요.
