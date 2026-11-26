import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { summarizeIntegrationMeasurements } from "../../execute-lane/scripts/generated-integration.mjs";
import { collectStageLifecycle, summarizeStageLifecycle } from "../../execute-lane/scripts/stage-lifecycle.mjs";
import { dispatchFor, readRegisteredAgents, validateDispatchTarget } from "../../execute-lane/scripts/dispatch-targets.mjs";

const kinds = new Set([
	"stage",
	"stage-lifecycle",
	"review",
	"implementer",
	"ci",
	"incident",
	"gap",
	"merge",
	"observation",
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) =>
	sha(JSON.stringify(
		value,
		(_key, item) =>
			item && typeof item === "object" && !Array.isArray(item)
				? Object.fromEntries(
					Object.keys(item).sort().map((key) => [key, item[key]]),
				)
				: item,
	));

// Readers and concurrent duplicate captures only see complete immutable JSON.
const publishJson = (path, value) => {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
	});
	try {
		linkSync(temporary, path);
	} finally {
		unlinkSync(temporary);
	}
};

export const retroDirectory = (root, laneId) => {
	if (typeof laneId !== "string" || !laneId || [".", ".."].includes(laneId)) {
		throw new TypeError("Retrospective requires a lane identity");
	}
	return resolve(root, ".omo/retros", encodeURIComponent(laneId));
};

/** Append immutable observations, never execution facts or accepted verdicts. */
export const recordRetroEvent = (root, laneId, issue, kind, data) => {
	if (
		!Number.isSafeInteger(issue) || issue <= 0 || !kinds.has(kind) ||
		data === undefined
	) {
		throw new TypeError("Unknown retrospective work unit or event kind");
	}
	const identity = { version: 1, laneId, issue, kind, data: kind === "stage-lifecycle" ? collectStageLifecycle(data) : data };
	const eventId = digest(identity);
	const directory = resolve(
		retroDirectory(root, laneId),
		`issue-${issue}`,
		"events",
	);
	mkdirSync(directory, { recursive: true });
	const path = resolve(directory, `${kind === "stage-lifecycle" ? "lifecycle-" : ""}${eventId}.json`);
	const event = {
		...identity,
		eventId,
		recordedAt: new Date().toISOString(),
	};
	try {
		publishJson(path, event);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const previous = JSON.parse(readFileSync(path, "utf8"));
		if (
			digest({
				version: previous.version,
				laneId: previous.laneId,
				issue: previous.issue,
				kind: previous.kind,
				data: previous.data,
			}) !== eventId
		) {
			throw new TypeError(
				"Existing retrospective observation was modified",
			);
		}
	}
	return { eventId, path };
};

export const readRetroEvents = (root, laneId, lifecycleGaps = []) => {
	const directory = retroDirectory(root, laneId);
	if (!existsSync(directory)) return [];
	const records = [];
	for (const unit of readdirSync(directory, { withFileTypes: true })) {
		if (!unit.isDirectory() || !/^issue-[1-9]\d*$/u.test(unit.name)) {
			continue;
		}
		const events = resolve(directory, unit.name, "events");
		if (!existsSync(events)) continue;
		for (const name of readdirSync(events).sort()) {
			const match = /^(lifecycle-)?([a-f0-9]{64})\.json$/u.exec(name);
			if (!match) continue;
			const path = resolve(events, name);
			try {
				const bytes = readFileSync(path);
				const event = JSON.parse(bytes);
				const { version, laneId: observedLane, issue, kind, data } = event;
				if (
					version !== 1 || observedLane !== laneId || `issue-${issue}` !== unit.name ||
					!kinds.has(kind) || Boolean(match[1]) !== (kind === "stage-lifecycle") ||
					digest({ version, laneId, issue, kind, data }) !== event.eventId ||
					match[2] !== event.eventId || !Number.isFinite(Date.parse(event.recordedAt))
				) {
					throw new TypeError(`Invalid retrospective observation: ${path}`);
				}
				records.push({ ...event, path: relative(root, path), sha256: sha(bytes) });
			} catch (error) {
				if (!match[1] || !(error instanceof Error)) throw error;
				lifecycleGaps.push({ code: "capture-unreadable", path: relative(root, path), eventId: match[2] });
			}
		}
	}
	return records.sort((a, b) =>
		a.recordedAt.localeCompare(b.recordedAt) ||
		a.eventId.localeCompare(b.eventId)
	);
};

const githubTimestamp = (value) => {
	if (typeof value !== "string") return null;
	const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
	if (!match) return null;
	const wall = Date.parse(`${match[1]}Z`);
	const ms = Date.parse(value);
	return Number.isFinite(ms) && Number.isFinite(wall) && new Date(wall).toISOString().slice(0, 19) === match[1] ? ms : null;
};

const interval = ({ scope, source, startedAt = null, completedAt = null }, reason = null, bounds = {}) => {
	const start = githubTimestamp(startedAt);
	const end = githubTimestamp(completedAt);
	const latest = githubTimestamp(bounds.completedAt);
	const earliestEnd = githubTimestamp(bounds.earliestEnd);
	const unknown = reason ?? (
		startedAt === null || completedAt === null ? "missing-boundary"
			: start === null || end === null ? "invalid-timestamp"
			: end < start ? "reversed-boundaries"
			: bounds.starts?.some((boundary) => {
				const earliest = githubTimestamp(boundary);
				return earliest !== null && start < earliest;
			}) || (earliestEnd !== null && end < earliestEnd) || (latest !== null && end > latest)
			? "contradictory-boundaries" : null
	);
	return { scope, source, startedAt, completedAt, elapsedMs: unknown === null ? end - start : null, reason: unknown };
};

