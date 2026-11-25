import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { captureRetroCi } from "./lane-v4-cli.mjs";
import { decideNext } from "./lane-v4.mjs";
import {
	readRetroEvents,
	recordCiSnapshot,
	recordRetroEvent,
	recordRetrospective,
	retrospectiveEvidence,
	retrospectiveRequest,
} from "../../retrospective-lane/scripts/retro.mjs";

const head = "a".repeat(40);

test('external overlap evidence: polling and repeated conflict heads -> event counts and observed successes stay distinct', (t) => {
	const root = fixture(t);
	const overlaps = { version: 1, status: "complete", laneMatches: [{ lane_id: "other", issue: 99, files: ["src/a.ts"] }],
		prMatches: [], unknowns: [] };
	const first = recordRetroEvent(root, laneId, 1, "observation", { observationId: "first", externalOverlaps: overlaps });
	const second = recordRetroEvent(root, laneId, 1, "observation", { observationId: "second",
		externalOverlaps: { ...overlaps, status: "unobservable", unknowns: [{ source: "pr", subject: "OPEN", code: "command-failed" }] } });
	const old = recordRetroEvent(root, laneId, 1, "observation", { action: "resolve-conflict" });
	const successful = recordRetroEvent(root, laneId, 1, "stage", {
		phase: "resolve-conflict", head: head, result: { ok: true, head_sha: "c".repeat(40) } });
	const repeated = recordRetroEvent(root, laneId, 1, "stage", {
		phase: "resolve-conflict", head: "d".repeat(40), result: { ok: true, head_sha: "c".repeat(40) } });
	recordRetroEvent(root, laneId, 1, "stage", {
		phase: "resolve-conflict", head, result: { ok: false, head_sha: "e".repeat(40) } });

	const evidence = retrospectiveEvidence(root, laneId, snapshots);

	assert.deepEqual(evidence.externalOverlapObservations.map(item => item.eventId).sort(), [first.eventId, second.eventId].sort());
	assert.ok(evidence.externalOverlapObservations.every(item => item.issue === 1 && item.laneMatches === 1 && item.prMatches === 0));
	assert.equal(evidence.externalOverlapObservations.find(item => item.eventId === second.eventId).status, "unobservable");
	assert.deepEqual(evidence.conflictResolutions, [{ issue: 1, observedConflictResolutions: 1,
		heads: [{ head: "c".repeat(40), eventIds: [successful.eventId, repeated.eventId].sort() }],
		eventIds: [successful.eventId, repeated.eventId].sort(), history: "unknown" }]);
	assert.ok(evidence.externalOverlapUnknowns.some(item => item.eventId === old.eventId));
	assert.equal(evidence.totalElapsedMs, null);
});
const mergeCommit = "b".repeat(40);
const laneId = "retro-test";
const fixture = (t, completeCi = false) => {
	const directory = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir();
	mkdirSync(directory, { recursive: true });
	const root = mkdtempSync(resolve(directory, "retrospective-lane-"));
	if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(resolve(root, ".omo"));
	writeFileSync(resolve(root, ".omo/omo.jsonc"),
		readFileSync(new URL("../../../../.omo/omo.jsonc", import.meta.url)));
	if (completeCi) recordCiSnapshot(root, laneId, 1, ciRun(), [ciJob()]);
	return root;
};
const snapshots = [{
	issue: 1,
	decision: { action: "done" },
	obs: {
		pr: { number: 10, headSha: head, mergeCommit, ciRuns: [{
			id: 20, attempt: 1, head, workflow: ".github/workflows/ci.yml",
			status: "completed", conclusion: "failure",
		}] },
		facts: {},
		attempts: {},
	},
}];

test('#4130 fix-back retrospective: engine-rejected conflict outcomes -> only genuine success contributes its head', (t) => {
	const root = fixture(t);
	const rejected = [
		{ result: { ok: true, head_sha: head, error: { type: "child-contract-error" } } },
		{ result: { ok: true, head_sha: "d".repeat(40) }, attempts: { "resolve-conflict": 1 } },
		{ result: { ok: false, head_sha: "e".repeat(40) } },
		{ result: { ok: "true", head_sha: "f".repeat(40) } },
		{ result: null },
	];
	for (const outcome of rejected) {
		recordRetroEvent(root, laneId, 1, "stage", { phase: "resolve-conflict", head, ...outcome });
	}
	const success = recordRetroEvent(root, laneId, 1, "stage", {
		phase: "resolve-conflict", head, attempts: { "resolve-conflict": 0 },
		result: { ok: true, head_sha: "c".repeat(40) },
	});

	const evidence = retrospectiveEvidence(root, laneId, snapshots);

	assert.deepEqual(evidence.conflictResolutions, [{ issue: 1, observedConflictResolutions: 1,
		heads: [{ head: "c".repeat(40), eventIds: [success.eventId] }],
		eventIds: [success.eventId], history: "unknown" }]);
});

const report = (request, eventId) => ({
	version: 1,
	scope: "lane",
	laneId,
	subjectKey: request.subjectKey,
	coverage: "complete",
	totalElapsedMs: null,
	summary: "Measured observations",
	bottlenecks: [{
		finding: "Recorded blocker",
		confidence: "confirmed",
		eventIds: [eventId],
	}],
	startEarlier: [],
	improvements: [],
	unknowns: [],
});
const ciRun = (attempt = 1) => ({
	id: 20,
	run_attempt: attempt,
	head_sha: head,
	path: ".github/workflows/ci.yml",
	html_url: "https://github.com/fluojs/fluo/actions/runs/20",
	status: "completed",
	conclusion: "failure",
	created_at: "2026-10-08T01:00:00Z",
});
const ciJob = (attempt = 1, conclusion = "failure") => ({
	id: 30 + attempt,
	run_id: 20,
	run_attempt: attempt,
	name: "tooling-1",
	status: "completed",
	conclusion,
	started_at: "2026-10-08T01:01:00Z",
	completed_at: "2026-10-08T01:03:00Z",
	html_url: "https://github.com/fluojs/fluo/actions/runs/20/job/31",
	steps: [{ number: 1, name: "Execute task", conclusion }],
});

test("final CI preparation: missing final run collection -> no retrospective dispatch", (t) => {
	const root = fixture(t);

	const request = retrospectiveRequest(root, laneId, snapshots);

	assert.equal(request.action, "collect-ci");
	assert.deepEqual(request.issues, [1]);
});

test('#4091 retrospective: complete CI -> analyst dispatch; unfinished lane -> no dispatch', (t) => {
	const root = fixture(t, true);

	const request = retrospectiveRequest(root, laneId, snapshots);

	assert.equal(request.action, 'retro');
	assert.deepEqual(request.dispatch, { subagent_type: 'fluo-retrospective' });
	const waiting = retrospectiveRequest(root, laneId, [{ issue: 1, decision: { action: 'review' } }]);
	assert.deepEqual(waiting, { action: 'wait-lane', remaining: [1] });
});

