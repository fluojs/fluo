---
"@fluojs/runtime": major
"@fluojs/cron": major
---

Bound platform ready/health probes and runtime HTTP readiness callbacks with independent 5000 ms default deadlines. Platform registrations now accept readiness timeout/criticality options, and direct HealthModule registrations accept readinessCheckTimeoutMs. Timeouts retain bounded component/phase diagnostics and report not-ready/unhealthy or HTTP 503 unavailable without cancelling underlying operations.

Release Cron alongside the mandatory Runtime major dependency, as required by the stable release lane compatibility policy. This companion major does not change scheduling APIs.

Migration: previously unbounded asynchronous probes now fail after their deadline, which changes readiness behavior for existing applications and requires a major release. If a platform probe legitimately needs more than 5000 ms, pass `{ component, readiness: { timeoutMs } }` in the platform registration. Direct HealthModule users can raise `HealthModule.forRoot({ readinessCheckTimeoutMs })`. TerminusModuleOptions currently cannot raise its runtime callback's 5000 ms budget; longer indicator/platform budgets alone do not extend Terminus `/ready` waiting. Keep Terminus readiness work within that limit until a separate option is supported. Ordinary callback errors still propagate, callback order and false short-circuit behavior remain unchanged, and timed-out work is not cancelled.