const executionBlocker = ({ status, conclusion }, subject) => {
	if (["cancelled", "skipped", "timed_out"].includes(conclusion)) return `${subject}-${conclusion}`;
	if (status !== "completed" || typeof conclusion !== "string") return `${subject}-not-completed`;
	return null;
};

const stepIdentityBlocker = (number, repeated) =>
	repeated ? "conflicting-step-identity"
		: !Number.isSafeInteger(number) || number <= 0 ? "missing-step-identity" : null;

const stepScopeBlocker = (scope) =>
	scope === "verification-execution-step" ? "mixed-task-scope"
		: scope === "unclassified-step" ? "step-purpose-unproven" : null;

const preparationSteps = {
	"Resolve verification plan": ["Restore immutable verification image", "Load cached image", "Prepare and archive verified image"],
	"Verify": ["Acquire build outputs for evidence validation", "Restore documentation outputs for evidence validation"],
	"reusable-task": ["Restore verification image", "Load verification image", "Cache integrity-checked pnpm package contents", "Acquire provenance-bound primary build"],
};

const timingScope = (workflow, job, step) => {
	// GitHub reports the caller job and called job together for this workflow.
	if (workflow !== ".github/workflows/ci.yml") return "unclassified-step";
	const isReusableTask = /^(?:Primary build \/ build|(?:Verify task|Node compatibility) \(([\w-]+)\) \/ \1)$/u.test(job);
	const context = isReusableTask ? "reusable-task" : job === "Verify" || job === "Resolve verification plan" ? job : null;
	if (context !== null && preparationSteps[context].includes(step)) {
		return "environment-preparation-step";
	}
	if (context === "Verify" && step === "Require every planned capability and job result") return "verification-aggregate-step";
	if (context === "Resolve verification plan" && step === "Verify the host runner against real Docker fixtures") return "verification-host-checks-step";
	if (context === "reusable-task" && step === "Execute the shared Linux task") return "verification-execution-step";
	return "unclassified-step";
};

const jobTiming = (run, job, identityReason) => {
	const { id, name, status, conclusion } = job;
	const startedAt = job.started_at ?? null;
	const completedAt = job.completed_at ?? null;
	const execution = interval({
		scope: "job-execution", source: "github-job.started_at/completed_at", startedAt, completedAt,
	}, identityReason ?? executionBlocker(job, "job"), { starts: [run.created_at, run.run_started_at] });
	const queue = interval({
		scope: "job-queue", source: "github-job.queued_at/started_at",
		startedAt: job.queued_at, completedAt: startedAt,
	}, identityReason ?? executionBlocker(job, "job"), {
		starts: [run.created_at], earliestEnd: run.run_started_at, completedAt,
	});
	const runnerSetup = interval({ scope: "runner-setup", source: null }, "runner-setup-unobserved");
	const stepNumbers = new Set();
	const repeatedSteps = new Set();
	for (const step of job.steps ?? []) {
		if (stepNumbers.has(step.number)) repeatedSteps.add(step.number);
		stepNumbers.add(step.number);
	}
	const steps = (job.steps ?? []).map((step) => {
		const scope = timingScope(run.path, name, step.name);
		const reason = identityReason ?? stepIdentityBlocker(step.number, repeatedSteps.has(step.number))
			?? executionBlocker(step, "step") ?? stepScopeBlocker(scope);
		return {
			number: step.number, name: step.name, status: step.status, conclusion: step.conclusion,
			timing: interval({
				scope, source: "github-step.started_at/completed_at",
				startedAt: step.started_at, completedAt: step.completed_at,
			}, reason, { starts: [run.created_at, run.run_started_at, startedAt], completedAt }),
		};
	});
	return { id, name, status, conclusion, head: job.head_sha ?? null, createdAt: job.created_at ?? null,
		startedAt, completedAt, execution, queue, runnerSetup, steps };
};

const jobIdentityReasons = ["conflicting-job-identity", "missing-job-identity", "job-identity-mismatch"];
const timingConflict = "conflicting-attempt-timing";

const corroboratesRunStart = ({ head, execution, steps, startedAt, completedAt }, run) => {
	if (head !== run.head_sha || jobIdentityReasons.includes(execution.reason)) return false;
	if (execution.reason === null) return true;
	return steps.some(({ timing }) => timing.reason === null ||
		(timing.reason === stepScopeBlocker(timing.scope) &&
			interval(timing, null, { starts: [run.run_started_at, startedAt], completedAt }).reason === null));
};

const runQueueTiming = (run, jobs, observedInProgress = false) => {
	const unconfirmedCancellation = run.conclusion === "cancelled" &&
		(run.status !== "completed" || (!observedInProgress && !jobs.some((job) => corroboratesRunStart(job, run))));
	return interval({
		scope: "run-queue", source: "github-run.created_at/run_started_at",
		startedAt: run.run_attempt === 1 ? run.created_at : null, completedAt: run.run_started_at,
	}, run.run_attempt !== 1 ? "retry-queue-unobserved"
		: run.conclusion === "skipped" ? "run-skipped"
		: unconfirmedCancellation ? "run-cancelled"
		: ["in_progress", "completed"].includes(run.status) ? null : "run-start-unconfirmed");
};

