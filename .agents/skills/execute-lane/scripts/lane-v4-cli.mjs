#!/usr/bin/env node
// execute-lane v4 CLI: observation + lane file IO around the pure engine.
//
// Commands:
//   init            --root . --lane-id <id> --issue <n> [--issue <n> ...] [--preflight-overlap]
//   plan            --root . --lane <path> --issue <n>
//   plan-all        --root . --lane <path> [--with-retro]
//   watch           --root . --lane <path> [--interval 60] [--once] [--stall-after 15]
//   record          --root . --lane <path> --issue <n> --phase <p> --result-json <json>
//   record-review-preparation-blocker --root . --lane <path> --issue <n> --value <json>
//   set-fact        --root . --lane <path> --issue <n> --kind local-checks|local-ci-waiver|review --head <sha> --value <json>
//   set-fact        --root . --lane <path> --issue <n> --kind preflight --value <json>
//   approve-merge   --root . --lane <path> --issue <n>
//   clear-blocker   --root . --lane <path> --issue <n> --phase <p>
//   retro-record    --root . --lane <path> --issue <n> --kind review|implementer|incident|stage-lifecycle --value <json>
//   retro-ci        --root . --lane <path> --issue <n>
//   retro-plan      --root . --lane <path>
//   retro-evidence  --root . --lane <path>
//   retro-report    --root . --lane <path> --value <json>
//
// The lane file stores intent (attempts, approvals, blockers) and
// head-bound review/local-CI facts plus a head-independent preflight contract.
// Everything else is observed live from git and GitHub on every plan call:
// no session identity or event journal. Head movement invalidates reviews and
// local checks, not the issue/base-bound preflight.

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
	buildVerificationPlan,
	manifestPath,
	readVerificationManifest,
	receiptMatchesPlan,
	validateReceipt,
	validateReceiptEvidence,
} from "../../../../tooling/ci/local-verification.mjs";
import { collectIdentity } from "../../../../tooling/ci/verify-local.mjs";
import { productionInputClassifier } from "../../../../tooling/governance/package-production-inputs.mjs";
import { assertPredictedConflicts } from "../../../workflow-contracts/contracts.mjs";
import {
	evaluatePreflight,
	isRetentionProsePath,
	issueDigest,
	validatePreflight,
} from "../../issue-preflight/scripts/contracts.mjs";
import {
	readRetroEvents,
	recordCiSnapshot,
	recordRetroEvent,
	recordRetrospective,
	retrospectiveEvidence,
	retrospectiveRequest,
} from "../../retrospective-lane/scripts/retro.mjs";
import {
	buildReviewFact,
	retentionFreshAxes,
	validateReviewFact,
} from "../../review-head/scripts/contracts.mjs";
import { coordinateGeneratedIntegration, coordinatePreflightOverlap, externalOverlapObservation, reviewReadinessState, validateGeneratedIntegration, validateStageMeasurements } from "./generated-integration.mjs";
import { observeKnownBaseline, validateKnownBaseline } from "./known-baseline.mjs";
import { assertAgentIdentity, dispatchFor, DispatchPreparationError, readRegisteredAgents, validateDispatchTarget, validateUnavailableTarget } from "./dispatch-targets.mjs";
import {
	applyChildResult,
	decideNext,
	isValidLocalCiWaiver,
	localCheckBinding,
	summarizeTransitions,
	trackStalls,
	validateRetryPolicy,
} from "./lane-v4.mjs";

const { DatabaseSync } = await (async () => {
	const emitWarning = process.emitWarning;
	try {
		// Intercept before SQLite schedules its warning, without changing other diagnostics.
		process.emitWarning = function (warning, ...args) {
			const message = warning instanceof Error ? warning.message : warning;
			const type = warning instanceof Error
				? warning.name
				: typeof args[0] === "string" ? args[0] : args[0]?.type;
			if (
				type === "ExperimentalWarning" &&
				message === "SQLite is an experimental feature and might change at any time"
			) return;
			return Reflect.apply(emitWarning, this, [warning, ...args]);
		};
		return await import("node:sqlite");
	} finally {
		process.emitWarning = emitWarning;
	}
})();

const arg = (args, flag, fallback) => {
	const i = args.indexOf(flag);
	if (i === -1 || args[i + 1] === undefined) {
		if (fallback !== undefined) return fallback;
		throw new TypeError(`missing ${flag}`);
	}
	return args[i + 1];
};

const retroInput = (root, args) => {
	const file = args.includes("--value-file");
	if (file === args.includes("--value")) {
		throw new TypeError(
			"Provide exactly one retrospective value or value file",
		);
	}
	return JSON.parse(
		file
			? readFileSync(resolve(root, arg(args, "--value-file")), "utf8")
			: arg(args, "--value"),
	);
};

const parseReviewPreparationBlocker = (args) => {
	const required = new Set(["--lane", "--issue", "--value"]);
	const remaining = new Set([...required, "--root"]);
	for (let i = 0; i < args.length; i += 2) {
		if (!remaining.delete(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) {
			throw new TypeError("Invalid review-preparation blocker arguments");
		}
		required.delete(args[i]);
	}
	const issue = arg(args, "--issue", "");
	if (required.size || !/^[1-9][0-9]*$/u.test(issue) || !Number.isSafeInteger(Number(issue))) {
		throw new TypeError("Invalid review-preparation blocker arguments");
	}
	const input = JSON.parse(arg(args, "--value"));
	const fields = ["reason", "fix_back_eligible", "head_sha", "policy_sha256", "sequence"];
	if (!input || typeof input !== "object" || Object.keys(input).length !== fields.length ||
		!fields.every(field => Object.hasOwn(input, field)) ||
		input.reason !== "prior-head-red-unavailable" || input.fix_back_eligible !== false ||
		typeof input.head_sha !== "string" || !/^[a-f0-9]{40}$/u.test(input.head_sha) ||
		typeof input.policy_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.policy_sha256) ||
		!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
		throw new TypeError("Invalid review-preparation blocker input");
	}
	return { type: "input-preparation", phase: "review", ...input };
};

const run = (cwd, cmd, cmdArgs, trim = true) => {
	try {
		const output = execFileSync(cmd, cmdArgs, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GH_PAGER: "cat" },
		});
		return trim ? output.trim() : output;
	} catch {
		return null;
	}
};

const registeredDispatch = (root, dispatch) => {
	validateDispatchTarget(dispatch, readRegisteredAgents(root));
};

/** Supplementary incident capture never supplies execution or merge approval. */
export const captureRetroCi = (root, lane, issue, query = run) => {
	const entry = issueEntry(lane, issue);
	const recorded = [];
	const gap = (code) => {
		recorded.push(recordRetroEvent(root, lane.lane_id, issue, "gap", {
			source: "GitHub Actions",
			code,
			branch: entry.branch,
		}));
	};
	const output = query(root, "gh", [
		"api",
		"--paginate",
		"--slurp",
		`repos/{owner}/{repo}/actions/runs?branch=${
			encodeURIComponent(entry.branch)
		}&event=pull_request&per_page=100`,
	]);
	if (output === null) {
		gap("ci-run-history-unavailable");
		return recorded;
	}
	const pages = JSON.parse(output);
	if (
		!Array.isArray(pages) ||
		pages.some((page) => !Array.isArray(page.workflow_runs))
	) {
		throw new TypeError("Invalid GitHub CI history response");
	}
	const known = new Set(
		readRetroEvents(root, lane.lane_id)
			.filter((event) =>
				event.issue === issue && event.kind === "ci" &&
				Object.hasOwn(event.data, "conclusion") && event.data.complete === true
			)
			.map(({ data: { run } }) => `${run.id}:${run.attempt}:${run.head}:${run.workflow}`),
	);
	if (
		pages[0]?.total_count !==
			pages.flatMap((page) => page.workflow_runs).length
	) {
		gap("ci-run-history-incomplete");
	}
	for (const latest of pages.flatMap((page) => page.workflow_runs)) {
		if (
			!Number.isSafeInteger(latest.run_attempt) || latest.run_attempt < 1
		) {
			throw new TypeError("Missing GitHub run attempt");
		}
		for (let attempt = 1; attempt <= latest.run_attempt; attempt++) {
			if (known.has(`${latest.id}:${attempt}:${latest.head_sha}:${latest.path}`)) continue;
			const attemptJson = attempt === latest.run_attempt
				? null
				: query(root, "gh", [
					"api",
					`repos/{owner}/{repo}/actions/runs/${latest.id}/attempts/${attempt}`,
				]);
			if (attempt !== latest.run_attempt && attemptJson === null) {
				gap(`ci-attempt-unavailable:${latest.id}:${attempt}`);
				continue;
			}
			const current = attempt === latest.run_attempt
				? latest
				: JSON.parse(attemptJson);
			if (current?.id !== latest.id || current.run_attempt !== attempt ||
				current.head_sha !== latest.head_sha || current.path !== latest.path) {
				gap(`ci-attempt-identity-mismatch:${latest.id}:${attempt}`);
				continue;
			}
			const jobsJson = query(root, "gh", [
				"api",
				"--paginate",
				"--slurp",
				`repos/{owner}/{repo}/actions/runs/${latest.id}/attempts/${attempt}/jobs?per_page=100`,
			]);
			if (jobsJson === null) {
				gap(`ci-jobs-unavailable:${latest.id}:${attempt}`);
				continue;
			}
			const jobPages = JSON.parse(jobsJson);
			if (
				!Array.isArray(jobPages) ||
				jobPages.some((page) => !Array.isArray(page.jobs))
			) {
				throw new TypeError("Invalid GitHub CI jobs response");
			}
			const jobs = jobPages.flatMap((page) => page.jobs);
			if (jobPages[0]?.total_count !== jobs.length) {
				gap(`ci-jobs-incomplete:${latest.id}:${attempt}`);
				continue;
			}
			recorded.push(
				...recordCiSnapshot(root, lane.lane_id, issue, current, jobs),
			);
		}
	}
	return recorded;
};