test('#4091 retrospective: missing analyst registration -> typed input preparation', (t) => {
	const root = fixture(t, true);
	writeFileSync(resolve(root, '.omo/omo.jsonc'), '{"agents":{}}');

	assert.throws(() => retrospectiveRequest(root, laneId, snapshots),
		(error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
			&& error.code === 'dispatch-target-unavailable' && error.subagent_type === 'fluo-retrospective');
});

test('#4091 registration JSONC: comments and trailing commas -> retrospective analyst dispatch', (t) => {
	const root = fixture(t, true);
	const path = resolve(root, '.omo/omo.jsonc');
	const { agents } = JSON.parse(readFileSync(path));
	writeFileSync(path, `// registered stage agents
{ /* operator note */
  "routes": ["https://example.test//model/*prompt*/",],
  "agents": ${JSON.stringify(agents)},
}`);

	const request = retrospectiveRequest(root, laneId, snapshots);

	assert.equal(request.action, 'retro');
	assert.equal(request.dispatch.subagent_type, 'fluo-retrospective');
});

for (const defect of ['missing', 'broken']) {
	test(`#4091 registration unreadable: ${defect} config -> typed retrospective block`, (t) => {
		const root = fixture(t, true);
		const path = resolve(root, '.omo/omo.jsonc');
		if (defect === 'missing') rmSync(path);
		else writeFileSync(path, '{"agents":');

		assert.throws(() => retrospectiveRequest(root, laneId, snapshots),
			(error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
				&& error.code === 'dispatch-registration-unreadable');
	});
}

for (const defect of ["missing-observation", "old-head", "old-attempt", "incomplete-jobs", "tampered-event"]) {
	test(`final CI preparation: ${defect} -> collection required or integrity rejection`, (t) => {
		const root = fixture(t);
		const observed = structuredClone(snapshots);
		let run = ciRun();
		let job = ciJob();
		if (defect === "missing-observation") delete observed[0].obs.pr.ciRuns;
		if (defect === "old-head") run = { ...run, head_sha: "c".repeat(40) };
		if (defect === "old-attempt") observed[0].obs.pr.ciRuns[0].attempt = 2;
		if (defect === "incomplete-jobs") job = { ...job, status: "in_progress", conclusion: null };
		const stored = recordCiSnapshot(root, laneId, 1, run, [job]);
		if (defect === "tampered-event") {
			const path = stored.at(-1).path;
			const event = JSON.parse(readFileSync(path));
			event.data.complete = true;
			event.data.run.attempt = 2;
			writeFileSync(path, JSON.stringify(event));
		}

		if (defect === "tampered-event") assert.throws(() => retrospectiveRequest(root, laneId, observed), /Invalid retrospective/u);
		else assert.equal(retrospectiveRequest(root, laneId, observed).action, "collect-ci");
	});
}

test("final CI preparation: recollected final attempt -> unblocks without losing failures or inventing duration", (t) => {
	const root = fixture(t, true);
	const observed = structuredClone(snapshots);
	observed[0].obs.pr.ciRuns[0] = { ...observed[0].obs.pr.ciRuns[0], attempt: 2, conclusion: "success" };
	assert.equal(retrospectiveRequest(root, laneId, observed).action, "collect-ci");
	const run = { ...ciRun(2), conclusion: "success", run_started_at: "2026-10-08T01:01:00Z" };
	const stored = recordCiSnapshot(root, laneId, 1, run, [ciJob(2, "success")]);
	const bytes = readFileSync(stored.at(-1).path);

	const request = retrospectiveRequest(root, laneId, observed);

	assert.equal(request.action, "retro");
	recordCiSnapshot(root, laneId, 1, run, [ciJob(2, "success")]);
	assert.deepEqual(readFileSync(stored.at(-1).path), bytes);
	const events = readRetroEvents(root, laneId);
	assert.equal(events.filter((event) => event.data.conclusion === "success").length, 1);
	assert.equal(events.find((event) => event.data.conclusion === "success").data.elapsedMs, 120000);
	assert.ok(events.some((event) => event.data.job?.conclusion === "failure"));
	assert.equal(retrospectiveEvidence(root, laneId, observed).ciFailurePatterns[0].failures, 1);
});

test("raw reviewer blockers remain immutable after PASS and deduplicate replayed input", (t) => {
	const root = fixture(t);
	const blocked = {
		reviewer: "code",
		reviewed_head_sha: head,
		verdict_signal: "BLOCK",
		blockers: [{ signature: "runtime:ownership", fix_back_eligible: true }],
	};
	const first = recordRetroEvent(root, laneId, 1, "review", blocked);
	const bytes = readFileSync(first.path);
	const replay = recordRetroEvent(root, laneId, 1, "review", {
		blockers: blocked.blockers,
		verdict_signal: "BLOCK",
		reviewed_head_sha: head,
		reviewer: "code",
	});
	assert.equal(replay.eventId, first.eventId);
	assert.deepEqual(readFileSync(first.path), bytes);
	recordRetroEvent(root, laneId, 1, "review", {
		...blocked,
		verdict_signal: "PASS",
		blockers: [],
	});
	assert.equal(readRetroEvents(root, laneId).length, 2);
	assert.deepEqual(
		readRetroEvents(root, laneId).find((event) =>
			event.eventId === first.eventId
		).data,
		blocked,
	);
	recordRetroEvent(root, laneId, 1, "review", { reviews: [blocked] });
	const evidence = retrospectiveEvidence(root, laneId, snapshots);
	assert.equal(evidence.reviewBlockers.length, 1);
	assert.equal(evidence.reviewBlockers[0].disposition, "reported-claim");
	assert.equal(evidence.reviewBlockers[0].eventIds.length, 2);
});

const historicalReview = {
	reviewer: "code",
	reviewed_head_sha: head,
	preflight_sha256: "c".repeat(64),
	verdict_signal: "BLOCK",
	blockers: [{
		reviewer: "code",
		signature: "runtime:ownership",
		evidence: "src/runtime.ts:1",
		fix_back_eligible: true,
		status: "unresolved",
	}],
};

test("#4233 retrospectiveEvidence: six historical wrapper PASS events -> structured reviews and immutable evidence", (t) => {
	const root = fixture(t);
	const observed = structuredClone(snapshots);
	const before = structuredClone(observed);
	const ledger = resolve(root, ".omo/lanes-v4/lane.json");
	mkdirSync(resolve(root, ".omo/lanes-v4"), { recursive: true });
	const ledgerBytes = JSON.stringify({
		version: 4,
		lane_id: laneId,
		issues: {
			1: {
				facts: { review: { verdict: "pass" } },
				approvals: { merge: false },
				attempts: { implement: 2 },
			},
		},
	});
	writeFileSync(ledger, ledgerBytes);
	const recorded = ["contract", "code", "verification"].flatMap((reviewer) =>
		[head, "d".repeat(40)].map((reviewed_head_sha) =>
			recordRetroEvent(root, laneId, 1, "review", {
				source: "reviewer-task",
				envelope: {
					...historicalReview,
					reviewer,
					reviewed_head_sha,
					verdict_signal: "PASS",
					blockers: [],
				},
			})
		)
	);
	const bytes = recorded.map(({ path }) => readFileSync(path));

	const evidence = retrospectiveEvidence(root, laneId, observed);

	assert.deepEqual(evidence.unstructuredReviewEventIds, []);
	assert.deepEqual(evidence.reviewBlockers, []);
	assert.deepEqual(
		evidence.events.map(({ eventId }) => eventId).sort(),
		recorded.map(({ eventId }) => eventId).sort(),
	);
	assert.deepEqual(
		evidence.events.map(({ data }) => data).sort((a, b) =>
			JSON.stringify(a).localeCompare(JSON.stringify(b))
		),
		recorded.map(({ path }) => JSON.parse(readFileSync(path)).data).sort((
			a,
			b,
		) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	);
	assert.deepEqual(recorded.map(({ path }) => readFileSync(path)), bytes);
	assert.equal(readFileSync(ledger, "utf8"), ledgerBytes);
	assert.deepEqual(observed, before);
});

test("#4233 retrospectiveEvidence: direct batch and wrapper BLOCK -> deduplicated claims retain distinct identities and event IDs after PASS", (t) => {
	const root = fixture(t);
	const variants = [
		historicalReview,
		{
			...historicalReview,
			reviewer: "contract",
			blockers: [{
				...historicalReview.blockers[0],
				reviewer: "contract",
			}],
		},
		{ ...historicalReview, reviewed_head_sha: "d".repeat(40) },
		{ ...historicalReview, preflight_sha256: "e".repeat(64) },
		{
			...historicalReview,
			blockers: [{
				...historicalReview.blockers[0],
				signature: "runtime:shutdown",
			}],
		},
	];
	const records = variants.map((envelope) => [
		recordRetroEvent(root, laneId, 1, "review", envelope),
		recordRetroEvent(root, laneId, 1, "review", {
			reviews: [envelope, envelope],
		}),
		recordRetroEvent(root, laneId, 1, "review", { envelope }),
	]);
	recordRetroEvent(root, laneId, 1, "review", {
		envelope: { ...historicalReview, verdict_signal: "PASS", blockers: [] },
	});

	const evidence = retrospectiveEvidence(root, laneId, snapshots);

	assert.deepEqual(evidence.unstructuredReviewEventIds, []);
	assert.deepEqual(
		evidence.reviewBlockers.map((claim) => ({
			...claim,
			eventIds: [...claim.eventIds].sort(),
		})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		variants.map((envelope, index) => ({
			reviewer: envelope.reviewer,
			head: envelope.reviewed_head_sha,
			policy: envelope.preflight_sha256,
			signature: envelope.blockers[0].signature,
			disposition: "reported-claim",
			blocker: envelope.blockers[0],
			eventIds: records[index].map(({ eventId }) => eventId).sort(),
		})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	);
});

test("#4233 retrospectiveEvidence: malformed wrappers and batches -> raw events and valid sibling blockers survive", (t) => {
	const root = fixture(t);
	const malformed = [
		{ envelope: null },
		{ envelope: "unparsed review" },
		{ envelope: { ...historicalReview, blockers: null } },
		{
			envelope: {
				...historicalReview,
				blockers: [
					null,
					{ signature: " " },
					...historicalReview.blockers,
				],
			},
		},
		{ reviews: null },
		{ reviews: [null, { blockers: "invalid" }, historicalReview] },
	];
	const records = malformed.map((data) =>
		recordRetroEvent(root, laneId, 1, "review", data)
	);
	const bytes = records.map(({ path }) => readFileSync(path));

	const evidence = retrospectiveEvidence(root, laneId, snapshots);

	assert.deepEqual(
		[...evidence.unstructuredReviewEventIds].sort(),
		records.map(({ eventId }) => eventId).sort(),
	);
	assert.deepEqual(evidence.reviewBlockers, [{
		reviewer: historicalReview.reviewer,
		head,
		policy: historicalReview.preflight_sha256,
		signature: historicalReview.blockers[0].signature,
		disposition: "reported-claim",
		blocker: historicalReview.blockers[0],
		eventIds: evidence.events.filter(({ eventId }) =>
			[records[3].eventId, records[5].eventId].includes(eventId)
		).map(({ eventId }) => eventId),
	}]);
	assert.deepEqual(
		evidence.events.map(({ eventId }) => eventId).sort(),
		records.map(({ eventId }) => eventId).sort(),
	);
	assert.deepEqual(records.map(({ path }) => readFileSync(path)), bytes);
});

test("malformed and failed implementer outcomes preserve their original shape", (t) => {
	const root = fixture(t);
	recordRetroEvent(root, laneId, 1, "implementer", null);
	recordRetroEvent(root, laneId, 1, "implementer", {
		ok: false,
		head_sha: head,
		errors: ["TS2304"],
	});
	const events = readRetroEvents(root, laneId);
	assert.equal(events.length, 2);
	assert.ok(events.some((event) => event.data === null));
	assert.ok(events.some((event) => event.data?.errors?.[0] === "TS2304"));
});

test("malformed raw reviewer returns remain visible without breaking aggregate evidence", (t) => {
	const root = fixture(t);
	const event = recordRetroEvent(root, laneId, 1, "review", {
		reviews: [{
			reviewer: "code",
			blockers: [null, { evidence: "missing identity" }],
		}, null],
	});
	const evidence = retrospectiveEvidence(root, laneId, snapshots);
	assert.deepEqual(evidence.unstructuredReviewEventIds, [event.eventId]);
	assert.equal(evidence.reviewBlockers.length, 0);
	assert.equal(evidence.events.length, 1);
});

test("CI failure patterns distinguish attempts, replay, cancellation and measured run duration", (t) => {
	const root = fixture(t);
	recordCiSnapshot(root, laneId, 1, ciRun(), [ciJob()]);
	recordCiSnapshot(root, laneId, 1, ciRun(), [ciJob()]);
	recordCiSnapshot(root, laneId, 1, ciRun(2), [ciJob(2)]);
	recordCiSnapshot(
		root,
		laneId,
		1,
		{ ...ciRun(3), conclusion: "cancelled" },
		[ciJob(3, "cancelled")],
	);
	const evidence = retrospectiveEvidence(root, laneId, snapshots);
	assert.equal(evidence.ciFailurePatterns[0].failures, 2);
	assert.equal(evidence.ciFailurePatterns[0].cancellations, 1);
	assert.equal(evidence.totalElapsedMs, null);
	assert.equal(
		evidence.events.filter((event) =>
			Object.hasOwn(event.data, "elapsedMs")
		).length,
		3,
	);
	assert.equal(
		evidence.events.find((event) =>
			event.data.run.attempt === 1 &&
			Object.hasOwn(event.data, "elapsedMs")
		).data.elapsedMs,
		180000,
	);
	assert.equal(
		evidence.events.find((event) =>
			event.data.run.attempt === 2 &&
			Object.hasOwn(event.data, "elapsedMs")
		).data.elapsedMs,
		null,
	);
});

test("CI failures can be retained before the whole run settles without fabricating a run duration", (t) => {
	const root = fixture(t);
	const knownStep = {
		number: 1, name: "Restore verification image", conclusion: "success", status: "completed",
		started_at: "2026-10-08T01:01:10Z", completed_at: "2026-10-08T01:01:20Z",
	};
	recordCiSnapshot(root, laneId, 1, {
		...ciRun(),
		status: "in_progress",
		conclusion: null,
	}, [ciJob(), { ...ciJob(1, "success"), id: 32, name: "Verify task (tooling-1) / tooling-1", steps: [knownStep] }]);
	const evidence = retrospectiveEvidence(root, laneId, snapshots);
	assert.deepEqual(evidence.events.filter(({ data }) => data.job).map(({ data }) => data.job.id), [31]);
	assert.equal(evidence.events.some(({ data }) => Object.hasOwn(data, "elapsedMs")), false);
	assert.equal(evidence.request.action, "collect-ci");
	assert.equal(evidence.ciTimings[0].elapsedMs, null);
	assert.equal(evidence.ciTimings[0].jobs.find(({ id }) => id === 32).steps[0].timing.elapsedMs, 10000);
	assert.throws(
		() =>
			recordCiSnapshot(root, laneId, 1, ciRun(), [{
				...ciJob(),
				run_id: 21,
			}]),
		TypeError,
	);
	assert.throws(
		() => recordCiSnapshot(root, laneId, 1, ciRun(2), [ciJob()]),
		TypeError,
	);
});

test("lane retrospective waits for all original execution decisions and deduplicates a completed merge set", (t) => {
	const root = fixture(t, true);
	const pending = [...snapshots, {
		issue: 2,
		decision: { action: "cleanup" },
		obs: {},
	}];
	assert.equal(
		retrospectiveRequest(root, laneId, pending).action,
		"wait-lane",
	);
	assert.equal(
		decideNext({ blocker: null }, {
			pr: { state: "MERGED", number: 10 },
			branch: null,
			worktree: null,
		}).action,
		"done",
	);
	const event = recordRetroEvent(root, laneId, 1, "incident", {
		confirmed: true,
		head,
	});
	const request = retrospectiveRequest(root, laneId, snapshots);
	const saved = recordRetrospective(
		root,
		request,
		report(request, event.eventId),
	);
	assert.ok(existsSync(saved.report));
	assert.ok(existsSync(saved.markdown));
	assert.equal(retrospectiveRequest(root, laneId, snapshots).action, "done");
	assert.equal(
		retrospectiveRequest(root, laneId, [{
			...snapshots[0],
			obs: {
				pr: { ...snapshots[0].obs.pr, mergeCommit: "c".repeat(40) },
			},
		}]).action,
		"retro",
	);
});

test("reports reject stale subjects, invented references and invented total elapsed time", (t) => {
	const root = fixture(t, true);
	const event = recordRetroEvent(root, laneId, 1, "incident", {
		command: "node --test",
		exitCode: 1,
	});
	const request = retrospectiveRequest(root, laneId, snapshots);
	assert.throws(
		() =>
			recordRetrospective(root, request, {
				...report(request, event.eventId),
				subjectKey: "d".repeat(64),
			}),
		TypeError,
	);
	assert.throws(
		() =>
			recordRetrospective(root, request, report(request, "e".repeat(64))),
		TypeError,
	);
	assert.throws(
		() =>
			recordRetrospective(root, request, {
				...report(request, event.eventId),
				totalElapsedMs: 10,
			}),
		TypeError,
	);
	assert.equal(existsSync(request.report), false);
});

test("a Markdown write failure does not publish a completed report marker", (t) => {
	const root = fixture(t, true);
	const event = recordRetroEvent(root, laneId, 1, "incident", {
		exitCode: 1,
	});
	const request = retrospectiveRequest(root, laneId, snapshots);
	const markdown = request.report.replace(/\.json$/u, ".md");
	mkdirSync(markdown, { recursive: true });
	assert.throws(() =>
		recordRetrospective(root, request, report(request, event.eventId))
	);
	assert.equal(existsSync(request.report), false);
	assert.equal(retrospectiveRequest(root, laneId, snapshots).action, "retro");
	rmSync(markdown, { recursive: true });
	recordRetrospective(root, request, report(request, event.eventId));
	assert.equal(retrospectiveRequest(root, laneId, snapshots).action, "done");
});

test("improvement recommendations are retained without editing the target workflow", (t) => {
	const root = fixture(t, true);
	const target = resolve(root, "workflow.json");
	writeFileSync(target, JSON.stringify({ enabled: true }));
	const before = readFileSync(target);
	const event = recordRetroEvent(root, laneId, 1, "incident", {
		source: target,
		exitCode: 1,
	});
	const request = retrospectiveRequest(root, laneId, snapshots);
	recordRetrospective(root, request, {
		...report(request, event.eventId),
		improvements: [{
			finding: "Change the recorded workflow boundary",
			confidence: "hypothesis",
			eventIds: [event.eventId],
			target,
			existingProtection: "Existing check",
			verification: "Scoped regression",
			expectedCost: "Unmeasured",
		}],
	});
	assert.deepEqual(readFileSync(target), before);
	assert.equal(
		JSON.parse(readFileSync(request.report)).improvements.length,
		1,
	);
});

test("missing history and API collection gaps require explicitly partial analysis", (t) => {
	const root = fixture(t);
	let request = retrospectiveRequest(root, laneId, snapshots);
	assert.equal(request.action, "collect-ci");
	assert.throws(
		() =>
			recordRetrospective(root, request, {
				...report(request, "f".repeat(64)),
				bottlenecks: [],
			}),
		TypeError,
	);
	recordCiSnapshot(root, laneId, 1, ciRun(), [ciJob()]);
	request = retrospectiveRequest(root, laneId, snapshots);
	const gap = recordRetroEvent(root, laneId, 1, "gap", {
		code: "ci-unavailable",
	});
	assert.throws(
		() => recordRetrospective(root, request, report(request, gap.eventId)),
		TypeError,
	);
	recordRetrospective(root, request, {
		...report(request, gap.eventId),
		coverage: "partial",
		bottlenecks: [],
		unknowns: ["CI access unavailable"],
	});
	assert.equal(retrospectiveRequest(root, laneId, snapshots).action, "done");
});

test("tampered observations fail validation instead of becoming retrospective evidence", (t) => {
	const root = fixture(t);
	const event = recordRetroEvent(root, laneId, 1, "review", {
		verdict_signal: "BLOCK",
	});
	const stored = JSON.parse(readFileSync(event.path));
	writeFileSync(
		event.path,
		JSON.stringify({ ...stored, data: { verdict_signal: "PASS" } }),
	);
	assert.throws(() => readRetroEvents(root, laneId), TypeError);
	assert.throws(
		() =>
			recordRetroEvent(root, laneId, 1, "review", {
				verdict_signal: "BLOCK",
			}),
		TypeError,
	);
});

test("recording and report analysis leave the execution ledger unchanged", (t) => {
	const root = fixture(t, true);
	const directory = resolve(root, ".omo/lanes-v4");
	mkdirSync(directory, { recursive: true });
	const lane = {
		version: 4,
		lane_id: laneId,
		base_branch: "main",
		issues: {
			1: {
				issue: 1,
				branch: "issue-1",
				facts: {},
				attempts: {},
				blocker: null,
			},
		},
	};
	const path = resolve(directory, "lane.json");
	writeFileSync(path, JSON.stringify(lane));
	const before = readFileSync(path);
	const cli = fileURLToPath(new URL("./lane-v4-cli.mjs", import.meta.url));
	execFileSync(process.execPath, [
		cli,
		"retro-record",
		"--root",
		root,
		"--lane",
		path,
		"--issue",
		"1",
		"--kind",
		"review",
		"--value",
		JSON.stringify({ verdict_signal: "BLOCK" }),
	]);
	assert.deepEqual(readFileSync(path), before);
	const event = readRetroEvents(root, laneId).find((entry) => entry.kind === "review");
	const request = retrospectiveRequest(root, laneId, snapshots);
	recordRetrospective(root, request, report(request, event.eventId));
	assert.deepEqual(readFileSync(path), before);
});

test("actual lane-end CLI generates one report and preserves the execution file", (t) => {
	const root = fixture(t);
	const at = (time) => `2026-10-08T01:${time}Z`;
	const step = (number, name, start, end, conclusion = "success") => ({
		number, name, status: "completed", conclusion, started_at: start, completed_at: end,
	});
	const run = { ...ciRun(), run_started_at: at("00:20") };
	const retry = { ...ciRun(2), run_started_at: at("04:00"), conclusion: "success" };
	const jobs = [
		{ ...ciJob(), id: 41, name: "Verify task (tooling-1) / tooling-1", conclusion: "success",
			head_sha: head, queued_at: at("00:50"), steps: [
				step(1, "Restore verification image", at("01:02"), at("01:12")),
				step(2, "Execute the shared Linux task", at("01:12"), at("02:35")),
				step(3, "Load verification image", null, null, "skipped"),
			] },
		{ ...ciJob(), id: 42, name: "Verify", conclusion: "success", completed_at: at("02:50"),
			created_at: at("00:30"),
			steps: [step(1, "Require every planned capability and job result", at("02:30"), at("02:45"))] },
		{ ...ciJob(), name: "Resolve verification plan", conclusion: "cancelled", steps: [
			step(1, "Restore immutable verification image", at("01:01"), at("01:05")),
			step(2, "Load cached image", at("02:00"), at("02:30"), "cancelled"),
			step(3, "Verify the host runner against real Docker fixtures", at("02:20"), at("02:10")),
			step(4, "Prepare and archive verified image", at("01:08"), "not-a-timestamp"),
		] },
		{ ...ciJob(), id: 43, name: "Verify", conclusion: "success", head_sha: "c".repeat(40),
			steps: [step(1, "Require every planned capability and job result", at("01:30"), at("01:45"))] },
	];
	const retryJob = { ...ciJob(2, "success"), started_at: at("04:05"), completed_at: at("04:30"), steps: [] };
	const path = resolve(root, "lane.json");
	writeFileSync(
		path,
		JSON.stringify({
			version: 4,
			lane_id: laneId,
			base_branch: "main",
			issues: {
				1: {
					issue: 1,
					branch: "issue-1",
					depends_on: [],
					attempts: {},
					facts: {},
					blocker: null,
				},
			},
		}),
	);
	const original = readFileSync(path);
	const bin = resolve(root, "bin");
	mkdirSync(bin);
	const gh = resolve(bin, "gh");
	writeFileSync(
		gh,
		`#!${process.execPath}
const args=process.argv.slice(2);
const pr={number:10,state:'MERGED',headRefOid:'${head}',mergeCommit:{oid:'${mergeCommit}'},mergedAt:'2026-10-08T02:00:00Z',mergeable:'MERGEABLE',statusCheckRollup:[]};
const path=args.at(-1);
const jobs = path.includes('/attempts/1/jobs') ? ${JSON.stringify(jobs)} : [${JSON.stringify(retryJob)}];
const api = path.includes('/jobs?') ? [{total_count:jobs.length,jobs}]
  : path.endsWith('/attempts/1') ? ${JSON.stringify(run)}
  : [{total_count:1,workflow_runs:[${JSON.stringify(retry)}]}];
console.log(JSON.stringify(args[0]==='api'?api:args[0]==='pr'?pr:{state:'CLOSED',title:'fixture',body:''}));
`,
		{ mode: 0o755 },
	);
	const cli = fileURLToPath(new URL("./lane-v4-cli.mjs", import.meta.url));
	const execute = (command, extra = []) =>
		execFileSync(process.execPath, [
			cli,
			command,
			"--root",
			root,
			"--lane",
			path,
			...extra,
		], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
		});
	const invoke = (command, extra = []) => JSON.parse(execute(command, extra));
	const envelope = resolve(root, "review.json");
	writeFileSync(
		envelope,
		JSON.stringify({
			verdict_signal: "BLOCK",
			reviewer: "code",
			detail: "couldn't read dependency",
		}),
	);
	const event = invoke("retro-record", [
		"--issue",
		"1",
		"--kind",
		"review",
		"--value-file",
		envelope,
	]);
	invoke("retro-ci", ["--issue", "1"]);
	const request = invoke("retro-plan");
	assert.equal(request.action, "retro");
	assert.ok(Array.isArray(invoke("plan-all")));
	const pendingHandoff = invoke("plan-all", ["--with-retro"]);
	assert.equal(pendingHandoff.issues[0].decision.action, "done");
	assert.equal(pendingHandoff.retrospective.action, "retro");
	assert.equal(pendingHandoff.settled, false);
	const watchLines = execute("watch", ["--once"]).split("\n");
	assert.ok(watchLines.some((line) => line.startsWith("RETRO-READY ")));
	assert.deepEqual(JSON.parse(watchLines.find((line) => line.startsWith("RETRO-READY ")).slice("RETRO-READY ".length)), request);
	assert.deepEqual(JSON.parse(watchLines.find((line) => line.startsWith("LANE-SETTLED ")).slice("LANE-SETTLED ".length)),
		[{ issue: 1, action: "done" }]);
	invoke("retro-ci", ["--issue", "1"]);
	const evidence = invoke("retro-evidence");
	assert.equal(evidence.events.length, 4);
	assert.equal(evidence.totalElapsedMs, null);
	assert.deepEqual(evidence.ciFailurePatterns.map(({ failures, cancellations }) => [failures, cancellations]), [[0, 1]]);
	const timing = evidence.ciTimings ?? [];
	assert.deepEqual(timing.map(({ run, elapsedMs, elapsedScope }) =>
		[run.id, run.attempt, run.head, run.workflow, elapsedMs, elapsedScope]), [
		[20, 1, head, ".github/workflows/ci.yml", 180000, "initial-run-including-queue"],
		[20, 2, head, ".github/workflows/ci.yml", 30000, "retry-attempt-excluding-queue"],
	]);
	const [first, second] = timing;
	assert.deepEqual(timing.map(({ elapsedStartedAt, elapsedCompletedAt }) => [elapsedStartedAt, elapsedCompletedAt]),
		[[at("00:00"), "2026-10-08T01:03:00.000Z"], [at("04:00"), "2026-10-08T01:04:30.000Z"]]);
	assert.deepEqual(first.runQueue, {
		scope: "run-queue", source: "github-run.created_at/run_started_at",
		startedAt: at("00:00"), completedAt: at("00:20"), elapsedMs: 20000, reason: null,
	});
	assert.equal(second.runQueue.elapsedMs, null);
	assert.equal(second.runQueue.startedAt, null);
	assert.equal(second.runQueue.reason, "retry-queue-unobserved");
	const jobById = new Map(first.jobs.map((job) => [job.id, job]));
	const task = jobById.get(41);
	const aggregate = jobById.get(42);
	const cancelled = jobById.get(31);
	const wrongHead = jobById.get(43);
	assert.deepEqual(first.jobs.map(({ id, status, conclusion }) => [id, status, conclusion]), [
		[31, "completed", "cancelled"], [41, "completed", "success"],
		[42, "completed", "success"], [43, "completed", "success"],
	]);
	assert.equal(task.execution.elapsedMs, 120000);
	assert.equal(aggregate.execution.elapsedMs, 110000);
	assert.equal(task.queue.elapsedMs, 10000);
	assert.equal(aggregate.queue.reason, "missing-boundary");
	assert.equal(task.runnerSetup.reason, "runner-setup-unobserved");
	const intervals = (job) => job.steps.map(({ timing: interval }) =>
		[interval.scope, interval.elapsedMs, interval.reason]);
	assert.deepEqual(intervals(task), [
		["environment-preparation-step", 10000, null],
		["verification-execution-step", null, "mixed-task-scope"],
		["environment-preparation-step", null, "step-skipped"],
	]);
	assert.deepEqual(intervals(aggregate), [["verification-aggregate-step", 15000, null]]);
	assert.equal(cancelled.execution.reason, "job-cancelled");
	assert.deepEqual(intervals(cancelled), [
		["environment-preparation-step", 4000, null],
		["environment-preparation-step", null, "step-cancelled"],
		["verification-host-checks-step", null, "reversed-boundaries"],
		["environment-preparation-step", null, "invalid-timestamp"],
	]);
	assert.deepEqual(intervals(wrongHead), [["verification-aggregate-step", null, "job-identity-mismatch"]]);
	const analysis = resolve(root, "analysis.json");
	writeFileSync(analysis, JSON.stringify(report(request, event.eventId)));
	const saved = invoke("retro-report", ["--value-file", analysis]);
	const markdown = readFileSync(saved.markdown, "utf8");
	const reportBytes = readFileSync(saved.report);
	assert.deepEqual(JSON.parse(reportBytes).ciTimings, timing);
	assert.match(markdown, /verification-aggregate-step: 15000 ms .*2026-10-08T01:02:30Z.*2026-10-08T01:02:45Z/u);
	assert.match(markdown, /verification-execution-step: unknown \(mixed-task-scope\)/u);
	assert.equal(invoke("retro-plan").action, "done");
	assert.equal(invoke("plan-all", ["--with-retro"]).settled, true);
	assert.equal(
		invoke("retro-report", ["--value-file", analysis]).action,
		"done",
	);
	assert.equal(
		execute("watch", ["--once"]).split("\n").some((line) =>
			line.startsWith("RETRO-READY ")
		),
		false,
	);
	assert.deepEqual(readFileSync(saved.report), reportBytes);
	assert.equal(readFileSync(saved.markdown, "utf8"), markdown);
	assert.deepEqual(readFileSync(path), original);
});

test("#4286 retrospective evidence uses attempt bounds and attributable completion suppliers", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), run_started_at: "2026-10-08T01:01:15Z" };
	const job = { ...ciJob(1, "success"), head_sha: head, name: "Verify task (tooling-1) / tooling-1",
		completed_at: "2026-10-08T01:02:30Z", steps: [{
			number: 1, name: "Restore verification image", status: "completed", conclusion: "success",
			started_at: "2026-10-08T01:01:02Z", completed_at: "2026-10-08T01:01:12Z",
		}, {
			number: 2, name: "Load verification image", status: "completed", conclusion: "success",
			started_at: "2026-10-08T01:01:20Z", completed_at: "2026-10-08T01:01:30Z",
		}] };
	const supplier = { ...ciJob(1, "success"), id: 42, head_sha: head,
		started_at: "2026-10-08T01:01:40Z" };
	const foreign = { ...supplier, id: 43, head_sha: "c".repeat(40), completed_at: "2026-10-08T01:04:00Z" };
	const [initial] = recordCiSnapshot(root, laneId, 1, run, [job, supplier, foreign]);
	const [retry] = recordCiSnapshot(root, laneId, 1, { ...run, run_attempt: 2 }, [
		{ ...foreign, run_attempt: 2 },
	]);

	const { ciTimings, events } = retrospectiveEvidence(root, laneId, snapshots);
	const legacy = [initial, retry].map(({ eventId }) => events.find((event) => event.eventId === eventId).data);
	const [first, second] = ciTimings;

	assert.deepEqual({
		stepTimings: first.jobs.find(({ id }) => id === 31).steps.map(({ timing }) => [timing.elapsedMs, timing.reason]),
		foreignReason: first.jobs.find(({ id }) => id === 43).execution.reason,
		projected: [first, second].map((timing) => [
			timing.elapsedMs, timing.elapsedCompletedAt, timing.elapsedCompletedJobIds, timing.elapsedReason, timing.elapsedEventId,
		]),
		legacy: legacy.map(({ elapsedMs, elapsedScope, completedAt }) => [elapsedMs, elapsedScope, completedAt]),
	}, {
		stepTimings: [[null, "contradictory-boundaries"], [10000, null]],
		foreignReason: "job-identity-mismatch",
		projected: [
			[180000, "2026-10-08T01:03:00.000Z", [42], null, initial.eventId],
			[null, null, [], "job-completion-unobserved", retry.eventId],
		],
		legacy: [
			[240000, "initial-run-including-queue", "2026-10-08T01:04:00.000Z"],
			[165000, "retry-attempt-excluding-queue", "2026-10-08T01:04:00.000Z"],
		],
	});
});

test("#4286 fix-back: complete CI timing recovers from partial observations and preserves conflicts", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), conclusion: "success", run_started_at: "2026-10-08T01:00:20Z" };
	const job = { ...ciJob(1, "success"), head_sha: head, name: "Verify", steps: [{
		number: 1, name: "Require every planned capability and job result",
		status: "completed", conclusion: "success",
		started_at: "2026-10-08T01:02:30Z", completed_at: "2026-10-08T01:02:45Z",
	}] };
	const [empty] = recordCiSnapshot(root, laneId, 1, run, []);
	const [unfinished] = recordCiSnapshot(root, laneId, 1, run, [
		job, { ...job, id: 32, status: "in_progress", conclusion: null, completed_at: null },
	]);
	const [complete] = recordCiSnapshot(root, laneId, 1, run, [job]);
	const [replay] = recordCiSnapshot(root, laneId, 1, run, [job]);
	const originalEvents = readRetroEvents(root, laneId);

	const [recovered] = retrospectiveEvidence(root, laneId, snapshots).ciTimings;
	assert.equal(recovered.reason, null);
	assert.equal(recovered.elapsedMs, 180000);
	assert.equal(recovered.elapsedEventId, complete.eventId);
	assert.deepEqual(recovered.jobs.map(({ id, steps }) => [id, steps[0].timing.elapsedMs]), [[31, 15000]]);
	assert.deepEqual(new Set(recovered.eventIds), new Set([empty.eventId, unfinished.eventId, complete.eventId]));
	assert.equal(recovered.eventIds.length, 3);
	assert.equal(replay.eventId, complete.eventId);

	const [conflict] = recordCiSnapshot(root, laneId, 1, run, [{ ...job, completed_at: "2026-10-08T01:04:00Z" }]);
	const evidence = retrospectiveEvidence(root, laneId, snapshots);
	const [conflicting] = evidence.ciTimings;
	assert.equal(conflicting.reason, "conflicting-attempt-timing");
	assert.equal(conflicting.elapsedReason, "conflicting-attempt-timing");
	assert.equal(conflicting.elapsedMs, null);
	assert.deepEqual(conflicting.jobs.map(({ id, execution, steps }) =>
		[id, execution.elapsedMs, execution.reason, steps[0].timing.elapsedMs]),
		[[31, null, "conflicting-attempt-timing", 15000]]);
	assert.deepEqual(new Set(conflicting.eventIds), new Set([...recovered.eventIds, conflict.eventId]));
	assert.deepEqual(readRetroEvents(root, laneId).filter(({ eventId }) => eventId !== conflict.eventId), originalEvents);
});