const attemptTiming = (run, jobs) => {
	const jobsById = new Map();
	for (const job of jobs) {
		const observations = jobsById.get(job.id) ?? new Map();
		observations.set(digest(job), job);
		jobsById.set(job.id, observations);
	}
	const observedJobs = [...jobsById].sort(([a], [b]) => a - b).flatMap(([id, observations]) =>
		[...observations.values()].map((job) => jobTiming(run, job,
			observations.size > 1 ? "conflicting-job-identity"
				: !Number.isSafeInteger(id) || id <= 0 ? "missing-job-identity"
				: Object.hasOwn(job, "head_sha") && job.head_sha !== run.head_sha ? "job-identity-mismatch"
				: null)));
	return { runQueue: runQueueTiming(run, observedJobs), jobs: observedJobs };
};

/** A CI failure is keyed to a real run attempt and completed job, not a polling tick. */
export const recordCiSnapshot = (root, laneId, issue, run, jobs) => {
	if (
		!Number.isSafeInteger(run?.id) || run.id <= 0 ||
		!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
		!/^[a-f0-9]{40}$/u.test(run.head_sha ?? "") || !Array.isArray(jobs)
	) {
		throw new TypeError("Missing actual GitHub CI run identity");
	}
	const identity = {
		id: run.id,
		attempt: run.run_attempt,
		head: run.head_sha,
		workflow: run.path,
		url: run.html_url,
	};
	const recorded = [];
	for (const job of jobs) {
		if (job.run_id !== run.id || job.run_attempt !== run.run_attempt) {
			throw new TypeError("CI job belongs to another run attempt");
		}
		if (
			job.status !== "completed" ||
			!["failure", "timed_out", "cancelled", "action_required"].includes(
				job.conclusion,
			)
		) continue;
		recorded.push(recordRetroEvent(root, laneId, issue, "ci", {
			run: identity,
			job: {
				id: job.id,
				name: job.name,
				conclusion: job.conclusion,
				startedAt: job.started_at,
				completedAt: job.completed_at,
				url: job.html_url,
				failedSteps: (job.steps ?? []).filter((step) =>
					["failure", "timed_out", "cancelled"].includes(
						step.conclusion,
					)
				)
					.map(({ number, name, conclusion }) => ({
						number,
						name,
						conclusion,
					})),
			},
		}));
	}
	if (run.status === "completed") {
		const ends = jobs.map((job) => Date.parse(job.completed_at)).filter(
			Number.isFinite,
		);
		const start = Date.parse(
			run.run_attempt === 1 ? run.created_at : run.run_started_at,
		);
		const end = ends.length ? Math.max(...ends) : null;
		recorded.push(recordRetroEvent(root, laneId, issue, "ci", {
			run: identity,
			conclusion: run.conclusion,
			status: run.status,
			complete: jobs.length > 0 && run.conclusion !== null && run.conclusion !== undefined
				&& jobs.every((job) => job.status === "completed" && typeof job.conclusion === "string"),
			createdAt: run.created_at,
			completedAt: end === null ? null : new Date(end).toISOString(),
			elapsedMs: Number.isFinite(start) && end !== null && end >= start
				? end - start
				: null,
			elapsedScope: run.run_attempt === 1
				? "initial-run-including-queue"
				: "retry-attempt-excluding-queue",
			jobCount: jobs.length,
			timing: attemptTiming(run, jobs),
		}));
	} else if (jobs.length > 0) {
		// A partial timing observation cannot satisfy complete CI collection or supply run elapsed.
		recorded.push(recordRetroEvent(root, laneId, issue, "ci", {
			run: identity, status: run.status, createdAt: run.created_at, timing: attemptTiming(run, jobs),
		}));
	}
	return recorded;
};

const terminal = ({ status }) => status === "completed";
const canSupplyJobCompletion = (job) =>
	terminal(job) && typeof job.conclusion === "string" && job.conclusion !== "skipped" &&
	!jobIdentityReasons.includes(job.execution.reason);

const attemptCompletionSuppliers = (jobs, runCreatedAt, attemptStart) => {
	const earliest = Math.max(githubTimestamp(runCreatedAt) ?? -Infinity,
		githubTimestamp(attemptStart) ?? -Infinity);
	const suppliers = [];
	let latestUnverifiedEnd = -Infinity;
	for (const job of jobs) {
		const { id, conclusion, startedAt, completedAt, execution } = job;
		if (execution.reason === "job-identity-mismatch" || conclusion === "skipped") continue;
		const start = githubTimestamp(startedAt);
		const end = githubTimestamp(completedAt);
		// Cancelled and timed-out jobs can attest to completion without attesting to execution duration.
		// Missing or contradictory ends cannot establish ordering against siblings.
		if (end === null || (start !== null && end < start) || end < earliest) {
			return [];
		}
		if (!canSupplyJobCompletion(job) || execution.reason === timingConflict
			|| (startedAt != null && (start === null || start < earliest))) {
			latestUnverifiedEnd = Math.max(latestUnverifiedEnd, end);
		} else {
			suppliers.push({ id, end });
		}
	}
	// A trusted supplier at the same instant still establishes the latest boundary.
	return suppliers.some(({ end }) => end >= latestUnverifiedEnd) ? suppliers : [];
};