const validateOverlapMarker = (lane) => {
	if (Object.hasOwn(lane, "preflight_overlap") && lane.preflight_overlap !== 1) {
		throw new TypeError("preflight_overlap must equal 1 when present");
	}
	return lane;
};
class ReviewReadinessError extends TypeError {
	constructor(issue, field, reason) {
		super(`Issue ${issue} ${field}: ${reason}`);
		this.name = "ReviewReadinessError";
		this.code = "invalid-review-readiness";
		this.issue = Number(issue);
		this.field = field;
	}
}

const loadLane = (path) => {
	const lane = validateOverlapMarker(JSON.parse(readFileSync(path, "utf8")));
	if (lane.preflight_overlap !== 1) return lane;
	return validateReadiness(lane);
};
const validateReadiness = (lane) => {
	for (const [issue, entry] of Object.entries(lane.issues)) {
		if (!entry.facts || !Object.hasOwn(entry.facts, "review-readiness")) continue;
		const fact = entry.facts["review-readiness"];
		const prefix = "facts.review-readiness";
		for (const [record, keys, field] of [
			[fact, ["head", "value"], prefix],
			[fact?.value, ["policy_sha256", "sequence", "active"], `${prefix}.value`],
		]) {
			if (record === null || typeof record !== "object" || Array.isArray(record)) {
				throw new ReviewReadinessError(issue, field, "must be an object");
			}
			const unknown = Object.keys(record).find(key => !keys.includes(key));
			if (unknown !== undefined) throw new ReviewReadinessError(issue, `${field}.${unknown}`, "unknown field");
			const missing = keys.find(key => !Object.hasOwn(record, key));
			if (missing !== undefined) throw new ReviewReadinessError(issue, `${field}.${missing}`, "is required");
		}
		if (typeof fact.head !== "string" || !/^[a-f0-9]{40}$/u.test(fact.head)) {
			throw new ReviewReadinessError(issue, `${prefix}.head`, "must be a lowercase Git SHA");
		}
		if (typeof fact.value.policy_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fact.value.policy_sha256)) {
			throw new ReviewReadinessError(issue, `${prefix}.value.policy_sha256`, "must be a lowercase SHA-256 digest");
		}
		if (!Number.isSafeInteger(fact.value.sequence) || fact.value.sequence < 1) {
			throw new ReviewReadinessError(issue, `${prefix}.value.sequence`, "must be a positive safe integer");
		}
		if (typeof fact.value.active !== "boolean") {
			throw new ReviewReadinessError(issue, `${prefix}.value.active`, "must be a boolean");
		}
	}
	return lane;
};