test("#4286 fix-back: cancelled job completion bounds attempt elapsed independently of job execution", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), conclusion: "cancelled", run_started_at: "2026-10-08T01:00:20Z" };
	const success = { ...ciJob(1, "success"), head_sha: head };
	const end = "2026-10-08T01:08:00Z";
	const cancelled = { ...success, id: 32, conclusion: "cancelled", completed_at: end };
	const cases = [
		{ job: cancelled, legacy: 480000, elapsed: 480000 },
		{ job: { ...cancelled, started_at: null }, legacy: 480000, elapsed: 480000 },
		{ job: { ...cancelled, completed_at: null }, legacy: 180000, elapsed: null },
		{ job: { ...cancelled, completed_at: "not-a-timestamp" }, legacy: 180000, elapsed: null },
		{ job: { ...cancelled, started_at: "2026-10-08T01:09:00Z" }, legacy: 480000, elapsed: null },
		{ job: { ...cancelled, started_at: "2026-10-08T01:09:00Z", completed_at: "2026-10-08T01:02:00Z" }, legacy: 180000, elapsed: null },
		{ job: { ...cancelled, started_at: "2026-10-08T01:00:10Z" }, legacy: 480000, elapsed: null },
	];
	for (const [index, { job, legacy }] of cases.entries()) {
		const id = run.id + index;
		const stored = recordCiSnapshot(root, laneId, 1, { ...run, id }, [
			{ ...success, run_id: id }, { ...job, run_id: id },
		]).at(-1);
		const original = JSON.parse(readFileSync(stored.path, "utf8")).data;
		assert.equal(original.elapsedMs, legacy);
		assert.equal(original.elapsedScope, "initial-run-including-queue");
	}

	assert.deepEqual(retrospectiveEvidence(root, laneId, snapshots).ciTimings.map((timing) => {
		const job = timing.jobs.find(({ id }) => id === cancelled.id);
		return [timing.elapsedMs, timing.elapsedCompletedAt, timing.elapsedCompletedJobIds, timing.elapsedReason,
			job.conclusion, job.execution.elapsedMs, job.execution.reason];
	}), cases.map(({ elapsed }) => [
		elapsed, elapsed === null ? null : "2026-10-08T01:08:00.000Z",
		elapsed === null ? [] : [cancelled.id], elapsed === null ? "job-completion-unobserved" : null,
		"cancelled", null, "job-cancelled",
	]));
});