// Compare observed instants, not missing fields or differences in timestamp spelling.
const reconcileBoundary = (values) => {
	const observed = new Map();
	for (const value of values) {
		if (value != null) observed.set(githubTimestamp(value) ?? value, value);
	}
	const conflict = observed.size > 1;
	const ordered = [...observed.keys()].filter((key) => typeof key === "number").sort((a, b) => a - b);
	return { value: conflict ? null : ([...observed.values()][0] ?? null), conflict,
		earliest: observed.get(ordered[0]), latest: observed.get(ordered.at(-1)) };
};

const groupsBy = (items, keyFor) => {
	const groups = new Map();
	for (const item of items) {
		const key = keyFor(item);
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	return groups;
};

const timingStarted = ({ status }) => ["in_progress", "completed"].includes(status);
const reconciledInterval = (template, start, end, reason, bounds) => interval({
	...template, startedAt: start.value, completedAt: end.value,
}, reason ?? (start.conflict || end.conflict ? timingConflict : null), bounds);

const reconcileJobTiming = (observations, attemptStart) => {
	const job = observations.findLast(terminal) ?? observations.at(-1);
	const identityReason = new Set(observations.map(({ name }) => name)).size > 1 ? "conflicting-job-identity" : null;
	const started = reconcileBoundary(observations.filter(timingStarted).map(({ startedAt }) => startedAt));
	const completed = reconcileBoundary(observations.filter(canSupplyJobCompletion).map(({ completedAt }) => completedAt));
	const queued = reconcileBoundary(observations.map(({ queue }) => queue.startedAt));
	const reason = identityReason ?? executionBlocker(job, "job");
	const stepsByNumber = groupsBy(observations.flatMap(({ steps }) => steps), ({ number }) => number);
	const steps = [...stepsByNumber].flatMap(([number, rows]) => {
		const fallback = job.steps.filter((step) => step.number === number);
		if (fallback.some(({ timing }) => timing.reason === "conflicting-step-identity")) return fallback;
		const attributable = rows.filter(({ timing }) => !["conflicting-step-identity", "missing-step-identity"].includes(timing.reason));
		if (!attributable.length) return fallback;
		const step = attributable.findLast(terminal) ?? attributable.at(-1);
		const stepIdentity = new Set(attributable.map(({ name }) => name)).size > 1 ? "conflicting-step-identity" : null;
		const timingSources = attributable.filter(({ conclusion }) => conclusion !== "skipped");
		const start = reconcileBoundary(timingSources.filter(timingStarted).map(({ timing }) => timing.startedAt));
		const end = reconcileBoundary(timingSources.filter(terminal).map(({ timing }) => timing.completedAt));
		// A step can remain measured if it fits inside every observed enclosing boundary.
		const bounds = { starts: [attemptStart, started.latest], completedAt: completed.earliest };
		const reason = identityReason ?? stepIdentity ?? executionBlocker(step, "step");
		const measured = reconciledInterval(step.timing, start, end, reason, bounds);
		const scopeReason = stepScopeBlocker(step.timing.scope);
		const timing = measured.reason === null && scopeReason !== null
			? { ...measured, elapsedMs: null, reason: scopeReason } : measured;
		return [{ ...step, timing }];
	}).sort((a, b) => a.number - b.number);
	return {
		...job,
		head: observations.findLast(({ head }) => head !== null)?.head ?? null,
		createdAt: reconcileBoundary(observations.map(({ createdAt }) => createdAt)).value,
		startedAt: started.value, completedAt: completed.value,
		execution: reconciledInterval(job.execution, started, completed,
			identityReason ?? (job.conclusion !== "skipped" && (started.conflict || completed.conflict) ? timingConflict : reason),
			{ starts: [attemptStart] }),
		queue: reconciledInterval(job.queue, queued, started, reason, {
			earliestEnd: attemptStart, completedAt: completed.earliest,
		}),
		steps,
	};
};

const reconcileAttemptTiming = (observations, selected) => {
	const { run, status, conclusion } = selected;
	const created = reconcileBoundary(observations.map(({ timing }) => timing.runQueue.startedAt));
	const started = reconcileBoundary(observations.filter(timingStarted).map(({ timing }) => timing.runQueue.completedAt));
	const queueConflict = started.conflict || created.conflict;
	const byId = groupsBy(observations.flatMap(({ timing }) => timing.jobs), ({ id }) => id);
	const jobs = [...byId].sort(([a], [b]) => a - b).flatMap(([id, rows]) => {
		const fallback = selected.timing.jobs.filter((job) => job.id === id);
		if (fallback.some(({ execution }) => jobIdentityReasons.includes(execution.reason))) return fallback;
		const attributable = rows.filter(({ execution }) => !jobIdentityReasons.includes(execution.reason));
		// An unfinished job absent from the final inventory cannot block attempt completion.
		if (!attributable.length || (selected.complete && !fallback.length && !attributable.some(terminal))) return fallback;
		return [reconcileJobTiming(attributable, started.latest)];
	});
	// Only an attributable live job in a same-attempt observation with valid,
	// undisputed queue boundaries can supply the missing cancellation proof.
	const observedInProgress = run.attempt === 1 && conclusion === "cancelled" && !queueConflict &&
		observations.some(({ status, timing }) => status === "in_progress" && timing.runQueue.reason === null &&
			timing.jobs.some(({ head, status, conclusion, startedAt, completedAt, execution }) =>
				head === run.head && status === "in_progress" && conclusion === null && completedAt === null &&
				!jobIdentityReasons.includes(execution.reason) &&
				githubTimestamp(startedAt) !== null && githubTimestamp(startedAt) >= githubTimestamp(started.value)));
	const runQueue = runQueueTiming({
		run_attempt: run.attempt, head_sha: run.head, status, conclusion,
		created_at: created.value, run_started_at: started.value,
	}, jobs, observedInProgress);
	return {
		timing: { jobs, runQueue: run.attempt === 1 && queueConflict
			? { ...runQueue, elapsedMs: null, reason: timingConflict } : runQueue },
		attemptStartBound: started.latest,
		elapsedStartedAt: run.attempt === 1 ? created.value : started.value,
		// A start-only conflict can leave an ordered completion candidate. Let the
		// supplier check compare that unverified end with independently trusted ends.
		elapsedConflict: (run.attempt === 1 ? created.conflict : started.conflict) || jobs.some(({ completedAt, execution }) =>
			completedAt === null && execution.reason === timingConflict),
	};
};

const projectJobTimings = (jobs, runCreatedAt) => {
	const bounds = { starts: [runCreatedAt] };
	const bound = (timing) => timing.reason === null ? interval(timing, null, bounds) : timing;
	// Bound each interval independently. The job start is also the queue end,
	// but an invalid job execution does not invalidate a later completed step.
	return jobs.map((job) => ({
		...job,
		execution: bound(job.execution),
		queue: job.queue.reason === null ? interval(job.queue, null, { ...bounds, completedAt: job.completedAt }) : job.queue,
		steps: job.steps.map((step) => ({ ...step, timing: bound(step.timing) })),
	}));
};

const summarizeCiTimings = (events) => {
	const attempts = new Map();
	for (const { kind, issue, eventId, data } of events) {
		if (kind !== "ci" || (!Object.hasOwn(data, "elapsedScope") && !data.timing)) continue;
		const { run, timing, elapsedMs, elapsedScope, status, conclusion } = data;
		const elapsedStartedAt = run.attempt === 1 ? data.createdAt : timing?.runQueue.completedAt;
		const key = digest({ issue, id: run.id, attempt: run.attempt, head: run.head, workflow: run.workflow });
		const observations = attempts.get(key) ?? [];
		observations.push({ issue, run, eventId, timing, complete: data.complete, elapsedMs: elapsedMs ?? null, elapsedScope: elapsedScope ?? null,
			status, conclusion: conclusion ?? null, runCreatedAt: data.createdAt,
			elapsedStartedAt: elapsedStartedAt ?? null, elapsedCompletedAt: data.completedAt ?? null });
		attempts.set(key, observations);
	}
	return [...attempts.values()].map((observations) => {
		const completed = observations.filter(({ complete, elapsedScope }) => complete !== false && elapsedScope !== null);
		const candidates = completed.length ? completed : observations;
		const timed = candidates.filter(({ timing }) => timing);
		const recent = timed.at(-1) ?? candidates.at(-1);
		const { eventId, timing: _timing, complete, runCreatedAt: _runCreatedAt, ...details } = recent;
		const allTimed = observations.filter((observation) => observation !== recent && observation.timing);
		// Keep the selected status observation, but reconcile all attributable boundaries.
		const reconciled = recent.timing && allTimed.length ? reconcileAttemptTiming([...allTimed, recent], recent) : null;
		const timing = reconciled?.timing ?? recent.timing;
		const creationObservations = observations.map(({ runCreatedAt }) => runCreatedAt);
		const runCreatedAt = reconcileBoundary(creationObservations).latest;
		if (reconciled) details.elapsedStartedAt = reconciled.elapsedStartedAt;
		let elapsed = {};
		if (completed.length && timed.length) {
			const attemptStart = reconciled?.attemptStartBound ?? timing.runQueue.completedAt;
			const suppliers = reconciled?.elapsedConflict ? [] : attemptCompletionSuppliers(timing.jobs, runCreatedAt, attemptStart);
			const last = suppliers.length ? Math.max(...suppliers.map(({ end }) => end)) : null;
			// Original creation bounds retry ordering, but is not a retry queue boundary.
			const retryBounds = recent.run.attempt === 1 ? {} : {
				starts: creationObservations,
			};
			const measured = interval({
				scope: details.elapsedScope, source: "github-job.completed_at",
				startedAt: details.elapsedStartedAt, completedAt: last === null ? null : new Date(last).toISOString(),
			}, reconciled?.elapsedConflict ? timingConflict : last === null ? "job-completion-unobserved" : null, retryBounds);
			const completedJobIds = suppliers.filter(({ end }) => end === last).map(({ id }) => id);
			// Cite only observations that supplied the measured boundaries, not status-only snapshots.
			const sources = measured.reason !== null ? [] : reconciled ? [...allTimed, recent] : [recent];
			const start = githubTimestamp(measured.startedAt);
			elapsed = {
				elapsedMs: measured.elapsedMs,
				elapsedCompletedAt: measured.completedAt,
				elapsedCompletedJobIds: completedJobIds,
				elapsedStartedEventIds: sources.filter((observation) => {
					const queue = observation.timing.runQueue;
					return recent.run.attempt === 1 ? githubTimestamp(queue.startedAt) === start
						: timingStarted(observation) && githubTimestamp(queue.completedAt) === start;
				}).map(({ eventId }) => eventId).sort(),
				elapsedCompletedEventIds: sources.filter(({ timing }) => timing.jobs.some((job) =>
					completedJobIds.includes(job.id) && canSupplyJobCompletion(job) && githubTimestamp(job.completedAt) === last,
				)).map(({ eventId }) => eventId).sort(),
				elapsedReason: measured.reason,
			};
		} else if (complete === false) {
			elapsed = {
				elapsedMs: null,
				elapsedCompletedAt: null,
				elapsedCompletedJobIds: [],
				elapsedReason: "job-completion-unobserved",
			};
		}
		return {
			...details,
			elapsedStartedEventIds: [],
			elapsedCompletedEventIds: [],
			...elapsed,
			eventIds: observations.map(({ eventId }) => eventId),
			finalStatusEventId: completed.length ? eventId : null,
			// Legacy projected field: identifies the selected completed observation, not necessarily its timing suppliers.
			elapsedEventId: completed.length ? eventId : null,
			runQueue: timing?.runQueue ?? null,
			jobs: projectJobTimings(timing?.jobs ?? [], runCreatedAt),
			reason: reconciled?.elapsedConflict ? timingConflict : timing ? null : "legacy-timing-unrecorded",
		};
	}).sort((a, b) => a.issue - b.issue || a.run.id - b.run.id || a.run.attempt - b.run.attempt);
};

/** Aggregate only after the existing issue engine says every work unit is done. */
export const retrospectiveRequest = (root, laneId, snapshots) => {
	if (!Array.isArray(snapshots) || snapshots.length === 0) {
		throw new TypeError("Missing lane observations");
	}
	const remaining = snapshots.filter((item) =>
		item.decision.action !== "done"
	).map((item) => item.issue);
	if (remaining.length) return { action: "wait-lane", remaining };
	const events = readRetroEvents(root, laneId);
	const requirements = [];
	for (const { issue, obs } of snapshots) {
		const pr = obs.pr;
		if (!pr?.number) continue;
		const runs = pr.ciRuns;
		let reason = null;
		if (!Array.isArray(runs) || runs.length === 0) reason = "missing-final-run-observation";
		else if (runs.some((run) => run.head !== pr.headSha || run.status !== "completed"
			|| !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.attempt) || run.attempt < 1
			|| typeof run.workflow !== "string")) reason = "incomplete-final-run-observation";
		else if (runs.some((run) => !events.some((event) => event.issue === issue && event.kind === "ci"
			&& event.data.complete === true && event.data.status === "completed"
			&& event.data.run.id === run.id && event.data.run.attempt === run.attempt
			&& event.data.run.head === pr.headSha && event.data.run.workflow === run.workflow
			&& event.data.conclusion === run.conclusion))) reason = "missing-final-ci-collection";
		if (reason) requirements.push({ issue, pr: pr.number, head: pr.headSha, reason });
	}
	if (requirements.length) return { action: "collect-ci", kind: "input-preparation",
		issues: requirements.map((entry) => entry.issue), requirements };
	const units = snapshots.map(({ issue, obs }) => ({
		issue,
		pr: obs.pr?.number ?? null,
		head: obs.pr?.headSha ?? null,
		mergeCommit: obs.pr?.mergeCommit ?? null,
		ciRuns: obs.pr?.ciRuns ?? [],
	})).sort((a, b) => a.issue - b.issue);
	const subjectKey = digest({ laneId, units });
	const path = resolve(
		retroDirectory(root, laneId),
		`lane-${subjectKey}.json`,
	);
	if (existsSync(path)) {
		const report = JSON.parse(readFileSync(path, "utf8"));
		if (
			report.version !== 1 || report.subjectKey !== subjectKey ||
			report.laneId !== laneId ||
			report.scope !== "lane" ||
			!existsSync(path.replace(/\.json$/u, ".md"))
		) {
			throw new TypeError("Wrong recorded retrospective subject");
		}
		return { action: "done", scope: "lane", subjectKey, report: path };
	}
	const dispatch = dispatchFor("retro");
	validateDispatchTarget(dispatch, readRegisteredAgents(root));
	return {
		action: "retro",
		dispatch,
		scope: "lane",
		laneId,
		subjectKey,
		units,
		report: path,
	};
};

