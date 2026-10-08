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

const kinds = new Set([
	"stage",
	"review",
	"implementer",
	"ci",
	"incident",
	"gap",
	"merge",
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
	const identity = { version: 1, laneId, issue, kind, data };
	const eventId = digest(identity);
	const directory = resolve(
		retroDirectory(root, laneId),
		`issue-${issue}`,
		"events",
	);
	mkdirSync(directory, { recursive: true });
	const path = resolve(directory, `${eventId}.json`);
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

export const readRetroEvents = (root, laneId) => {
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
			if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
			const path = resolve(events, name);
			const bytes = readFileSync(path);
			const event = JSON.parse(bytes);
			const identity = {
				version: event.version,
				laneId: event.laneId,
				issue: event.issue,
				kind: event.kind,
				data: event.data,
			};
			if (
				event.version !== 1 || event.laneId !== laneId ||
				`issue-${event.issue}` !== unit.name ||
				!kinds.has(event.kind) ||
				digest(identity) !== event.eventId ||
				name !== `${event.eventId}.json` ||
				!Number.isFinite(Date.parse(event.recordedAt))
			) {
				throw new TypeError(
					`Invalid retrospective observation: ${path}`,
				);
			}
			records.push({
				...event,
				path: relative(root, path),
				sha256: sha(bytes),
			});
		}
	}
	return records.sort((a, b) =>
		a.recordedAt.localeCompare(b.recordedAt) ||
		a.eventId.localeCompare(b.eventId)
	);
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
			createdAt: run.created_at,
			completedAt: end === null ? null : new Date(end).toISOString(),
			elapsedMs: Number.isFinite(start) && end !== null && end >= start
				? end - start
				: null,
			elapsedScope: run.run_attempt === 1
				? "initial-run-including-queue"
				: "retry-attempt-excluding-queue",
			jobCount: jobs.length,
		}));
	}
	return recorded;
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
	const units = snapshots.map(({ issue, obs }) => ({
		issue,
		pr: obs.pr?.number ?? null,
		head: obs.pr?.headSha ?? null,
		mergeCommit: obs.pr?.mergeCommit ?? null,
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
	return {
		action: "retro",
		scope: "lane",
		laneId,
		subjectKey,
		units,
		report: path,
	};
};

export const retrospectiveEvidence = (root, laneId, snapshots) => {
	const request = retrospectiveRequest(root, laneId, snapshots);
	const events = readRetroEvents(root, laneId);
	const reviewBlockers = new Map();
	const unstructuredReviewEventIds = new Set();
	for (const event of events) {
		if (event.kind !== "review") continue;
		const envelopes = Array.isArray(event.data?.reviews)
			? event.data.reviews
			: [event.data];
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
		totalElapsedMs: null,
		limitations: [
			"Recorded timestamps are observation times, not execution start/end times.",
			"Attempt counters can reset; distinct observations are not a total execution count.",
			"CI and soak durations have separate scopes and must not be summed as lane duration.",
			"Reviewer blockers are reported claims until independently adjudicated.",
			"History before this recorder was enabled may be missing; follow referenced receipts.",
		],
	};
};

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