test("#4286 retry elapsed is unknown when an attributable job ends before the attempt", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(2), conclusion: "cancelled", run_started_at: "2026-10-08T01:00:20Z" };
	const success = { ...ciJob(2, "success"), head_sha: head, name: "Verify", steps: [] };
	const cancelled = { ...success, id: 42, conclusion: "cancelled",
		started_at: null, completed_at: "2026-10-08T01:00:10Z" };
	const snapshot = recordCiSnapshot(root, laneId, 1, run, [success, cancelled]).at(-1);

	const { ciTimings: [timing], events } = retrospectiveEvidence(root, laneId, snapshots);

	assert.equal(timing.elapsedMs, null);
	assert.deepEqual([timing.elapsedCompletedAt, timing.elapsedCompletedJobIds, timing.elapsedReason],
		[null, [], "job-completion-unobserved"]);
	assert.equal(timing.conclusion, "cancelled");
	assert.equal(timing.runQueue.reason, "retry-queue-unobserved");
	assert.equal(events.find(({ eventId }) => eventId === snapshot.eventId).data.elapsedMs, 160000);
});

test("#4286 retry elapsed is unknown when the attempt starts before the original run was created", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(2), conclusion: "success" };
	const job = { ...ciJob(2, "success"), head_sha: head, name: "Verify", steps: [] };
	const cases = [
		{ start: "2026-10-08T00:59:00Z", legacy: 240000, elapsed: null, reason: "contradictory-boundaries" },
		{ start: "2026-10-08T01:00:00Z", legacy: 180000, elapsed: 180000, reason: null },
		{ start: "2026-10-08T01:00:20Z", legacy: 160000, elapsed: 160000, reason: null },
	];
	const recorded = cases.map(({ start }, index) => {
		const id = run.id + index;
		return recordCiSnapshot(root, laneId, 1, { ...run, id, run_started_at: start }, [{ ...job, run_id: id }])[0];
	});

	const { ciTimings, events } = retrospectiveEvidence(root, laneId, snapshots);

	assert.equal(ciTimings[0].elapsedMs, null);
	for (const [index, { start, legacy, elapsed, reason }] of cases.entries()) {
		const timing = ciTimings[index];
		const original = events.find(({ eventId }) => eventId === recorded[index].eventId).data;
		assert.deepEqual([timing.elapsedMs, timing.elapsedReason, timing.elapsedStartedAt, timing.elapsedScope],
			[elapsed, reason, start, "retry-attempt-excluding-queue"]);
		assert.deepEqual([timing.runQueue.elapsedMs, timing.runQueue.reason, timing.runQueue.startedAt],
			[null, "retry-queue-unobserved", null]);
		assert.equal(timing.jobs[0].execution.elapsedMs, 120000);
		assert.deepEqual([original.elapsedMs, original.elapsedScope], [legacy, "retry-attempt-excluding-queue"]);
	}
});