export const retrospectiveEvidence = (root, laneId, snapshots) => {
	const request = retrospectiveRequest(root, laneId, snapshots);
	const lifecycleGaps = [];
	const events = readRetroEvents(root, laneId, lifecycleGaps);
	const reviewBlockers = new Map();
	const unstructuredReviewEventIds = new Set();
	for (const event of events) {
		if (event.kind !== "review") continue;
		const envelopes = Array.isArray(event.data?.reviews)
			? event.data.reviews
			: [event.data && Object.hasOwn(event.data, "envelope")
				? event.data.envelope
				: event.data];
		for (const envelope of envelopes) {
			if (!envelope || !Array.isArray(envelope.blockers)) {
				unstructuredReviewEventIds.add(event.eventId);
				continue;
			}
			for (const blocker of envelope.blockers) {
				if (
					!blocker || typeof blocker.signature !== "string" ||
					!blocker.signature.trim() ||
					typeof envelope.reviewer !== "string"
				) {
					unstructuredReviewEventIds.add(event.eventId);
					continue;
				}
				const identity = {
					reviewer: envelope.reviewer ?? null,
					head: envelope.reviewed_head_sha ?? null,
					policy: envelope.preflight_sha256 ?? null,
					signature: blocker.signature ?? null,
				};
				const key = digest(identity);
				const claim = reviewBlockers.get(key) ??
					{
						...identity,
						disposition: "reported-claim",
						blocker,
						eventIds: [],
					};
				if (!claim.eventIds.includes(event.eventId)) {
					claim.eventIds.push(event.eventId);
				}
				reviewBlockers.set(key, claim);
			}
		}
	}
	const failures = new Map();
	for (const event of events) {
		if (event.kind !== "ci" || !event.data.job) continue;
		const job = event.data.job;
		const key = `${event.data.run.id}:${event.data.run.attempt}:${job.id}`;
		if (!failures.has(key)) failures.set(key, event);
	}
	const byJob = new Map();
	for (const event of failures.values()) {
		const name = event.data.job.name;
		const group = byJob.get(name) ??
			{ job: name, failures: 0, cancellations: 0, eventIds: [] };
		if (event.data.job.conclusion === "cancelled") group.cancellations++;
		else group.failures++;
		group.eventIds.push(event.eventId);
		byJob.set(name, group);
	}
	const externalOverlapObservations = [];
	const externalOverlapUnknowns = [];
	const conflicts = new Map(snapshots.map(({ issue }) => [issue, new Map()]));
	for (const event of events) {
		if (event.kind === "observation") {
			const overlaps = event.data?.externalOverlaps;
			if (overlaps) externalOverlapObservations.push({
				eventId: event.eventId, issue: event.issue, status: overlaps.status,
				laneMatches: overlaps.laneMatches.length, prMatches: overlaps.prMatches.length,
				unknowns: overlaps.unknowns,
			});
			else externalOverlapUnknowns.push({ eventId: event.eventId, issue: event.issue, code: "external-overlap-unrecorded" });
		}
		if (event.kind !== "stage" || event.data?.phase !== "resolve-conflict") continue;
		const result = event.data.result;
		if (typeof result !== "object" || result === null || result.ok !== true) continue;
		// applyChildResult resets this phase to zero only on success; record
		// captures that outcome, unlike the issue's current attempt counters.
		const attempts = event.data.attempts?.["resolve-conflict"];
		if (attempts !== undefined ? attempts !== 0 : result.error?.type === "child-contract-error") continue;
		const head = result.head_sha;
		if (!/^[a-f0-9]{40}$/u.test(head ?? "")) continue;
		const heads = conflicts.get(event.issue) ?? new Map();
		heads.set(head, [...new Set([...(heads.get(head) ?? []), event.eventId])].sort());
		conflicts.set(event.issue, heads);
	}
	return {
		version: 1,
		request,
		events,
		reviewBlockers: [...reviewBlockers.values()],
		unstructuredReviewEventIds: [...unstructuredReviewEventIds],
		workUnits: snapshots.map(({ issue, obs }) => ({
			issue,
			pr: obs.pr,
			attemptCounters: obs.attempts ?? null,
			facts: obs.facts ?? null,
		})),
		ciFailurePatterns: [...byJob.values()].sort((a, b) =>
			b.failures - a.failures || a.job.localeCompare(b.job)
		),
		ciTimings: summarizeCiTimings(events),
		totalElapsedMs: null,
		stageLifecycle: { ...summarizeStageLifecycle(events), storageGaps: lifecycleGaps },
		externalOverlapObservations,
		externalOverlapUnknowns,
		conflictResolutions: [...conflicts].sort(([a], [b]) => a - b).map(([issue, heads]) => ({
			issue, observedConflictResolutions: heads.size,
			heads: [...heads].sort(([a], [b]) => a.localeCompare(b)).map(([head, eventIds]) => ({ head, eventIds })),
			eventIds: [...new Set([...heads.values()].flat())].sort(), history: "unknown",
		})),
		integrationMeasurements: summarizeIntegrationMeasurements(events,
			Object.fromEntries(snapshots.map(({ issue, obs }) => [issue, obs.headSha ?? obs.pr?.headSha]))),
		limitations: [
			"Recorded timestamps are observation times, not execution start/end times.",
			"Attempt counters can reset; distinct observations are not a total execution count.",
			"CI and soak durations have separate scopes and must not be summed as lane duration.",
			"CI timing intervals can overlap. Only allowlisted workflow/job/step purposes are classified; runner initialization and pure shared Linux task execution are not isolated.",
			"Reviewer blockers are reported claims until independently adjudicated.",
			"History before this recorder was enabled may be missing; follow referenced receipts.",
		],
	};
};

