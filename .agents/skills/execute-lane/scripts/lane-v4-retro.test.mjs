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
const mergeCommit = "b".repeat(40);
const laneId = "retro-test";
const fixture = (t) => {
	const root = mkdtempSync(resolve(tmpdir(), "retrospective-lane-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
};
const snapshots = [{
	issue: 1,
	decision: { action: "done" },
	obs: {
		pr: { number: 10, headSha: head, mergeCommit },
		facts: {},
		attempts: {},
	},
}];
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
	recordCiSnapshot(root, laneId, 1, {
		...ciRun(),
		status: "in_progress",
		conclusion: null,
	}, [ciJob()]);
	const events = readRetroEvents(root, laneId);
	assert.equal(events.length, 1);
	assert.equal(events[0].data.job.id, 31);
	assert.equal(Object.hasOwn(events[0].data, "elapsedMs"), false);
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
	const root = fixture(t);
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
	const root = fixture(t);
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
	const root = fixture(t);
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
	const root = fixture(t);
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
	const request = retrospectiveRequest(root, laneId, snapshots);
	assert.throws(
		() =>
			recordRetrospective(root, request, {
				...report(request, "f".repeat(64)),
				bottlenecks: [],
			}),
		TypeError,
	);
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
	const root = fixture(t);
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
	const event = readRetroEvents(root, laneId)[0];
	const request = retrospectiveRequest(root, laneId, snapshots);
	recordRetrospective(root, request, report(request, event.eventId));
	assert.deepEqual(readFileSync(path), before);
});

test("actual lane-end CLI generates one report and preserves the execution file", (t) => {
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
console.log(JSON.stringify(args[0]==='pr'?pr:{state:'CLOSED',title:'fixture',body:''}));
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
	const request = invoke("retro-plan");
	assert.equal(request.action, "retro");
	assert.ok(Array.isArray(invoke("plan-all")));
	const pendingHandoff = invoke("plan-all", ["--with-retro"]);
	assert.equal(pendingHandoff.issues[0].decision.action, "done");
	assert.equal(pendingHandoff.retrospective.action, "retro");
	assert.equal(pendingHandoff.settled, false);
	assert.ok(
		execute("watch", ["--once"]).split("\n").some((line) =>
			line.startsWith("RETRO-READY ")
		),
	);
	assert.equal(invoke("retro-evidence").events.length, 1);
	const analysis = resolve(root, "analysis.json");
	writeFileSync(analysis, JSON.stringify(report(request, event.eventId)));
	const saved = invoke("retro-report", ["--value-file", analysis]);
	assert.ok(existsSync(saved.markdown));
	const reportBytes = readFileSync(saved.report);
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
	assert.deepEqual(readFileSync(path), original);
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