test("#4286 initial run queue survives cancellation only with a proven start", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), conclusion: "cancelled", run_started_at: "2026-10-08T01:00:20Z" };
	const success = { ...ciJob(1, "success"), head_sha: head, name: "Verify", steps: [] };
	const cases = [
		{ run, job: success, reason: null },
		{ run, job: { ...success, conclusion: "cancelled" }, reason: "run-cancelled" },
		{ run, job: { ...success, conclusion: "skipped" }, reason: "run-cancelled" },
		{ run, job: { ...success, head_sha: "c".repeat(40) }, reason: "run-cancelled" },
		{ run, job: { ...success, started_at: "2026-10-08T01:00:10Z" }, reason: "run-cancelled" },
		{ run: { ...run, conclusion: "skipped" }, job: success, reason: "run-skipped" },
		{ run: { ...run, run_started_at: null }, job: success, reason: "missing-boundary" },
		{ run: { ...run, run_started_at: "not-a-timestamp" }, job: success, reason: "invalid-timestamp" },
		{ run: { ...run, run_started_at: "2026-10-08T00:59:00Z" }, job: success, reason: "reversed-boundaries" },
	];
	const observed = cases.map(({ run, job }, index) => {
		const id = run.id + index;
		return recordCiSnapshot(root, laneId, 1, { ...run, id }, [{ ...job, run_id: id }]).at(-1);
	});
	const scope = [{ ...snapshots[0], obs: { ...snapshots[0].obs,
		pr: { ...snapshots[0].obs.pr, ciRuns: [{ ...snapshots[0].obs.pr.ciRuns[0], conclusion: "cancelled" }] } } }];

	const { ciTimings } = retrospectiveEvidence(root, laneId, scope);
	const [started, cancelledJob] = ciTimings;

	assert.equal(started.runQueue.elapsedMs, 20000);
	assert.deepEqual([started.conclusion, started.elapsedMs, started.runQueue.startedAt, started.runQueue.completedAt],
		["cancelled", 180000, run.created_at, run.run_started_at]);
	assert.deepEqual(ciTimings.map(({ runQueue }) => [runQueue.elapsedMs, runQueue.reason]),
		cases.map(({ reason }) => [reason === null ? 20000 : null, reason]));
	assert.deepEqual([cancelledJob.jobs[0].execution.elapsedMs, cancelledJob.jobs[0].execution.reason],
		[null, "job-cancelled"]);
	const request = retrospectiveRequest(root, laneId, scope);
	const saved = recordRetrospective(root, request, report(request, observed[0].eventId));
	assert.deepEqual(JSON.parse(readFileSync(saved.report, "utf8")).ciTimings, ciTimings);
	assert.match(readFileSync(saved.markdown, "utf8"), /run-queue: 20000 ms .*2026-10-08T01:00:00Z.*2026-10-08T01:00:20Z/u);
});