// This boundary reads other ledgers without entering their observation, lock,
// migration, readiness or save paths. Every failure stays supplementary.
// Only repository identity is process-local; overlap data is never cached.
const externalRepositories = new Map();
const externalOverlapCandidates = (root, lanePath, lane, snapshots) => {
	const candidates = { laneMatches: [], prMatches: [], unknowns: [] };
	const unknown = (source, subject, code) => candidates.unknowns.push({ source, subject, code });
	const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
	const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
	const directory = resolve(root, ".omo/lanes-v4");
	const external = [];
	let names = [];
	try {
		if (realpathSync(directory) !== resolve(realpathSync(root), ".omo/lanes-v4")) {
			unknown("lane-directory", directory, "outside-boundary");
		} else names = readdirSync(directory).filter(name => name.endsWith(".json")).sort();
	} catch (error) {
		if (error.code !== "ENOENT") unknown("lane-directory", directory, "enumeration-failed");
	}
	for (const name of names) {
		const path = resolve(directory, name);
		if (path === lanePath) continue;
		let other;
		try {
			const target = realpathSync(path);
			if (!target.startsWith(`${realpathSync(directory)}${sep}`)) {
				unknown("lane", name, "outside-boundary");
				continue;
			}
			other = loadLane(target);
			if (other?.lane_id === lane.lane_id) continue;
			if (other?.version !== 4) {
				unknown("lane", name, "unsupported-version");
				continue;
			}
			if (!record(other) || typeof other.lane_id !== "string" || !other.lane_id ||
				typeof other.base_branch !== "string" || !other.base_branch ||
				!record(other.issues) || !Object.keys(other.issues).length) {
				unknown("lane", name, "invalid-structure");
				continue;
			}
			validateReadiness(other);
		} catch (error) {
			unknown("lane", name, error instanceof SyntaxError ? "invalid-json"
				: error.code === "invalid-review-readiness" ? error.code
				: error instanceof TypeError ? "invalid-marker-or-structure" : "read-failed");
			continue;
		}
		for (const key of Object.keys(other.issues).sort((a, b) => Number(a) - Number(b))) {
			const entry = other.issues[key];
			if (!/^[1-9]\d*$/u.test(key) || !Number.isSafeInteger(Number(key)) || !record(entry) ||
				entry.issue !== Number(key) || typeof entry.branch !== "string" ||
				!(entry.branch === `issue-${key}` || new RegExp(`^issue-${key}(?:-[a-z0-9]+)+$`, "u").test(entry.branch)) ||
				!Array.isArray(entry.depends_on) || entry.depends_on.some(issue => !Number.isSafeInteger(issue) || issue < 1) ||
				!record(entry.attempts) || !record(entry.approvals) || typeof entry.approvals.merge !== "boolean" ||
				!(entry.blocker === null || record(entry.blocker)) || !record(entry.facts)) {
				unknown("lane", `${other.lane_id}:${key}`, "invalid-issue");
				continue;
			}
			external.push({ lane: other, entry });
		}
	}
	if (!snapshots.some(row => evaluatePreflight(row.obs.preflight, { ...row.obs, issue: row.issue }).valid)) {
		return candidates;
	}
	const query = (source, subject, args) => {
		let text;
		try {
			text = execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, GH_PAGER: "cat" } });
		} catch (error) {
			unknown(source, subject, "command-failed");
			// gh can exit nonzero with useful partial GraphQL data on stdout.
			text = error.stdout?.toString();
			if (!text) return null;
		}
		try { return JSON.parse(text); }
		catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			unknown(source, subject, "invalid-response");
			return null;
		}
	};
	const identity = externalRepositories.get(root) ??
		query("repository", "current", ["repo", "view", "--json", "nameWithOwner"]);
	if (typeof identity?.nameWithOwner !== "string" ||
		! /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(identity.nameWithOwner)) {
		unknown("repository", "current", "identity-unavailable");
		return candidates;
	}
	externalRepositories.set(root, identity);
	const [owner, name] = identity.nameWithOwner.split("/");
	const graphql = (operation, fields) => {
		const response = query("github", operation, ["api", "graphql", "-f",
			`query=query ${operation} { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { ${fields} } }`]);
		if (!record(response)) {
			unknown("github", operation, "invalid-response");
			return null;
		}
		if (Object.hasOwn(response, "errors")) unknown("github", operation, "graphql-errors");
		if (!record(response.data?.repository)) { unknown("github", operation, "invalid-response"); return null; }
		return response.data.repository;
	};
	const connection = (value, source, subject, limit) => {
		if (!record(value) || !Array.isArray(value.nodes)) {
			unknown(source, subject, "invalid-response");
			return [];
		}
		if (!Number.isSafeInteger(value.totalCount) || value.totalCount < 0 ||
			typeof value.pageInfo?.hasNextPage !== "boolean") unknown(source, subject, "invalid-completeness");
		else if (value.totalCount > limit || value.nodes.length > limit) unknown(source, subject, "limit-exceeded");
		else if (value.pageInfo.hasNextPage || value.totalCount !== value.nodes.length) unknown(source, subject, "incomplete");
		return value.nodes.slice(0, limit);
	};
	const prs = graphql("ExternalOverlapPullRequests",
		"pullRequests(first:100,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}) { totalCount pageInfo { hasNextPage } nodes { number headRefName headRefOid files(first:100) { totalCount pageInfo { hasNextPage } nodes { path } } } }");
	const ownBranches = new Set(Object.values(lane.issues).map(entry => entry.branch));
	const ownPrs = new Set(snapshots.map(row => row.obs.pr?.number).filter(Boolean));
	if (prs) for (const pr of connection(prs.pullRequests, "pr", "OPEN", 100)) {
		if (!Number.isSafeInteger(pr?.number) || pr.number < 1 || !sha(pr.headRefOid) ||
			typeof pr.headRefName !== "string") { unknown("pr", "OPEN", "invalid-pr"); continue; }
		if (ownBranches.has(pr.headRefName) || ownPrs.has(pr.number)) continue;
		const files = [];
		for (const file of connection(pr.files, "pr-files", pr.number, 100)) {
			if (typeof file?.path !== "string" || !file.path) unknown("pr-files", pr.number, "invalid-path");
			else files.push(file.path);
		}
		candidates.prMatches.push({ pr: pr.number, head: pr.headRefOid, files });
	}
	for (const { lane: other, entry } of external.slice(50)) unknown("issue", `${other.lane_id}:${entry.issue}`, "limit-exceeded");
	const bounded = external.slice(0, 50);
	if (!bounded.length) return candidates;
	const fields = bounded.map(({ entry }, index) =>
		`issue${index}:issue(number:${entry.issue}) { state title body } branch${index}:pullRequests(first:1,states:[OPEN,CLOSED,MERGED],headRefName:${JSON.stringify(entry.branch)},orderBy:{field:UPDATED_AT,direction:DESC}) { totalCount pageInfo { hasNextPage } nodes { number state headRefOid } }`).join(" ");
	const issues = graphql("ExternalOverlapIssues", fields);
	if (!issues) return candidates;
	for (const [index, { lane: other, entry }] of bounded.entries()) {
		const subject = `${other.lane_id}:${entry.issue}`;
		const latest = issues[`issue${index}`];
		const start = candidates.unknowns.length;
		const branches = connection(issues[`branch${index}`], "issue-pr", subject, 1);
		const pr = branches[0];
		if (!record(latest) || !["OPEN", "CLOSED"].includes(latest.state) ||
			typeof latest.title !== "string" || typeof latest.body !== "string" ||
			(branches.length && (!Number.isSafeInteger(pr?.number) || pr.number < 1 ||
				!["OPEN", "CLOSED", "MERGED"].includes(pr.state) || !sha(pr.headRefOid)))) {
			unknown("issue", subject, "invalid-response");
			continue;
		}
		if (candidates.unknowns.length !== start) continue;
		const branch = run(root, "git", ["show-ref", "--verify", "--quiet", `refs/heads/${entry.branch}`]) !== null;
		const worktree = existsSync(resolve(root, ".worktrees", entry.branch));
		if (!entry.blocker && ((pr?.state === "MERGED" && !branch && !worktree) ||
			(latest.state === "CLOSED" && !pr))) continue;
		const preflight = entry.facts.preflight?.value;
		try { validatePreflight(preflight); }
		catch (error) {
			if (!(error instanceof TypeError)) throw error;
			unknown("preflight", subject, "invalid-preflight");
			continue;
		}
		const head = branch ? run(root, "git", ["rev-parse", entry.branch]) : null;
		const source = run(root, "git", ["rev-parse", "--verify", `refs/remotes/origin/${other.base_branch}^{commit}`]);
		const anchor = preflight.base_sha;
		const baseSha = source && run(root, "git", ["rev-parse", "--verify", `${anchor}^{commit}`]) === anchor &&
			run(root, "git", ["merge-base", "--is-ancestor", anchor, source]) !== null &&
			(!branch || run(root, "git", ["merge-base", "--is-ancestor", anchor, head]) !== null) ? anchor : null;
		const mergeBase = branch ? run(root, "git", ["merge-base", entry.branch, `origin/${other.base_branch}`]) : null;
		const changed = baseSha && branch && mergeBase
			? run(root, "git", ["diff", "--name-only", "--no-renames", "-z", `${mergeBase}...${head}`], false)
			: baseSha && !branch ? "" : null;
		const status = evaluatePreflight(preflight, { issue: entry.issue, issueSha256: issueDigest(latest), baseSha,
			changedFiles: changed === null ? null : changed.split("\0").filter(Boolean),
			reviewAxisFloor: entry.facts.review?.value?.active_axes ?? [] });
		if (!status.valid) { unknown("preflight", subject, status.reason); continue; }
		candidates.laneMatches.push({ lane_id: other.lane_id, issue: entry.issue, files: preflight.predicted_files });
	}
	return candidates;
};
const saveLane = (path, lane, create = false) => {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(lane, null, 2)}\n`, { flag: "wx" });
	try {
		if (create) linkSync(temporary, path);
		else renameSync(temporary, path);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
};

// SQLite supplies an OS-owned cross-process write lock, not a stale-file
// timeout. SIGKILL releases ownership; concurrent waiters serialize without
// unlinking an inode that a live owner or another waiter might still hold.
// The lock file persists, and all lane data stays in the atomic JSON file.
const lockLane = (path) => {
	const database = new DatabaseSync(`${path}.lock`, { timeout: 60_000 });
	try {
		database.exec("BEGIN IMMEDIATE");
	} catch (error) {
		database.close();
		throw error;
	}
	return () => database.close();
};

const issueEntry = (lane, issue) => {
	const entry = lane.issues[String(issue)];
	if (!entry) throw new TypeError(`issue ${issue} is not in this lane`);
	return entry;
};

const branchFor = (entry) => entry.branch;

const factIfCurrent = (entry, kind, headSha) => {
	const fact = entry.facts?.[kind];
	if (!fact || fact.head !== headSha) return null;
	return typeof fact.value === "object" && fact.value !== null
		? { ...fact.value, head: fact.head }
		: fact.value;
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const nestedPath = (root, candidate) =>
	candidate === root || candidate.startsWith(`${root}${sep}`);

export const validateLocalCheckFact = (
	worktree,
	headSha,
	baseRef,
	value,
	binding,
) => {
	if (
		!value || typeof value !== "object" || value.status !== "passed" ||
		value.valid !== true ||
		typeof value.receiptPath !== "string" ||
		typeof value.receiptSha256 !== "string" ||
		!/^[0-9a-f]{64}$/u.test(value.receiptSha256)
	) {
		throw new TypeError(
			"local-checks requires a passed receipt reference and sha256",
		);
	}
	const root = resolve(worktree);
	const evidenceRoot = resolve(root, ".omo", "verification");
	const receiptPath = resolve(root, value.receiptPath);
	if (!nestedPath(evidenceRoot, receiptPath)) {
		throw new TypeError(
			"local-checks receipt path escapes verification evidence root",
		);
	}
	if (!existsSync(receiptPath)) {
		throw new TypeError("local-checks receipt is missing");
	}
	const bytes = readFileSync(receiptPath);
	if (sha256(bytes) !== value.receiptSha256) {
		throw new TypeError("local-checks receipt digest mismatch");
	}
	let receipt;
	try {
		receipt = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new TypeError("local-checks receipt is malformed");
	}
	if (
		!validateReceiptEvidence(receipt, {
			receiptPath: value.receiptPath,
			receiptSha256: value.receiptSha256,
			worktree: root,
		}).valid
	) {
		throw new TypeError(
			"local-checks receipt evidence is missing or tampered",
		);
	}
	const identity = collectIdentity(root, baseRef);
	const plan = buildVerificationPlan({
		changedFiles: identity.changedFiles,
		identity,
		root,
		manifest: readVerificationManifest(manifestPath(root)),
		forceFull: receipt.forceFull ?? false,
	});
	// Native v1 evidence is historical; only the exact Linux PR profile can
	// satisfy the lane's post-review local gate.
	if (
		receipt.version !== 2 || receipt.profile !== "pr" ||
		plan.profile !== "pr" ||
		!validateReceipt(receipt).valid ||
		receipt.identity.headSha !== headSha ||
		!receiptMatchesPlan(receipt, identity, plan)
	) {
		throw new TypeError(
			"local-checks receipt is not a valid passed receipt for --head",
		);
	}
	if (
		!binding ||
		!(Date.parse(receipt.startedAt) > Date.parse(binding.reviewAcceptedAt))
	) {
		throw new TypeError(
			"local-checks receipt must start after the current passing review was accepted",
		);
	}
	return {
		...binding,
		head: headSha,
		receiptStartedAt: receipt.startedAt,
		receiptPath: relative(root, receiptPath),
		receiptSha256: value.receiptSha256,
		status: "passed",
		valid: true,
	};
};

// Read declarations and producer evidence from the observed Git objects, not
// the engine checkout. The shared owner contract precedes filename exclusions.
export const isConsumerVisibleFile = (file, {
	root = resolve(fileURLToPath(new URL("../../../../", import.meta.url))),
	head = "HEAD",
	base = head,
} = {}) => productionInputClassifier(root, head, base)(file);

export const isChangesetFile = (file) =>
	/^\.changeset\/.+\.md$/.test(file) && !file.endsWith("README.md");

// `$create-lane` emits a canonical lane v2 ledger at `.omo/lanes/<lane-id>.json`.
// v4 consumes issues, dependencies, merge approval, hints and retry policy;
// other v2 execution fields belong to the former runtime. Exported
// so the translation is testable rather than buried in argument parsing.
// Provenance back-reference written into the v4 lane at init time. Two files
// describe "the lane" during a run — the v2 planning ledger (immutable
// evidence) and the v4 runtime state (mutated by every set-fact/record) — and
// without this link the runtime file cannot say which planning bytes it came
// from. Hashing the exact bytes (not the parsed value) makes later ledger
// edits detectable.
export const sourceLedgerRef = (path, contents) => {
	if (typeof path !== "string" || path.length === 0) {
		throw new TypeError("source ledger path must be a non-empty string");
	}
	if (typeof contents !== "string") {
		throw new TypeError("source ledger contents must be a string");
	}
	return {
		path,
		sha256: createHash("sha256").update(contents).digest("hex"),
	};
};

export const laneV2ToInitSpecs = (laneV2) => {
	if (laneV2?.version !== 2) {
		throw new TypeError('lane v2 intake requires "version": 2');
	}
	validateOverlapMarker(laneV2);
	const issues = laneV2.confirmed_issues;
	if (
		!Array.isArray(issues) || issues.length === 0 ||
		issues.some((n) => !Number.isSafeInteger(n) || n < 1)
	) {
		throw new TypeError(
			"lane v2 confirmed_issues must be a non-empty array of positive integers",
		);
	}
	const members = new Set(issues);
	if (Object.hasOwn(laneV2, "retry_policy")) {
		validateRetryPolicy(laneV2.retry_policy);
	}
	assertPredictedConflicts(laneV2.predicted_conflicts, issues);
	const graph = laneV2.dependency_graph ?? {};
	const specs = issues.map((n) => {
		const deps = (graph[String(n)] ?? []).map(Number);
		for (const d of deps) {
			if (!members.has(d)) {
				throw new TypeError(
					`lane v2 dependency ${d} of issue ${n} is not in confirmed_issues`,
				);
			}
		}
		return { n, deps };
	});
	return {
		laneId: laneV2.lane_id,
		baseBranch: laneV2.base_branch ?? "main",
		specs,
		// The maintainer's lane-plan approval already covers merging every
		// issue in this lane; import it so the merge gate does not re-ask.
		mergeApproved: laneV2.authority_scope?.pr_merge === true,
		...(Object.hasOwn(laneV2, "retry_policy") ? { retryPolicy: structuredClone(laneV2.retry_policy) } : {}),
		...(Object.hasOwn(laneV2, "predicted_conflicts") ? { predictedConflicts: laneV2.predicted_conflicts } : {}),
		...(Object.hasOwn(laneV2, "preflight_overlap") ? { preflightOverlap: laneV2.preflight_overlap } : {}),
	};
};

// Returns no exception to exact-head review when any Git observation is uncertain.
// Callers supply canonical stored evidence, never claims from a review submission.
export const observeReviewRetention = (root, { previousReview, previousAcceptedAt, headSha, baseHeadSha, policy, worktree, checkoutHeadSha = headSha }) => {
	try {
		if (!previousReview || !policy || !worktree || previousReview.head === headSha) return undefined;
		const git = (...args) => execFileSync("git", args, {
			cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
		});
		const text = (...args) => git(...args).toString().trim();
		const previousHead = previousReview.head;
		if (validateReviewFact(previousReview, previousHead, policy).verdict !== "pass") return undefined;
		if (text("-C", worktree, "rev-parse", "HEAD") !== checkoutHeadSha
			|| text("-C", worktree, "status", "--porcelain=v1") !== ""
			|| realpathSync(text("-C", worktree, "rev-parse", "--show-toplevel")) !== realpathSync(worktree)) return undefined;
		for (const sha of [previousHead, headSha, baseHeadSha]) {
			if (typeof sha !== "string" || !/^[a-f0-9]{40}$/u.test(sha)
				|| text("rev-parse", "--verify", `${sha}^{commit}`) !== sha) return undefined;
		}
		// Conflict integration appends a head; rewritten/unrelated history has no retention proof.
		git("merge-base", "--is-ancestor", previousHead, headSha);
		git("merge-base", "--is-ancestor", headSha, checkoutHeadSha);
		const previousBase = text("merge-base", previousHead, baseHeadSha);
		const newBase = text("merge-base", headSha, baseHeadSha);
		const paths = (from, to) => {
			const bytes = git("diff", "--name-only", "--no-renames", "-z", from, to);
			if (!Buffer.from(bytes.toString()).equals(bytes)) throw new TypeError("Unreadable Git paths");
			const result = bytes.toString().split("\0").filter(Boolean);
			if (result.some((path) => !path || path.includes("\\") || /[\x00-\x1f*?]/u.test(path)
				|| path.split("/").some((part) => !part || part === "." || part === ".."))) {
				throw new TypeError("Ambiguous Git path");
			}
			return result;
		};
		const authored = [...new Set([...paths(previousBase, previousHead), ...paths(newBase, headSha)])].sort();
		const changed = paths(previousHead, headSha).filter((path) => authored.includes(path)).sort();
		if (!changed.length || !changed.every(isRetentionProsePath)) return undefined;
		const entry = (head, path) => {
			const bytes = git("ls-tree", "-z", head, "--", path).toString();
			if (!bytes) return { sha256: null, mode: null };
			const match = /^([0-7]{6}) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(bytes);
			if (!match || match[3] !== path) throw new TypeError("Unreadable Git entry");
			const blob = git("cat-file", "blob", match[2]);
			return { sha256: sha256(blob), mode: match[1], blob };
		};
		const prose = (path) => {
			if (!isRetentionProsePath(path)) return false;
			for (const head of [previousHead, headSha]) {
				const file = entry(head, path);
				if (file.mode === null) continue;
				if (file.mode !== "100644" || !Buffer.from(file.blob.toString()).equals(file.blob)
					|| /(?:^---\s*$|@generated|auto[- ]generated|do not edit|<!--[^>]*(?:sentinel|machine|generated|source|fixture)|sourceFingerprint)/imu.test(file.blob.toString())) return false;
				// Source consumers (including guards and generators) disqualify Markdown.
				// Search both immutable trees, including the former authored paths.
				try {
					git("grep", "-I", "-l", "-F", "-e", path, "-e", path.split("/").at(-1),
						head, "--", ":!*.md", ":!*.mdx", ":!pnpm-lock.yaml");
					return false;
				} catch (error) {
					if (error.status !== 1) throw error;
				}
			}
			return true;
		};
		if (!changed.every(prose)) return undefined;
		const axes = policy.active_axes.filter((axis) => axis !== "contract").sort();
		const compared = authored.filter((path) => !prose(path)).map((path) => {
			const previous = entry(previousHead, path);
			const current = entry(headSha, path);
			return { path, axes, previous_sha256: previous.sha256, new_sha256: current.sha256,
				previous_mode: previous.mode, new_mode: current.mode };
		});
		const retention = { version: 1, previous_head_sha: previousHead, new_head_sha: headSha,
			contract_sha256: policy.contract_sha256, policy_sha256: policy.sha256,
			previous_merge_base_sha: previousBase, new_merge_base_sha: newBase,
			previous_review: previousReview, previous_accepted_at: previousAcceptedAt,
			changed_files: changed, compared_files: compared };
		retentionFreshAxes(retention, headSha, policy);
		// Every nested hop must still match Git, not merely its stored digest syntax.
		if (previousReview.retention && !authenticateReviewRetention(root, previousReview.retention, policy, worktree, baseHeadSha)) return undefined;
		if (text("-C", worktree, "rev-parse", "HEAD") !== checkoutHeadSha
			|| text("-C", worktree, "status", "--porcelain=v1") !== "") return undefined;
		return retention;
	} catch {
		return undefined;
	}
};

export const authenticateReviewRetention = (root, retention, policy, worktree, baseHeadSha) => {
	// Old hops have their own immutable head; the live checkout is checked at
	// the outer boundary, so authenticate each hop in the object database.
	const observed = observeReviewRetention(root, {
		previousReview: retention.previous_review, previousAcceptedAt: retention.previous_accepted_at,
		headSha: retention.new_head_sha, baseHeadSha, policy, worktree,
		checkoutHeadSha: run(worktree, "git", ["rev-parse", "HEAD"]),
	});
	return observed !== undefined && isDeepStrictEqual(observed, retention);
};

export const observeIssue = (root, lane, issue, candidateBase = null) => {
	const entry = issueEntry(lane, issue);
	const branch = branchFor(entry);
	const observationFailures = [];
	const github = (source, subject, args, valid) => {
		let output;
		try {
			output = execFileSync("gh", args, {
				cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, GH_PAGER: "cat" },
			});
		} catch (error) {
			// gh pr view has one explicit not-found outcome; auth, network,
			// repository and all other command failures remain failed observations.
			if (source === "pr" && error.status === 1 &&
				String(error.stderr).trim() === `no pull requests found for branch "${subject}"`) return null;
			observationFailures.push({ source, subject, code: "command-failed" });
			return null;
		}
		try {
			const value = JSON.parse(output);
			if (valid(value)) return value;
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
		observationFailures.push({ source, subject, code: "invalid-response" });
		return null;
	};
	const branchExists = run(root, "git", [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/heads/${branch}`,
	]) !== null;
	const worktreePath = resolve(root, ".worktrees", branch);
	const worktreeExists = existsSync(worktreePath);
	const headSha = branchExists
		? run(root, "git", ["rev-parse", branch])
		: null;
	const sourceSha = run(root, "git", [
		"rev-parse",
		"--verify",
		`refs/remotes/origin/${lane.base_branch}^{commit}`,
	]);
	const preflight = entry.facts?.preflight?.value ?? null;
	const anchor = candidateBase ?? preflight?.base_sha ?? sourceSha;
	const baseSha = sourceSha && anchor &&
			run(root, "git", [
					"rev-parse",
					"--verify",
					`${anchor}^{commit}`,
				]) === anchor &&
			run(root, "git", [
					"merge-base",
					"--is-ancestor",
					anchor,
					sourceSha,
				]) !== null &&
			(!branchExists ||
				run(root, "git", [
						"merge-base",
						"--is-ancestor",
						anchor,
						headSha,
					]) !== null)
		? anchor
		: null;
	const mergeBase = branchExists
		? run(root, "git", ["merge-base", branch, `origin/${lane.base_branch}`])
		: null;
	const hasNewCommits = branchExists && headSha !== null &&
		mergeBase !== null && headSha !== mergeBase;

	// NUL separation and --no-renames preserve every path, including rename
	// sources, so a move out of approved scope cannot hide behind rename detection.
	// Scope belongs to the issue diff, not upstream work incorporated by a
	// merge/rebase. Local verification keeps its independent pinned base.
	const changed = baseSha && branchExists && mergeBase
		? run(root, "git", [
			"diff",
			"--name-only",
			"--no-renames",
			"-z",
			`${mergeBase}...${headSha}`,
		], false)
		: baseSha && !branchExists
		? ""
		: null;
	const changedFiles = changed === null
		? null
		: changed.split("\0").filter(Boolean);
	const generatedHints = (lane.predicted_conflicts ?? []).filter((hint) =>
		hint.generated && hint.issues.includes(issue));
	const incorporated = baseSha && mergeBase && baseSha !== mergeBase
		? run(root, "git", ["diff", "--name-only", "--no-renames", "-z", `${baseSha}..${mergeBase}`], false)
		: "";
	const incorporatedFiles = (incorporated ?? "").split("\0").filter(Boolean);
	const generatedIntegrationRequired = generatedHints.filter((hint) =>
		incorporatedFiles.some((file) => file === hint.surface || hint.generated.inputs.some((input) => input.path === file)));
	const generatedIntegration = (() => {
		const fact = entry.facts?.["generated-integration"];
		if (!fact || fact.head !== headSha || !worktreeExists) return null;
		try {
			return validateGeneratedIntegration(worktreePath,
				{ head: headSha, hints: generatedIntegrationRequired, execute: false }, fact.value);
		} catch {
			return null;
		}
	})();
	const consumerInput = productionInputClassifier(root, headSha, baseSha ?? headSha);
	const publicPackagesTouched = (changedFiles ?? []).some(consumerInput);
	const changesetPresent = (changedFiles ?? []).some(isChangesetFile);

	let pr = null;
	const parsed = github("pr", branch, [
		"pr",
		"view",
		branch,
		"--json",
		"number,state,headRefOid,mergeable,statusCheckRollup,mergeCommit,mergedAt",
	], (value) => value !== null && Number.isSafeInteger(value.number) && value.number > 0
		&& ["OPEN", "CLOSED", "MERGED"].includes(value.state)
		&& typeof value.headRefOid === "string" && /^[a-f0-9]{40}$/u.test(value.headRefOid)
		&& (value.statusCheckRollup === null || (Array.isArray(value.statusCheckRollup)
			&& value.statusCheckRollup.every((check) => check !== null
				&& typeof check === "object" && !Array.isArray(check)))));
	if (parsed !== null) {
		const rollup = parsed.statusCheckRollup ?? [];
		const states = rollup.map((c) => c.conclusion ?? c.state ?? "PENDING");
		let ciStatus = null;
		if (states.length > 0) {
			if (
				states.some((s) =>
					[
						"FAILURE",
						"ERROR",
						"CANCELLED",
						"TIMED_OUT",
						"ACTION_REQUIRED",
					].includes(s)
				)
			) {
				ciStatus = "failing";
			} else if (
				states.every((s) =>
					["SUCCESS", "NEUTRAL", "SKIPPED"].includes(s)
				)
			) {
				ciStatus = "passing";
			} else {
				ciStatus = "pending";
			}
		}
		pr = {
			number: parsed.number,
			state: parsed.state,
			headSha: parsed.headRefOid,
			mergeable: parsed.mergeable,
			ciStatus,
			mergeCommit: parsed.mergeCommit?.oid ?? null,
			mergedAt: parsed.mergedAt ?? null,
		};
		const runJson = ["OPEN", "MERGED"].includes(parsed.state) ? run(root, "gh", ["api", "--paginate", "--slurp",
			`repos/{owner}/{repo}/actions/runs?branch=${encodeURIComponent(branch)}&event=pull_request&per_page=100`]) : null;
		pr.ciRuns = null;
		if (parsed.state === "OPEN") {
			let pages = null;
			if (runJson !== null) {
				try {
					pages = JSON.parse(runJson);
				} catch (error) {
					if (!(error instanceof SyntaxError)) throw error;
				}
			}
			let canonical = null;
			if (Array.isArray(pages) && pages.length > 0
				&& pages.every((page) => page !== null && typeof page === "object"
					&& Number.isSafeInteger(page.total_count) && page.total_count >= 0
					&& page.total_count === pages[0].total_count && Array.isArray(page.workflow_runs))) {
				const runs = pages.flatMap((page) => page.workflow_runs);
				if (pages[0].total_count === runs.length
					&& runs.every((observed) => observed !== null && typeof observed === "object"
						&& Number.isSafeInteger(observed.id) && observed.id > 0
						&& Number.isSafeInteger(observed.run_attempt) && observed.run_attempt > 0
						&& typeof observed.head_sha === "string" && /^[a-f0-9]{40}$/u.test(observed.head_sha)
						&& typeof observed.path === "string" && observed.path.length > 0
						&& typeof observed.status === "string"
						&& (observed.conclusion === null || typeof observed.conclusion === "string"))
					&& new Set(runs.map((observed) => observed.id)).size === runs.length) {
					for (const observed of runs) {
						if (observed.head_sha === pr.headSha && observed.path === ".github/workflows/ci.yml"
							&& (!canonical || observed.id > canonical.id)) canonical = observed;
					}
				}
			}
			if (canonical?.status === "completed"
				&& ["failure", "timed_out", "cancelled", "action_required", "stale", "startup_failure"].includes(canonical.conclusion)) {
				pr.ciStatus = "failing";
			} else if (ciStatus === "passing"
				&& !(canonical?.status === "completed" && canonical.conclusion === "success")) {
				pr.ciStatus = "pending";
			}
		} else if (runJson !== null) {
			const pages = JSON.parse(runJson);
			if (Array.isArray(pages) && pages.every((page) => Array.isArray(page.workflow_runs))
				&& pages[0]?.total_count === pages.flatMap((page) => page.workflow_runs).length) {
				const latest = new Map();
				for (const observed of pages.flatMap((page) => page.workflow_runs)) {
					if (observed.head_sha !== pr.headSha) continue;
					if (!Number.isSafeInteger(observed.id) || !Number.isSafeInteger(observed.run_attempt)
						|| observed.run_attempt < 1 || typeof observed.path !== "string") {
						throw new TypeError("Invalid final GitHub CI run identity");
					}
					const previous = latest.get(observed.path);
					if (!previous || observed.id > previous.id) latest.set(observed.path, {
						id: observed.id, attempt: observed.run_attempt, head: observed.head_sha,
						workflow: observed.path, status: observed.status, conclusion: observed.conclusion,
					});
				}
				pr.ciRuns = [...latest.values()].sort((a, b) => a.workflow.localeCompare(b.workflow));
			}
		}
	}

	const issueData = github("issue", issue, [
		"issue",
		"view",
		String(issue),
		"--json",
		"state,title,body",
	], (value) => value !== null && ["OPEN", "CLOSED"].includes(value.state)
		&& typeof value.title === "string" && typeof value.body === "string");
	const issueState = issueData?.state ?? null;
	const issueSha256 = typeof issueData?.title === "string" &&
			typeof issueData?.body === "string"
		? issueDigest(issueData)
		: null;
	const reviewAxisFloor = entry.facts?.review?.value?.active_axes ?? [];
	const preflightStatus = evaluatePreflight(preflight, {
		issue,
		issueSha256,
		baseSha,
		changedFiles,
		reviewAxisFloor,
	});
	let review = headSha ? factIfCurrent(entry, "review", headSha) : null;
	const previous = entry.facts?.review;
	const retentionCheckout = worktreeExists
		&& run(worktreePath, "git", ["branch", "--show-current"]) === branch;
	let reviewRetention = preflightStatus.valid && retentionCheckout ? observeReviewRetention(root, {
		previousReview: previous?.value, previousAcceptedAt: previous?.accepted_at,
		headSha, baseHeadSha: sourceSha, policy: preflightStatus.policy, worktree: worktreeExists ? worktreePath : null,
	}) : undefined;
	if (run(root, "git", ["rev-parse", branch]) !== headSha
		|| run(root, "git", ["rev-parse", `refs/remotes/origin/${lane.base_branch}`]) !== sourceSha) reviewRetention = undefined;
	if (review?.retention && (!preflightStatus.valid || !retentionCheckout
		|| !authenticateReviewRetention(root, review.retention, preflightStatus.policy, worktreePath, sourceSha))) review = null;
	const freshReviewAxes = preflightStatus.valid
		? retentionFreshAxes(reviewRetention, headSha, preflightStatus.policy) : null;
	const reviewAcceptedAt = review
		? entry.facts?.review?.accepted_at ?? null
		: null;
	const binding = (() => {
		if (!headSha || !worktreeExists || !preflightStatus.valid) return null;
		try {
			return localCheckBinding(
				validateReviewFact(review, headSha, preflightStatus.policy),
				reviewAcceptedAt,
			);
		} catch {
			return null;
		}
	})();
	const localChecks = (() => {
		const fact = factIfCurrent(entry, "local-checks", headSha);
		if (!fact || !binding) return null;
		if (
			fact.preflightSha256 !== binding.preflightSha256 ||
			fact.reviewSha256 !== binding.reviewSha256
		) return null;
		if (fact.status === "failed") return fact;
		try {
			return validateLocalCheckFact(
				worktreePath,
				headSha,
				baseSha,
				fact,
				binding,
			);
		} catch {
			return { ...fact, status: "failed", valid: false };
		}
	})();
	const waiver = entry.facts?.["local-ci-waiver"];
	const localCiWaiver = isValidLocalCiWaiver(waiver, {
			headSha,
			laneId: lane.lane_id,
			issue,
			contractSha256: preflight?.sha256,
			binding,
		})
		? waiver
		: null;

	const unmetDependencies = (entry.depends_on ?? []).filter((dep) => {
		const s = github("dependency", dep, [
			"issue",
			"view",
			String(dep),
			"--json",
			"state",
		], (value) => value !== null && ["OPEN", "CLOSED"].includes(value.state));
		return s?.state !== "CLOSED";
	});

	return {
		laneId: lane.lane_id,
		observationFailures,
		issue,
		issueState,
		issueSha256,
		changedFiles,
		preflight,
		reviewAxisFloor,
		preflightPolicy: preflightStatus.valid ? preflightStatus.policy : null,
		branch: branchExists ? branch : null,
		worktree: worktreeExists ? worktreePath : null,
		headSha,
		baseSha,
		hasNewCommits,
		localChecks,
		localCiWaiver,
		publicPackagesTouched,
		changesetPresent,
		review,
		reviewAcceptedAt,
		...(reviewRetention ? { reviewRetention, freshReviewAxes } : {}),
		pr,
		unmetDependencies,
		generatedIntegrationRequired,
		generatedIntegration,
		knownBaselines: (entry.facts?.["known-baseline"]?.value ?? []).map((record) =>
			observeKnownBaseline(root, record, {
				issue, head: headSha, members: Object.keys(lane.issues).map(Number),
			})),
	};
};