const describeInterval = ({ scope, elapsedMs, reason, startedAt, completedAt, source }) =>
	`${scope}: ${elapsedMs === null ? `unknown (${reason})` : `${elapsedMs} ms`} `
	+ `[${startedAt ?? "unknown"} → ${completedAt ?? "unknown"}; source: ${source ?? "unavailable"}]`;

/** Persist analysis only; recommendations never modify code, rules, CI, or remote state. */
export const recordRetrospective = (root, request, report) => {
	if (
		request.action !== "retro" || report?.version !== 1 ||
		report.scope !== "lane" ||
		report.laneId !== request.laneId ||
		report.subjectKey !== request.subjectKey ||
		!["complete", "partial"].includes(report.coverage) ||
		typeof report.summary !== "string" || !report.summary.trim() ||
		report.totalElapsedMs !== null ||
		!Array.isArray(report.unknowns) ||
		report.unknowns.some((item) =>
			typeof item !== "string" || !item.trim()
		) ||
		!["bottlenecks", "startEarlier", "improvements"].every((key) =>
			Array.isArray(report[key])
		)
	) {
		throw new TypeError("Wrong or incomplete retrospective report");
	}
	const events = new Map(
		readRetroEvents(root, report.laneId).map((
			event,
		) => [event.eventId, event]),
	);
	for (
		const item of [
			...report.bottlenecks,
			...report.startEarlier,
			...report.improvements,
		]
	) {
		if (
			typeof item.finding !== "string" || !item.finding.trim() ||
			!["confirmed", "hypothesis"].includes(item.confidence) ||
			!Array.isArray(item.eventIds) || item.eventIds.length === 0 ||
			item.eventIds.some((id) => !events.has(id))
		) {
			throw new TypeError(
				"Retrospective finding lacks recorded evidence",
			);
		}
	}
	if (report.coverage === "partial" && report.unknowns.length === 0) {
		throw new TypeError(
			"Partial retrospective must explain missing evidence",
		);
	}
	if (
		(events.size === 0 ||
			[...events.values()].some((event) => event.kind === "gap")) &&
		report.coverage !== "partial"
	) {
		throw new TypeError(
			"Missing observations cannot be a complete retrospective",
		);
	}
	if (
		request.report !==
			resolve(
				retroDirectory(root, report.laneId),
				`lane-${report.subjectKey}.json`,
			)
	) {
		throw new TypeError("Retrospective output does not match its subject");
	}
	const evidence = [...events.values()].map(({ eventId, path, sha256 }) => ({
		eventId,
		path,
		sha256,
	}));
	if (
		report.improvements.some((item) =>
			!["existingProtection", "verification", "expectedCost"]
				.every((key) =>
					typeof item[key] === "string" && item[key].trim()
				)
		)
	) {
		throw new TypeError(
			"Improvement proposal lacks protection, verification or cost",
		);
	}
	const stored = {
		...report,
		recordedAt: new Date().toISOString(),
		evidence,
		ciTimings: summarizeCiTimings(events.values()),
	};
	mkdirSync(retroDirectory(root, report.laneId), { recursive: true });
	const sections = [["Bottlenecks", report.bottlenecks], [
		"Inspect first",
		report.startEarlier,
	], ["Improvement proposals", report.improvements]];
	const markdown = [
		`# Lane retrospective: ${report.laneId}`,
		"",
		report.summary,
		"",
		`Coverage: ${report.coverage}`,
		`Subject: ${report.subjectKey}`,
		"",
		...sections.flatMap((
			[title, items],
		) => [
			`## ${title}`,
			...items.map((item) =>
				[
					`- [${item.confidence}] ${item.finding}`,
					`  Evidence: ${item.eventIds.join(", ")}`,
					...["existingProtection", "verification", "expectedCost"]
						.filter((key) => item[key])
						.map((key) => `  ${key}: ${item[key]}`),
				].join("\n")
			),
			"",
		]),
		"## Unknowns",
		...report.unknowns.map((value) => `- ${value}`),
		"",
		"## GitHub Actions timing",
		"Intervals can overlap and are not summed. Runner initialization and pure shared Linux task execution are not isolated.",
		...stored.ciTimings.flatMap(({ issue, run, eventIds, finalStatusEventId, status, conclusion, elapsedMs, elapsedScope, elapsedStartedAt, elapsedCompletedAt, elapsedCompletedJobIds, elapsedStartedEventIds, elapsedCompletedEventIds, elapsedReason, reason, runQueue, jobs }) => [
			"",
			`- #${issue}, run ${run.id}, attempt ${run.attempt}, head ${run.head}, workflow ${run.workflow} (${status}/${conclusion})`,
			elapsedScope === null ? "  - Run elapsed: unknown (run not completed)"
				: `  - ${elapsedScope}: ${elapsedMs === null ? `unknown${elapsedReason ? ` (${elapsedReason})` : ""}` : `${elapsedMs} ms`} [${elapsedStartedAt ?? "unknown"} → ${elapsedCompletedAt ?? "unknown"}]${elapsedCompletedJobIds?.length ? `; github-job.completed_at: ${elapsedCompletedJobIds.join(", ")}` : ""}; start evidence: ${elapsedStartedEventIds.join(", ") || "unknown"}; completion evidence: ${elapsedCompletedEventIds.join(", ") || "unknown"}`,
			`  - ${runQueue ? describeInterval(runQueue) : `Timing breakdown: unknown (${reason})`}`,
			...(finalStatusEventId === null ? [] : [`  - Final status evidence: ${finalStatusEventId}`]),
			`  - Timing evidence: ${eventIds.join(", ")}`,
			...jobs.flatMap((job) => [
				`  - Job ${job.id}: ${job.name} (${job.status}/${job.conclusion})`,
				...([job.queue, job.execution, job.runnerSetup].map((item) => `    - ${describeInterval(item)}`)),
				...job.steps.map((step) => `    - Step ${step.number}: ${step.name} (${step.status ?? "unknown"}/${step.conclusion ?? "unknown"}): ${describeInterval(step.timing)}`),
			]),
		]),
		"",
		"## Evidence",
		...evidence.map((item) => `- ${item.path} (${item.sha256})`),
		"",
	].join("\n");
	writeFileSync(request.report.replace(/\.json$/u, ".md"), markdown);
	publishJson(request.report, stored);
	return {
		report: request.report,
		markdown: request.report.replace(/\.json$/u, ".md"),
	};
};