test("#4286 fifth fix-back retains preceding boundary conflicts through final snapshots", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), conclusion: "success", run_started_at: "2026-10-08T01:00:20Z" };
	const step = { number: 1, name: "Require every planned capability and job result",
		status: "completed", conclusion: "success",
		started_at: "2026-10-08T01:02:30Z", completed_at: "2026-10-08T01:02:45Z" };
	const job = { ...ciJob(1, "success"), head_sha: head, name: "Verify",
		queued_at: "2026-10-08T01:00:50Z", steps: [step] };
	const progressing = { ...job, id: 32, status: "in_progress", conclusion: null,
		completed_at: null, steps: [] };
	recordCiSnapshot(root, laneId, 1, { ...run, status: "in_progress", conclusion: null }, [job, progressing]);
	const final = { ...job, completed_at: "2026-10-08T01:04:00Z", queued_at: null, steps: [] };
	const finished = { ...progressing, status: "completed", conclusion: "success",
		completed_at: "2026-10-08T01:05:00Z" };
	recordCiSnapshot(root, laneId, 1, run, [final, finished]);
	const additiveRun = { ...run, id: run.id + 1 };
	recordCiSnapshot(root, laneId, 1, additiveRun, [{ ...job, run_id: additiveRun.id }]);
	recordCiSnapshot(root, laneId, 1, additiveRun, [{ ...job, run_id: additiveRun.id, queued_at: null,
		started_at: "2026-10-08T01:01:00.000Z", steps: [{ ...step, completed_at: "2026-10-08T01:02:50Z" }] }]);

	const [timing, additive] = retrospectiveEvidence(root, laneId, snapshots).ciTimings;
	const [conflicted, progressed] = timing.jobs;

	assert.deepEqual([conflicted.execution.elapsedMs, conflicted.execution.reason], [null, "conflicting-attempt-timing"]);
	assert.equal(timing.elapsedMs, null);
	assert.equal(timing.runQueue.elapsedMs, 20000);
	assert.equal(conflicted.queue.elapsedMs, 10000);
	assert.equal(conflicted.steps[0].timing.elapsedMs, 15000);
	assert.equal(progressed.execution.elapsedMs, 240000);
	const [additiveJob] = additive.jobs;
	assert.deepEqual([additive.elapsedMs, additiveJob.execution.elapsedMs, additiveJob.queue.elapsedMs],
		[180000, 120000, 10000]);
	assert.deepEqual([additiveJob.steps[0].timing.elapsedMs, additiveJob.steps[0].timing.reason],
		[null, "conflicting-attempt-timing"]);
});