const main = async () => {
	const [command, ...args] = process.argv.slice(2);
	const preparationBlocker = command === "record-review-preparation-blocker"
		? parseReviewPreparationBlocker(args) : null;
	const root = resolve(arg(args, "--root", "."));
	const observationProcess = randomUUID();
	const recordObservation = (laneId, row) => recordRetroEvent(root, laneId, row.issue, "observation", {
		observationId: randomUUID(), processId: observationProcess, clock: "monotonic",
		monotonicMs: performance.now(), head: row.obs.headSha, action: row.decision.action,
		siblings: row.decision.siblings ?? [], surfaces: row.decision.surfaces ?? [],
		...(row.obs.externalOverlaps ? { externalOverlaps: row.obs.externalOverlaps } : {}),
	});

	if (command === "init") {
		// Either translate a `$create-lane` v2 ledger, or take explicit --issue specs.
		const fromLaneV2 = args.includes("--from-lane-v2")
			? arg(args, "--from-lane-v2")
			: null;
		if (fromLaneV2 !== null && args.includes("--preflight-overlap")) {
			throw new TypeError("--preflight-overlap cannot be combined with --from-lane-v2");
		}
		let laneId;
		let baseBranch = "main";
		let specs;
		let ledgerRef = null;
		let mergeApproved = false;
		let predictedConflicts;
		let retryPolicy;
		let preflightOverlap = args.includes("--preflight-overlap") ? 1 : undefined;
		if (fromLaneV2 !== null) {
			const raw = readFileSync(resolve(root, fromLaneV2), "utf8");
			const translated = laneV2ToInitSpecs(JSON.parse(raw));
			laneId = args.includes("--lane-id")
				? arg(args, "--lane-id")
				: translated.laneId;
			baseBranch = translated.baseBranch;
			specs = translated.specs;
			ledgerRef = sourceLedgerRef(fromLaneV2, raw);
			mergeApproved = translated.mergeApproved;
			predictedConflicts = translated.predictedConflicts;
			retryPolicy = translated.retryPolicy;
			preflightOverlap = translated.preflightOverlap;
		} else {
			laneId = arg(args, "--lane-id");
			// --issue accepts `N` or `N:dep1,dep2` (deps must be lane members).
			specs = [];
			for (let i = 0; i < args.length; i += 1) {
				if (args[i] !== "--issue") continue;
				const [numRaw, depsRaw] = String(args[i + 1]).split(":");
				const n = Number(numRaw);
				const deps = depsRaw ? depsRaw.split(",").map(Number) : [];
				specs.push({ n, deps });
			}
		}
		const all = specs.map((s) => s.n);
		if (
			specs.length === 0 ||
			specs.some((s) => !Number.isSafeInteger(s.n) || s.n < 1) ||
			specs.some((s) => s.deps.some((d) => !all.includes(d)))
		) {
			throw new TypeError(
				"init requires positive --issue values; deps must be lane members (N:dep1,dep2)",
			);
		}
		const dir = resolve(root, ".omo", "lanes-v4");
		mkdirSync(dir, { recursive: true });
		const lane = {
			version: 4,
			...(preflightOverlap === undefined ? {} : { preflight_overlap: preflightOverlap }),
			lane_id: laneId,
			base_branch: baseBranch,
			// Present only for --from-lane-v2 inits; a hand-built lane has no
			// planning ledger to point at.
			...(ledgerRef ? { source_ledger: ledgerRef } : {}),
			...(predictedConflicts === undefined ? {} : { predicted_conflicts: predictedConflicts }),
			...(retryPolicy === undefined ? {} : { retry_policy: retryPolicy }),
			issues: Object.fromEntries(
				specs.map(({ n, deps }) => [String(n), {
					issue: n,
					branch: `issue-${n}`,
					depends_on: deps,
					attempts: {},
					approvals: { merge: mergeApproved },
					blocker: null,
					facts: {},
				}]),
			),
		};
		const path = resolve(dir, `${laneId}.json`);
		saveLane(path, lane, true);
		process.stdout.write(`${path}\n`);
		return;
	}

	const lanePath = resolve(root, arg(args, "--lane"));
	const release = (preparationBlocker || ["record", "set-fact", "approve-merge", "clear-blocker"].includes(command))
		? await lockLane(lanePath) : null;
	try {
	const lane = loadLane(lanePath);
	const invalidateReadiness = (number, force = false) => {
		if (lane.preflight_overlap !== 1) return;
		const current = issueEntry(lane, number);
		const fact = current.facts?.["review-readiness"];
		if (fact?.value?.active !== true) return;
		const obs = observeIssue(root, lane, number);
		if (force || !reviewReadinessState({ issue: number,
			obs: { ...obs, facts: current.facts }, decision: decideNext(current, obs) }).current) {
			fact.value.active = false;
		}
	};

	const observeCoordinated = (fresh, { invalidate = false } = {}) => {
		assertPredictedConflicts(fresh.predicted_conflicts, Object.keys(fresh.issues).map(Number));
		const snapshots = Object.keys(fresh.issues).map((key) => {
			const n = Number(key);
			const obs = observeIssue(root, fresh, n);
			const decision = decideNext(fresh.issues[key], obs);
			return {
				issue: n,
				decision,
				obs: {
							...obs,
							attempts: fresh.issues[key].attempts,
							facts: fresh.issues[key].facts,
						},
			};
		});
		// Legacy lanes take the exact old observation path, without ancestry probes.
		if (fresh.preflight_overlap === 1) {
			const accepted = snapshots.filter(row =>
				evaluatePreflight(row.obs.preflight, { ...row.obs, issue: row.issue }).valid);
			const merged = accepted.filter(row => row.obs.pr?.state === "MERGED");
			for (const row of accepted.filter(row => row.decision.action === "review")) {
				const related = merged.filter(sibling => sibling.issue !== row.issue &&
					row.obs.preflight.predicted_files.some(file => sibling.obs.preflight.predicted_files.includes(file)));
				if (!related.length) continue;
				const base = run(root, "git", ["rev-parse", "--verify", `refs/remotes/origin/${fresh.base_branch}^{commit}`]);
				const ancestor = (commit, target) => {
					if (!/^[a-f0-9]{40}$/u.test(commit ?? "") || !target ||
						run(root, "git", ["rev-parse", "--verify", `${commit}^{commit}`]) !== commit) return null;
					try {
						execFileSync("git", ["merge-base", "--is-ancestor", commit, target],
							{ cwd: root, stdio: ["ignore", "pipe", "pipe"] });
						return true;
					} catch (error) {
						if (error.status === 1) return false;
						return null;
					}
				};
				row.obs.overlapIntegrations = related.map(sibling => ({
					issue: sibling.issue, commit: sibling.obs.pr.mergeCommit, base,
					inBase: ancestor(sibling.obs.pr.mergeCommit, base),
					inHead: ancestor(sibling.obs.pr.mergeCommit, row.obs.headSha),
				}));
			}
		}
		const legacy = coordinateGeneratedIntegration(fresh, snapshots);
		let changed = false;
		const deactivate = (row) => {
			const fact = fresh.issues[String(row.issue)].facts?.["review-readiness"];
			if (fact?.value?.active === true && !reviewReadinessState(row).current) {
				fact.value.active = false;
				changed = true;
			}
		};
		if (invalidate && fresh.preflight_overlap === 1) legacy.forEach(deactivate);
		const coordinated = coordinatePreflightOverlap(fresh, legacy);
		if (invalidate && fresh.preflight_overlap === 1) coordinated.forEach(deactivate);
		return { coordinated, changed };
	};

	// Watch runs for a long time: re-load the lane file every tick so
	// facts/approvals recorded by concurrent operator commands are seen.
	const snapshotAll = (withObservations = false, previous = null) => {
		const unlock = lane.preflight_overlap === 1 ? lockLane(lanePath) : null;
		let fresh;
		let coordinated;
		try {
		fresh = loadLane(lanePath);
		let changed;
		({ coordinated, changed } = observeCoordinated(fresh, { invalidate: true }));
		if (fresh.preflight_overlap === 1) {
			const outputIssue = command === "plan" ? Number(arg(args, "--issue")) : null;
			const watchReviews = command === "watch" ? new Set(summarizeTransitions(previous, coordinated).changes
				.filter(change => change.to === "review").map(change => change.issue)) : null;
			const grants = coordinated.filter(row => reviewReadinessState(row).grantable &&
				(command === "plan" ? row.issue === outputIssue : command === "watch"
					? watchReviews.has(row.issue) : command === "plan-all") &&
				!reviewReadinessState(row).current);
			if (grants.length) {
				const sequences = Object.values(fresh.issues).map(entry => entry.facts?.["review-readiness"]?.value?.sequence)
					.filter(value => Number.isSafeInteger(value) && value > 0);
				const sequence = Math.max(0, ...sequences) + 1;
				if (!Number.isSafeInteger(sequence)) throw new TypeError("review-readiness sequence exhausted");
				for (const row of grants) {
					const state = reviewReadinessState(row);
					const entry = fresh.issues[String(row.issue)];
					entry.facts ??= {};
					entry.facts["review-readiness"] = { head: row.obs.headSha,
						value: { policy_sha256: state.policy.sha256, sequence, active: true } };
					row.obs.facts = entry.facts;
				}
				changed = true;
			}
			if (changed) saveLane(lanePath, fresh);
		}
		} finally {
			unlock?.();
		}
		// Supplementary network work cannot affect the committed decisions or
		// readiness grants and must not delay a concurrent record writer.
		if (fresh.preflight_overlap === 1 && ["plan", "plan-all", "watch"].includes(command)) {
			const candidates = externalOverlapCandidates(root, lanePath, fresh, coordinated);
			for (const row of coordinated) {
				const valid = evaluatePreflight(row.obs.preflight, { ...row.obs, issue: row.issue }).valid;
				row.obs.externalOverlaps = externalOverlapObservation(valid ? row.obs.preflight.predicted_files : null, candidates);
			}
		}
		if ((fresh.preflight_overlap === 1 || fresh.predicted_conflicts?.some((hint) => hint.generated)) &&
			["plan", "plan-all", "watch"].includes(command)) {
			for (const row of coordinated) recordObservation(fresh.lane_id, row);
		}
		return coordinated.map(({ obs, ...row }) =>
			({ ...row, ...(obs.externalOverlaps ? { externalOverlaps: obs.externalOverlaps } : {}),
				...(withObservations ? { obs } : {}) }));
	};

	if (["retro-plan", "retro-evidence", "retro-report"].includes(command)) {
		const snapshots = snapshotAll(true);
		const request = retrospectiveRequest(root, lane.lane_id, snapshots);
		const result = command === "retro-evidence"
			? retrospectiveEvidence(root, lane.lane_id, snapshots)
			: command === "retro-report" && request.action === "retro"
			? recordRetrospective(root, request, retroInput(root, args))
			: request;
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	if (command === "plan-all") {
		const withRetro = args.includes("--with-retro");
		const snapshots = snapshotAll(withRetro);
		const issues = snapshots.map(({ issue, decision, externalOverlaps }) => ({
			issue,
			decision,
			...(externalOverlaps ? { externalOverlaps } : {}),
		}));
		const retrospective = withRetro
			? retrospectiveRequest(root, lane.lane_id, snapshots)
			: null;
		process.stdout.write(
			`${
				JSON.stringify(
					withRetro
						? {
							issues,
							retrospective,
							settled: issues.every((item) =>
								item.decision.action === "done"
							) && retrospective.action === "done",
						}
						: issues,
					null,
					2,
				)
			}\n`,
		);
		return;
	}
	if (command === "watch") {
		// Auto-tick: re-observe the lane, print ONLY decision transitions,
		// exit 0 when the lane settles (every issue done or blocked). This
		// closes the dependent-release wake gap without any journal: each
		// tick is a fresh GitHub/git observation.
		const intervalSec = Number(arg(args, "--interval", "60"));
		const once = args.includes("--once");
		// A decision that stops moving is owed an operator action; transitions
		// alone hide that (issue 3400 sat in `review` for hours unnoticed).
		// Fires at every threshold multiple; 0 disables.
		const stallAfter = Number(arg(args, "--stall-after", "15"));
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const loop = async () => {
			let prev = null;
			let stallCounts = null;
			for (;;) {
				const next = snapshotAll(true, prev);
				const { changes, settled } = summarizeTransitions(prev, next);
				for (const row of next) {
					if (row.obs.externalOverlaps && JSON.stringify(row.obs.externalOverlaps) !==
						JSON.stringify(prev?.find(item => item.issue === row.issue)?.obs.externalOverlaps)) {
						process.stdout.write(`${new Date().toISOString()} OBSERVATION issue ${row.issue}: externalOverlaps=${JSON.stringify(row.obs.externalOverlaps)}\n`);
					}
				}
				for (const c of changes) {
					if (
						c.to === "fix-back" &&
						next.find((item) => item.issue === c.issue)?.decision
								.reason === "ci-failing"
					) {
						captureRetroCi(root, loadLane(lanePath), c.issue);
					}
					process.stdout.write(
						`${new Date().toISOString()} issue ${c.issue}: ${
							c.from ?? "(start)"
						} -> ${c.to}${c.to === "wait-preflight-overlap"
							? ` siblings=${JSON.stringify(next.find(item => item.issue === c.issue).decision.siblings)}` : ""
						}${next.find(item => item.issue === c.issue).decision.overlaps
							? ` overlaps=${JSON.stringify(next.find(item => item.issue === c.issue).decision.overlaps)}`
							: c.to === "wait-generated-integration"
							? ` siblings=${JSON.stringify(next.find((item) => item.issue === c.issue).decision.siblings)}` : ""}\n`,
					);
				}
				const tracked = trackStalls(stallCounts, next, stallAfter);
				stallCounts = tracked.counts;
				for (const s of tracked.stalled) {
					process.stdout.write(
						`${
							new Date().toISOString()
						} STALLED issue ${s.issue}: ${s.action} x ${s.ticks} ticks\n`,
					);
				}
				if (settled) {
					if (next.every((item) => item.decision.action === "done")) {
						const request = retrospectiveRequest(
							root,
							lane.lane_id,
							next,
						);
						if (request.action === "retro") {
							process.stdout.write(
								`RETRO-READY ${JSON.stringify(request)}\n`,
							);
						} else if (request.action === "collect-ci") {
							process.stdout.write(`RETRO-COLLECT ${JSON.stringify(request)}\n`);
						}
					}
					process.stdout.write(
						`LANE-SETTLED ${
							JSON.stringify(
								next.map((r) => ({
									issue: r.issue,
									action: r.decision.action,
								})),
							)
						}\n`,
					);
					return;
				}
				if (once) return;
				prev = next;
				await sleep(intervalSec * 1000);
			}
		};
		await loop();
		return;
	}

	const issue = Number(arg(args, "--issue"));
	const entry = issueEntry(lane, issue);

	if (preparationBlocker) {
		if (lane.preflight_overlap !== 1) {
			throw new TypeError("Review-preparation blocker requires preflight_overlap: 1");
		}
		const replay = isDeepStrictEqual(entry.blocker, preparationBlocker);
		if (entry.blocker != null && !replay) {
			throw new TypeError("Issue already has a different blocker");
		}
		const grant = entry.facts?.["review-readiness"];
		const { head_sha, policy_sha256, sequence } = preparationBlocker;
		if (grant?.head !== head_sha || grant.value.policy_sha256 !== policy_sha256 ||
			grant.value.sequence !== sequence || grant.value.active !== !replay) {
			throw new TypeError("Review-preparation blocker requires the exact review grant");
		}
		// For a replay, observe past this blocker without giving back its priority.
		const observedLane = replay ? { ...lane, issues: { ...lane.issues, [issue]: { ...entry, blocker: null } } } : lane;
		const { coordinated } = observeCoordinated(observedLane);
		const { obs, decision } = coordinated.find(row => row.issue === issue);
		if (!(decision.action === "review" || (replay && decision.action === "wait-preflight-overlap")) ||
			obs.issueState !== "OPEN" || (obs.pr && (obs.pr.state !== "OPEN" || obs.pr.headSha === head_sha)) ||
			!obs.worktree || obs.headSha !== head_sha || obs.preflightPolicy?.sha256 !== policy_sha256) {
			throw new TypeError("Issue is not eligible for a review-preparation blocker on this grant");
		}
		const commonDir = run(root, "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
		const checkout = run(obs.worktree, "git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel", "HEAD"]);
		if (!commonDir || checkout !== `${commonDir}\n${realpathSync(obs.worktree)}\n${head_sha}` ||
			run(obs.worktree, "git", ["branch", "--show-current"]) !== obs.branch ||
			run(obs.worktree, "git", ["--no-optional-locks", "status", "--porcelain=v1"]) !== "") {
			throw new TypeError("Issue is not eligible without its current clean implementation checkout");
		}
		if (!replay) {
			entry.blocker = preparationBlocker;
			grant.value.active = false;
			saveLane(lanePath, lane);
		}
		process.stdout.write("ok\n");
		return;
	}

	if (command === "retro-record") {
		const kind = arg(args, "--kind");
		if (!["review", "implementer", "incident", "stage-lifecycle"].includes(kind)) {
			throw new TypeError("Use retro-ci for authoritative CI snapshots");
		}
		const result = recordRetroEvent(
			root,
			lane.lane_id,
			issue,
			kind,
			retroInput(root, args),
		);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		return;
	}
	if (command === "retro-ci") {
		process.stdout.write(
			`${JSON.stringify(captureRetroCi(root, lane, issue))}\n`,
		);
		return;
	}

	if (command === "plan") {
		const { obs, decision } = snapshotAll(true).find((row) => row.issue === issue);
		process.stdout.write(
			`${JSON.stringify({ issue, decision, obs }, null, 2)}\n`,
		);
		return;
	}
	if (command === "record") {
		const phase = arg(args, "--phase");
		const result = JSON.parse(arg(args, "--result-json"));
		const observed = observeIssue(root, lane, issue);
		invalidateReadiness(issue);
		validateStageMeasurements(result?.measurements, observed.headSha);
		const unavailable = result?.error?.code === "dispatch-target-unavailable";
		if (unavailable) {
			if (!["preflight", "implement", "fix-back", "review"].includes(phase)) {
				throw new TypeError("Unavailable child target requires a child stage");
			}
			if (result.ok !== false) throw new TypeError("Unavailable target cannot be a successful result");
			validateUnavailableTarget(phase, result.error, observed.preflightPolicy?.active_axes);
		} else if (result?.ok === true && !(lane.retry_policy?.stop_on_child_contract_error === true
			&& result.error?.type === "child-contract-error")) {
			if (["preflight", "implement", "fix-back", "review"].includes(phase)
				&& Object.hasOwn(result, "category")) {
				throw new TypeError("Category workers cannot supply registered stage successes");
			}
			const targets = phase === "review"
				? Object.values(dispatchFor(phase, observed.freshReviewAxes ?? observed.preflightPolicy?.active_axes))
				: dispatchFor(phase) ? [dispatchFor(phase)] : [];
			for (const target of targets) {
				registeredDispatch(root, target);
			}
			if (phase === "review") {
				if (["retention", "changed_files", "docs_only", "equivalent"].some((key) => Object.hasOwn(result, key))) {
					throw new TypeError("Review claims cannot supply retention");
				}
				const { head_sha, preflight_sha256, active_axes, reviews } = result;
				// Admit fresh evidence here; stored legacy validation is observation-only.
				buildReviewFact({ head_sha, preflight_sha256, active_axes, reviews }, observed.headSha, observed.preflightPolicy, observed.reviewRetention);
			} else if (["preflight", "implement", "fix-back"].includes(phase)) {
				assertAgentIdentity(dispatchFor(phase), result.agent);
			}
		}
		const next = unavailable
			? { ...entry, blocker: { ...result.error, type: "input-preparation", phase } }
			: applyChildResult(entry, phase, result, { retryPolicy: lane.retry_policy ?? undefined, now: Date.now() });
		const childContractError = next.blocker?.type === "child-contract-error"
			&& lane.retry_policy?.stop_on_child_contract_error === true
			&& (typeof result?.ok !== "boolean" || result?.error?.type === "child-contract-error");
		if (!childContractError && phase === "resolve-conflict" && result?.ok === true) {
			const obs = observeIssue(root, lane, issue);
			if (result.head_sha !== obs.headSha) throw new TypeError("Conflict result requires current head_sha");
			if (obs.generatedIntegrationRequired.length) {
				next.facts ??= {};
				next.facts["generated-integration"] = {
					head: obs.headSha,
					value: validateGeneratedIntegration(obs.worktree,
						{ head: obs.headSha, hints: obs.generatedIntegrationRequired, execute: true }, result.generated_integration),
				};
			}
		}
		if (!childContractError && phase === "verify-local" && result?.ok === false) {
			const obs = observeIssue(root, lane, issue);
			if (
				result.head_sha !== obs.headSha || !obs.preflightPolicy ||
				typeof result.evidence !== "string" || !result.evidence.trim()
			) {
				throw new TypeError(
					"failed local CI requires current head_sha and failure evidence",
				);
			}
			const binding = localCheckBinding(
				validateReviewFact(
					obs.review,
					obs.headSha,
					obs.preflightPolicy,
				),
				obs.reviewAcceptedAt,
			);
			next.facts ??= {};
			next.facts["local-checks"] = {
				head: obs.headSha,
				value: {
					...binding,
					head: obs.headSha,
					status: "failed",
					valid: false,
					evidence: result.evidence,
				},
			};
		}
		if (entry.blocker?.type === "input-preparation" && entry.blocker.phase === "review" &&
			entry.blocker.reason === "prior-head-red-unavailable") {
			// A late child result is not an operator release of the parked review.
			next.blocker = entry.blocker;
		}
		lane.issues[String(issue)] = next;
		invalidateReadiness(issue, ["fix-back", "resolve-conflict"].includes(phase));
		saveLane(lanePath, lane);
		recordRetroEvent(root, lane.lane_id, issue, "stage", {
			phase,
			result,
			head: observed.headSha,
			attempts: next.attempts,
		});
		if (!unavailable && ["merge", "fix-back"].includes(phase)) {
			captureRetroCi(root, lane, issue);
		}
		process.stdout.write(
			`${
				JSON.stringify(
					{ issue, attempts: next.attempts, blocker: next.blocker },
					null,
					2,
				)
			}\n`,
		);
		return;
	}
	if (command === "set-fact") {
		const kind = arg(args, "--kind");
		if (
			!["preflight", "local-checks", "local-ci-waiver", "review", "known-baseline"]
				.includes(kind)
		) {
			throw new TypeError(
				"kind must be preflight, local-checks, local-ci-waiver, review or known-baseline",
			);
		}
		const value = JSON.parse(arg(args, "--value"));
		if (kind === "review") {
			recordRetroEvent(root, lane.lane_id, issue, "review", value);
		}
		entry.facts ??= {};
		if (kind === "known-baseline") {
			const authenticated = validateKnownBaseline(root, value, Object.keys(lane.issues).map(Number));
			if (!authenticated.issues.includes(issue)) {
				throw new TypeError("known-baseline must include the addressed issue");
			}
			// Registration is explicitly scoped to the lead-confirmed targets,
			// not every branch and not the current implementation head.
			for (const target of authenticated.issues) {
				const targetEntry = issueEntry(lane, target);
				targetEntry.facts ??= {};
				const previous = targetEntry.facts[kind]?.value ?? [];
				targetEntry.facts[kind] = {
					value: [...previous.filter(record => record.id !== authenticated.id), authenticated],
				};
			}
		} else if (kind === "preflight") {
			validatePreflight(value);
			const previousObs = observeIssue(root, lane, issue);
			const obs = observeIssue(root, lane, issue, value.base_sha);
			const status = evaluatePreflight(value, { ...obs, issue });
			if (!status.valid) {
				throw new TypeError(`preflight rejected: ${status.reason}`);
			}
			const previous = previousObs.preflightPolicy?.active_axes ??
				previousObs.preflight?.active_axes ?? [];
			if (previous.some((axis) => !value.active_axes.includes(axis))) {
				throw new TypeError(
					"preflight cannot shrink previously approved review axes",
				);
			}
			if (
				status.policy.active_axes.some((axis) =>
					!value.active_axes.includes(axis)
				)
			) {
				throw new TypeError(
					"preflight active_axes must include axes required by the actual diff",
				);
			}
			if (entry.facts.preflight?.value?.sha256 !== value.sha256) {
				entry.facts.preflight = { value };
				delete entry.facts.review;
				delete entry.facts["local-checks"];
				delete entry.facts["local-ci-waiver"];
			}
		} else {
			const head = arg(args, "--head");
			let storedValue;
			const obs = observeIssue(root, lane, issue);
			if (head !== obs.headSha || !obs.preflightPolicy) {
				throw new TypeError(
					`${kind} requires current head and valid preflight`,
				);
			}
			const acceptedAt = new Date().toISOString();
			if (kind === "local-checks") {
				const binding = localCheckBinding(
					validateReviewFact(obs.review, head, obs.preflightPolicy),
					obs.reviewAcceptedAt,
				);
				storedValue = validateLocalCheckFact(
					resolve(root, ".worktrees", branchFor(entry)),
					head,
					obs.baseSha,
					value,
					binding,
				);
			} else if (kind === "local-ci-waiver") {
				const binding = localCheckBinding(
					validateReviewFact(obs.review, head, obs.preflightPolicy),
					obs.reviewAcceptedAt,
				);
				if (obs.localChecks?.status === "failed") {
					throw new TypeError(
						"local-ci-waiver cannot override failed local checks",
					);
				}
				if (
					!isValidLocalCiWaiver({
						head,
						accepted_at: acceptedAt,
						value,
					}, {
						headSha: obs.headSha,
						laneId: lane.lane_id,
						issue,
						contractSha256: obs.preflight.sha256,
						binding,
					})
				) {
					throw new TypeError(
						"local-ci-waiver requires exact operator evidence and current bindings",
					);
				}
				storedValue = value;
			} else {
				for (const target of Object.values(dispatchFor("review", obs.freshReviewAxes ?? obs.preflightPolicy.active_axes))) {
					registeredDispatch(root, target);
				}
				// Share the record path's evidence requirements, never the legacy reader.
				storedValue = buildReviewFact(value, head, obs.preflightPolicy, obs.reviewRetention);
				delete entry.facts["local-checks"];
				delete entry.facts["local-ci-waiver"];
			}
			entry.facts[kind] = {
				head,
				value: storedValue,
				...(["review", "local-ci-waiver"].includes(kind)
					? { accepted_at: acceptedAt }
					: {}),
			};
		}
		for (const target of kind === "known-baseline" ? value.issues : [issue]) invalidateReadiness(target);
		saveLane(lanePath, lane);
		process.stdout.write("ok\n");
		return;
	}
	if (command === "approve-merge") {
		entry.approvals.merge = true;
		saveLane(lanePath, lane);
		process.stdout.write("ok\n");
		return;
	}
	if (command === "clear-blocker") {
		const phase = arg(args, "--phase");
		if (!entry.blocker || entry.blocker.phase !== phase) {
			throw new TypeError("clear-blocker requires the current blocker's phase");
		}
		const blocker = entry.blocker;
		invalidateReadiness(issue, true);
		entry.blocker = null;
		entry.attempts[phase] = 0;
		if (entry.retry_telemetry) delete entry.retry_telemetry[phase];
		saveLane(lanePath, lane);
		recordRetroEvent(root, lane.lane_id, issue, "incident", {
			action: "clear-blocker", phase, blocker, operation_id: randomUUID(),
		});
		process.stdout.write("ok\n");
		return;
	}
	throw new TypeError(`unknown command: ${command}`);
	} finally {
		release?.();
	}
};

// Only run the CLI when this file is the process entrypoint, so the pure
// helpers above can be imported by tests without argument parsing exploding.
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try { await main(); }
	catch (error) {
		if (error instanceof ReviewReadinessError) {
			process.stderr.write(`${JSON.stringify({ status: "blocked", name: error.name, code: error.code,
				issue: error.issue, field: error.field, error: error.message })}\n`);
		} else {
			if (!(error instanceof DispatchPreparationError)) throw error;
			process.stderr.write(`${JSON.stringify({ status: "blocked", kind: error.kind,
				code: error.code, error: error.message, subagent_type: error.subagent_type, fix_back_eligible: false })}\n`);
		}
		process.exitCode = 1;
	}
}
