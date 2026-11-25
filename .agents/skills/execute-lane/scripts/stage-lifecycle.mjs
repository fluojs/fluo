import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const stageAgents = new Map([
	["preflight", "fluo-issue-preflight"],
	["implement", "fluo-issue-implementer"],
	["fix-back", "fluo-issue-implementer"],
	["review:contract", "fluo-contract-reviewer"],
	["review:code", "fluo-code-reviewer"],
	["review:verification", "fluo-verification-reviewer"],
]);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const index = (value) => Number.isSafeInteger(value) && value >= 0;
const iso = (value) => typeof value === "string" &&
	/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));

const readSource = (path, parse, unknowns) => {
	if (!text(path) || !isAbsolute(path)) {
		unknowns.push({ code: "source-unavailable", path: null });
		return null;
	}
	try {
		return parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		unknowns.push({ code: error instanceof SyntaxError ? "source-invalid" : "source-unreadable", path });
		return null;
	}
};

const outcomeFor = (record) => {
	if (record.lastTurnEnd?.deadlineStop === true) return "interrupted";
	switch (record.lastTurnEnd?.endedBy) {
		case "clean": return "completed";
		case "provider-error":
		case "policy-rejection": return "failed";
		case "user-abort":
		case "system-abort":
		case "provider-abort":
		case "unknown-abort": return "interrupted";
		default: return null;
	}
};

/** Parse native task custody and durable child lifecycle without copying conversation content. */
export const collectStageLifecycle = (input) => {
	const { stage, taskId, parentSessionId, taskFile, sessionFile } = input ?? {};
	if (
		!stageAgents.has(stage) || typeof taskId !== "string" ||
		!/^st_[a-f0-9]+$/u.test(taskId) || !text(parentSessionId)
	) {
		throw new TypeError("Stage lifecycle requires the lead's stage, native task ID and parent session ID");
	}
	const unknowns = [];
	const task = readSource(taskFile, JSON.parse, unknowns);
	const taskMatches = task?.task_id === taskId && task.parent_session_id === parentSessionId &&
		task.agent_type === stageAgents.get(stage) && task.background_mode === "background";
	if (task !== null && !taskMatches) unknowns.push({ code: "task-identity-mismatch", path: taskFile });

	const lines = readSource(sessionFile, (bytes) => bytes.trimEnd().split("\n"), unknowns);
	const checkpoints = [];
	let childSessionId = taskMatches && text(task.child_session_id) ? task.child_session_id : null;
	if (lines !== null) {
		const parseLine = (line, offset) => {
			try {
				return JSON.parse(line);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				unknowns.push({ code: "source-invalid", path: sessionFile, line: offset + 1 });
				return null;
			}
		};
		const header = parseLine(lines[0], 0);
		const linked = header?.type === "session" && text(header.id) &&
			header.spawnedBy?.taskId === taskId && header.spawnedBy.parentSessionId === parentSessionId &&
			(childSessionId === null || childSessionId === header.id) && (task === null || taskMatches);
		if (linked) {
			childSessionId = header.id;
			for (const [offset, line] of lines.entries()) {
				if (offset === 0) continue;
				const entry = parseLine(line, offset);
				if (entry?.type !== "custom" || entry.customType !== "session-lifecycle") continue;
				const record = entry.data;
				if (record?.taskId !== taskId || record.parentSessionId !== parentSessionId ||
					record.sessionId !== childSessionId || record.role !== "child" || !text(entry.id)) {
					unknowns.push({ code: "checkpoint-identity-mismatch", path: sessionFile, line: offset + 1 });
					continue;
				}
				if (!text(record.runId)) continue; // The host also checkpoints input admission before any run.
				if (!index(record.epoch) || !index(record.seq) || typeof record.runActive !== "boolean" ||
					record.persisted !== true || record.restoring !== false) {
					unknowns.push({ code: "checkpoint-incomplete", path: sessionFile, entryId: entry.id });
					continue;
				}
				checkpoints.push({
					runId: record.runId, epoch: record.epoch, seq: record.seq, active: record.runActive,
					outcome: record.runActive ? null : outcomeFor(record),
					entryId: entry.id, path: sessionFile, recordedAt: iso(entry.timestamp) ? entry.timestamp : null,
				});
			}
		} else {
			unknowns.push({ code: "session-identity-mismatch", path: sessionFile });
		}
	}

	// This clock belongs to the task runner, not to any one engine run in its session.
	const attempt = taskMatches && childSessionId !== null && index(task.run_start_epoch) &&
		task.run_start_epoch === task.notification?.run_epoch ? {
			epoch: task.run_start_epoch,
			path: taskFile,
			elapsedMs: ["completed", "error", "interrupted", "cancelled"].includes(task.status) &&
				iso(task.terminal_at) && task.run_stats?.duration_status === "monotonic" &&
				Number.isFinite(task.run_stats.runtime_ms) && task.run_stats.runtime_ms >= 0
				? task.run_stats.runtime_ms : null,
		} : null;
	return { stage, taskId, parentSessionId, childSessionId, checkpoints, attempt, unknowns };
};