test("#4286 fifth fix-back uses an attributable completed step to corroborate cancelled run start", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), conclusion: "cancelled", run_started_at: "2026-10-08T01:00:20Z" };
	const step = { number: 1, name: "Restore immutable verification image",
		status: "completed", conclusion: "success",
		started_at: "2026-10-08T01:01:01Z", completed_at: "2026-10-08T01:01:05Z" };
	const job = { ...ciJob(1, "cancelled"), head_sha: head, name: "Resolve verification plan", steps: [step] };
	const variants = [job, { ...job, steps: [step, step] },
		{ ...job, head_sha: "c".repeat(40) },
		{ ...job, steps: [{ ...step, completed_at: "2026-10-08T01:01:00Z" }] }];
	for (const [index, variant] of variants.entries()) {
		const id = run.id + index;
		recordCiSnapshot(root, laneId, 1, { ...run, id }, [{ ...variant, run_id: id }]);
	}

	const [proven, ...unproven] = retrospectiveEvidence(root, laneId, snapshots).ciTimings;
	const [cancelled] = proven.jobs;

	assert.deepEqual([proven.runQueue.elapsedMs, proven.runQueue.reason], [20000, null]);
	assert.deepEqual([proven.runQueue.startedAt, proven.runQueue.completedAt], [run.created_at, run.run_started_at]);
	assert.deepEqual([cancelled.conclusion, cancelled.execution.elapsedMs, cancelled.execution.reason],
		["cancelled", null, "job-cancelled"]);
	assert.equal(cancelled.steps[0].timing.elapsedMs, 4000);
	assert.deepEqual(unproven.map(({ runQueue }) => runQueue.reason), Array(3).fill("run-cancelled"));
});