const sameBoundary = (a, b) => a.active === b.active && a.outcome === b.outcome &&
	a.epoch === b.epoch && a.entryId === b.entryId && a.recordedAt === b.recordedAt;
const sortedIds = (ids) => [...new Set(ids)].sort();

const summarizeRun = (checkpoints) => {
	const ordered = [...checkpoints].sort((a, b) => a.seq - b.seq || a.eventId.localeCompare(b.eventId));
	const eventIds = sortedIds(ordered.map(({ eventId }) => eventId));
	const conflict = ordered.some((checkpoint, i) => i > 0 && (
		checkpoint.epoch !== ordered[0].epoch ||
		(checkpoint.seq === ordered[i - 1].seq && !sameBoundary(checkpoint, ordered[i - 1]))
	));
	const first = ordered.find(({ active }) => active);
	const last = ordered.find(({ outcome }) => outcome !== null);
	const inconsistent = conflict || (last !== undefined && ordered.some(({ seq, active, outcome }) =>
		(active && seq >= last.seq) || (outcome !== null && outcome !== last.outcome)));
	const ref = ({ path, entryId, recordedAt, eventId }) => ({ path, entryId, recordedAt, eventId });
	return {
		runId: ordered[0].runId, childSessionId: ordered[0].childSessionId,
		epoch: inconsistent ? null : ordered[0].epoch,
		head: null, clock: null, elapsedMs: null, eventIds,
		start: !inconsistent && first ? ref(first) : null,
		end: !inconsistent && last ? ref(last) : null,
		outcome: !inconsistent && first && last ? last.outcome : null,
		unknowns: inconsistent ? ["conflicting-checkpoints"] : [
			...(first ? [] : ["start-unobserved"]), ...(last ? [] : ["end-unobserved"]),
			"execution-head-unobserved", "run-clock-unavailable",
		],
	};
};

const summarizeAttempts = (observations) => {
	const attempts = Map.groupBy(observations.filter(({ data }) => data.attempt !== null), ({ data }) => data.attempt.epoch);
	return [...attempts].sort(([a], [b]) => a - b).map(([epoch, events]) => {
		const measured = events.filter(({ data }) => data.attempt.elapsedMs !== null);
		const values = new Set(measured.map(({ data }) => data.attempt.elapsedMs));
		return {
			epoch, childSessionId: events[0].data.childSessionId,
			elapsedMs: values.size === 1 ? [...values][0] : null,
			clock: values.size === 1 ? "native-task-monotonic" : null,
			eventIds: sortedIds(events.map(({ eventId }) => eventId)),
			sources: sortedIds(events.map(({ data }) => data.attempt.path)),
			unknown: values.size === 1 ? null : values.size > 1 ? "conflicting-attempt-clock" : "attempt-clock-unavailable",
		};
	});
};

export const summarizeStageLifecycle = (events) => {
	const nativeEvents = events.filter(({ kind }) => kind === "stage-lifecycle");
	const tasks = Map.groupBy(nativeEvents, ({ data }) => data.taskId);
	const dispatches = [...tasks].sort(([a], [b]) => a.localeCompare(b)).map(([taskId, observations]) => {
		const bindings = new Set(observations.map(({ issue, data }) => JSON.stringify([issue, data.stage, data.parentSessionId])));
		const children = Map.groupBy(observations.filter(({ data }) => data.childSessionId !== null),
			({ data }) => data.childSessionId);
		const consistent = bindings.size === 1;
		const { issue, data } = observations[0];
		const runs = [];
		const attempts = [];
		if (consistent) {
			for (const [childSessionId, captures] of [...children].sort(([a], [b]) => a.localeCompare(b))) {
				const checkpoints = captures.flatMap(({ eventId, data }) =>
					data.checkpoints.map((checkpoint) => ({ ...checkpoint, eventId, childSessionId })));
				const byRun = Map.groupBy(checkpoints, ({ runId }) => runId);
				const childRuns = [...byRun].sort(([a], [b]) => a.localeCompare(b)).map(([, records]) => summarizeRun(records));
				runs.push(...childRuns);
				attempts.push(...summarizeAttempts(captures));
			}
		}
		return {
			taskId, issue: consistent ? issue : null, stage: consistent ? data.stage : null,
			parentSessionId: consistent ? data.parentSessionId : null,
			childSessionIds: consistent ? [...children.keys()].sort() : [],
			eventIds: sortedIds(observations.map(({ eventId }) => eventId)),
			runs, attempts,
			unknowns: consistent ? [
				...observations.flatMap(({ eventId, data }) => data.unknowns.map((gap) => ({ ...gap, eventId }))),
				...(runs.some(({ start }) => start !== null) ? [] : [{ code: "start-unobserved" }]),
			] : [{ code: "conflicting-dispatch-binding" }],
		};
	});
	const observedStarts = dispatches.reduce((count, { runs }) => count + runs.filter(({ start }) => start !== null).length, 0);
	return {
		coverage: "partial", observedStarts: observedStarts || null, dispatches,
		unknowns: [nativeEvents.length ? "lifecycle-history-incomplete" : "native-lifecycle-uncollected"],
	};
};