test("#4286 fifth fix-back checks the job queue end rather than its beginning against attempt start", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), conclusion: "success", run_started_at: "2026-10-08T01:01:15Z" };
	const job = { ...ciJob(1, "success"), head_sha: head, name: "Verify", steps: [],
		queued_at: "2026-10-08T01:00:50Z" };
	recordCiSnapshot(root, laneId, 1, run, [job, { ...job, id: 32, started_at: "2026-10-08T01:01:20Z" }]);

	const [{ jobs: [contradictory, valid] }] = retrospectiveEvidence(root, laneId, snapshots).ciTimings;

	assert.deepEqual([contradictory.queue.elapsedMs, contradictory.queue.reason], [null, "contradictory-boundaries"]);
	assert.deepEqual([valid.queue.elapsedMs, valid.queue.reason], [30000, null]);
});

test("#4286 fifth fix-back counts a timed-out job completion without measuring its execution", (t) => {
	const root = fixture(t);
	const run = { ...ciRun(), run_started_at: "2026-10-08T01:00:20Z" };
	const success = { ...ciJob(1, "success"), head_sha: head, steps: [] };
	const timedOut = { ...success, id: 32, conclusion: "timed_out", completed_at: "2026-10-08T01:05:00Z" };
	const snapshot = recordCiSnapshot(root, laneId, 1, run, [success, timedOut]).at(-1);

	const { ciTimings: [timing], events } = retrospectiveEvidence(root, laneId, snapshots);
	const [, job] = timing.jobs;

	assert.deepEqual([timing.elapsedMs, timing.elapsedReason, timing.elapsedCompletedAt, timing.elapsedCompletedJobIds],
		[300000, null, "2026-10-08T01:05:00.000Z", [32]]);
	assert.equal(events.find(({ eventId }) => eventId === snapshot.eventId).data.elapsedMs, 300000);
	assert.deepEqual([job.conclusion, job.execution.elapsedMs, job.execution.reason], ["timed_out", null, "job-timed_out"]);
});

test("#4286 retrospective evidence: legacy elapsed observations do not fabricate a timing breakdown", (t) => {
	const root = fixture(t);
	const legacy = recordRetroEvent(root, laneId, 1, "ci", {
		run: { id: 20, attempt: 1, head, workflow: ".github/workflows/ci.yml" },
		status: "completed", conclusion: "failure", complete: true,
		elapsedMs: 180000, elapsedScope: "initial-run-including-queue",
	});

	const evidence = retrospectiveEvidence(root, laneId, snapshots);

	assert.deepEqual(evidence.ciTimings?.map(({ eventIds, elapsedMs, reason }) =>
		[eventIds, elapsedMs, reason]), [[[legacy.eventId], 180000, "legacy-timing-unrecorded"]]);
});

test("normal record automatically retains unsuccessful implementation stage evidence", (t) => {
	const root = fixture(t);
	const path = resolve(root, "lane.json");
	writeFileSync(
		path,
		JSON.stringify({
			version: 4,
			lane_id: laneId,
			base_branch: "main",
			issues: {
				1: {
					issue: 1,
					branch: "issue-1",
					facts: {},
					attempts: {},
					blocker: null,
				},
			},
		}),
	);
	const cli = fileURLToPath(new URL("./lane-v4-cli.mjs", import.meta.url));
	const result = {
		ok: false,
		head_sha: head,
		failed_command: "node --test",
		errors: ["assertion"],
	};
	execFileSync(process.execPath, [
		cli,
		"record",
		"--root",
		root,
		"--lane",
		path,
		"--issue",
		"1",
		"--phase",
		"implement",
		"--result-json",
		JSON.stringify(result),
	]);
	const events = readRetroEvents(root, laneId);
	assert.equal(events.length, 1);
	assert.equal(events[0].kind, "stage");
	assert.deepEqual(events[0].data.result, result);
	assert.equal(
		JSON.parse(readFileSync(path)).issues[1].attempts.implement,
		1,
	);
	assert.equal(
		Object.hasOwn(JSON.parse(readFileSync(path)), "retrospective"),
		false,
	);
	const stageBytes = readFileSync(resolve(root, events[0].path));
	const lane = JSON.parse(readFileSync(path));
	lane.issues[1].blocker = { type: "attempts-exhausted", phase: "implement" };
	writeFileSync(path, JSON.stringify(lane));

	execFileSync(process.execPath, [
		cli, "clear-blocker", "--root", root, "--lane", path,
		"--issue", "1", "--phase", "implement",
	]);

	assert.deepEqual(readFileSync(resolve(root, events[0].path)), stageBytes);
	const retained = readRetroEvents(root, laneId);
	assert.equal(retained.length, 2);
	const { operation_id, ...cleared } = retained.find((event) => event.kind === "incident").data;
	assert.match(operation_id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
	assert.deepEqual(cleared, {
		action: "clear-blocker", phase: "implement",
		blocker: { type: "attempts-exhausted", phase: "implement" },
	});
});

test("CI collector queries each run attempt separately and reuses completed observations", (t) => {
	const root = fixture(t);
	const lane = { lane_id: laneId, issues: { 1: { branch: "issue-1" } } };
	const queried = [];
	const query = (_root, _command, args) => {
		const path = args.at(-1);
		queried.push(path);
		if (path.includes("/actions/runs?")) {
			return JSON.stringify([{
				total_count: 1,
				workflow_runs: [ciRun(2)],
			}]);
		}
		if (path.endsWith("/attempts/1")) return JSON.stringify(ciRun());
		const attempt = path.includes("/attempts/1/jobs") ? 1 : 2;
		return JSON.stringify([{ total_count: 1, jobs: [ciJob(attempt)] }]);
	};
	captureRetroCi(root, lane, 1, query);
	assert.ok(queried.some((path) => path.includes("/attempts/1/jobs")));
	assert.ok(queried.some((path) => path.includes("/attempts/2/jobs")));
	assert.equal(
		retrospectiveEvidence(root, laneId, snapshots).ciFailurePatterns[0]
			.failures,
		2,
	);
	queried.length = 0;
	captureRetroCi(root, lane, 1, query);
	assert.equal(queried.length, 1);
});

test("#4286 CI collector: foreign historical attempt -> evidence gap instead of attribution", (t) => {
	const root = fixture(t);
	const lane = { lane_id: laneId, issues: { 1: { branch: "issue-1" } } };
	captureRetroCi(root, lane, 1, (_root, _cmd, args) => {
		const path = args.at(-1);
		if (path.includes("/runs?")) return JSON.stringify([{ total_count: 1, workflow_runs: [ciRun(2)] }]);
		if (path.endsWith("/attempts/1")) return JSON.stringify({ ...ciRun(), head_sha: "c".repeat(40) });
		const job = path.includes("/attempts/1/jobs") ? ciJob() : ciJob(2);
		return JSON.stringify([{ total_count: 1, jobs: [job] }]);
	});

	const evidence = retrospectiveEvidence(root, laneId, snapshots);
	assert.deepEqual(evidence.ciTimings.map(({ run }) => [run.attempt, run.head]), [[2, head]]);
	assert.deepEqual(evidence.events.filter(({ kind }) => kind === "gap").map(({ data }) => data.code),
		["ci-attempt-identity-mismatch:20:1"]);
});

test("unavailable or incomplete CI evidence is retained as a gap without altering lane authority", (t) => {
	const root = fixture(t);
	const lane = {
		lane_id: laneId,
		issues: { 1: { branch: "issue-1", approvals: { merge: false } } },
	};
	const before = structuredClone(lane);
	captureRetroCi(root, lane, 1, () => null);
	assert.deepEqual(lane, before);
	assert.equal(readRetroEvents(root, laneId)[0].kind, "gap");
	captureRetroCi(root, lane, 1, (_root, _command, args) =>
		JSON.stringify([
			args.at(-1).includes("/actions/runs?")
				? { total_count: 1, workflow_runs: [ciRun()] }
				: { total_count: 2, jobs: [ciJob()] },
		]));
	assert.equal(
		readRetroEvents(root, laneId).filter((event) => event.kind === "gap")
			.length,
		2,
	);
	assert.equal(
		retrospectiveEvidence(root, laneId, snapshots).ciFailurePatterns.length,
		0,
	);
});
