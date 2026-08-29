#!/usr/bin/env node
// execute-lane v4 CLI: observation + lane file IO around the pure engine.
//
// Commands:
//   init            --root . --lane-id <id> --issue <n> [--issue <n> ...]
//   plan            --root . --lane <path> --issue <n>
//   record          --root . --lane <path> --issue <n> --phase <p> --result-json <json>
//   set-fact        --root . --lane <path> --issue <n> --kind local-checks|review --head <sha> --value <json>
//   approve-merge   --root . --lane <path> --issue <n>
//
// The lane file stores intent (attempts, approvals, blockers) and
// head-bound semantic facts. Everything else is observed live from
// git and GitHub on every plan call: there is no session identity and
// no event journal. A new head silently invalidates stale facts.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyChildResult, decideNext } from './lane-v4.mjs';

const arg = (args, flag, fallback) => {
	const i = args.indexOf(flag);
	if (i === -1 || args[i + 1] === undefined) {
		if (fallback !== undefined) return fallback;
		throw new TypeError(`missing ${flag}`);
	}
	return args[i + 1];
};

const run = (cwd, cmd, cmdArgs) => {
	try {
		return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch {
		return null;
	}
};

const loadLane = (path) => JSON.parse(readFileSync(path, 'utf8'));
const saveLane = (path, lane) => writeFileSync(path, `${JSON.stringify(lane, null, 2)}\n`);

const issueEntry = (lane, issue) => {
	const entry = lane.issues[String(issue)];
	if (!entry) throw new TypeError(`issue ${issue} is not in this lane`);
	return entry;
};

const branchFor = (entry) => entry.branch;

const factIfCurrent = (entry, kind, headSha) => {
	const fact = entry.facts?.[kind];
	if (!fact || fact.head !== headSha) return null;
	return typeof fact.value === 'object' && fact.value !== null
		? { ...fact.value, head: fact.head }
		: fact.value;
};

export const observeIssue = (root, lane, issue) => {
	const entry = issueEntry(lane, issue);
	const branch = branchFor(entry);
	const branchExists = run(root, 'git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]) !== null;
	const worktreePath = resolve(root, '.worktrees', branch);
	const worktreeExists = existsSync(worktreePath);
	const headSha = branchExists ? run(root, 'git', ['rev-parse', branch]) : null;
	const baseSha = run(root, 'git', ['rev-parse', `origin/${lane.base_branch}`]);
	const mergeBase = branchExists ? run(root, 'git', ['merge-base', branch, `origin/${lane.base_branch}`]) : null;
	const hasNewCommits = branchExists && headSha !== null && headSha !== mergeBase;

	let publicPackagesTouched = false;
	let changesetPresent = false;
	if (hasNewCommits) {
		const changed = run(root, 'git', ['diff', '--name-only', `${mergeBase}...${headSha}`]) ?? '';
		const files = changed.split('\n').filter(Boolean);
		publicPackagesTouched = files.some((f) => f.startsWith('packages/'));
		changesetPresent = files.some((f) => /^\.changeset\/.+\.md$/.test(f) && !f.endsWith('README.md'));
	}

	let pr = null;
	const prJson = run(root, 'gh', [
		'pr', 'view', branch, '--json', 'number,state,headRefOid,mergeable,statusCheckRollup',
	]);
	if (prJson !== null) {
		const parsed = JSON.parse(prJson);
		const rollup = parsed.statusCheckRollup ?? [];
		const states = rollup.map((c) => c.conclusion ?? c.state ?? 'PENDING');
		let ciStatus = null;
		if (states.length > 0) {
			if (states.some((s) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s))) {
				ciStatus = 'failing';
			} else if (states.every((s) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(s))) {
				ciStatus = 'passing';
			} else {
				ciStatus = 'pending';
			}
		}
		pr = {
			number: parsed.number,
			state: parsed.state,
			headSha: parsed.headRefOid,
			mergeable: parsed.mergeable,
			ciStatus,
		};
	}

	const issueState = (() => {
		const s = run(root, 'gh', ['issue', 'view', String(issue), '--json', 'state', '--jq', '.state']);
		return s ?? 'OPEN';
	})();

	return {
		issueState,
		branch: branchExists ? branch : null,
		worktree: worktreeExists ? worktreePath : null,
		headSha,
		baseSha,
		hasNewCommits,
		localChecks: headSha ? factIfCurrent(entry, 'local-checks', headSha) : null,
		publicPackagesTouched,
		changesetPresent,
		review: headSha ? factIfCurrent(entry, 'review', headSha) : null,
		pr,
	};
};

const main = () => {
	const [command, ...args] = process.argv.slice(2);
	const root = resolve(arg(args, '--root', '.'));

	if (command === 'init') {
		const laneId = arg(args, '--lane-id');
		const issues = [];
		for (let i = 0; i < args.length; i += 1) {
			if (args[i] === '--issue') issues.push(Number(args[i + 1]));
		}
		if (issues.length === 0 || issues.some((n) => !Number.isSafeInteger(n) || n < 1)) {
			throw new TypeError('init requires at least one positive --issue');
		}
		const dir = resolve(root, '.omo', 'lanes-v4');
		mkdirSync(dir, { recursive: true });
		const lane = {
			version: 4,
			lane_id: laneId,
			base_branch: 'main',
			issues: Object.fromEntries(
				issues.map((n) => [String(n), {
					issue: n,
					branch: arg(args, '--branch', `issue-${n}`),
					attempts: {},
					approvals: { merge: false },
					blocker: null,
					facts: {},
				}]),
			),
		};
		const path = resolve(dir, `${laneId}.json`);
		saveLane(path, lane);
		process.stdout.write(`${path}\n`);
		return;
	}

	const lanePath = resolve(root, arg(args, '--lane'));
	const lane = loadLane(lanePath);
	const issue = Number(arg(args, '--issue'));
	const entry = issueEntry(lane, issue);

	if (command === 'plan') {
		const obs = observeIssue(root, lane, issue);
		const decision = decideNext(entry, obs);
		process.stdout.write(`${JSON.stringify({ issue, decision, obs }, null, 2)}\n`);
		return;
	}
	if (command === 'record') {
		const phase = arg(args, '--phase');
		const result = JSON.parse(arg(args, '--result-json'));
		const next = applyChildResult(entry, phase, result);
		lane.issues[String(issue)] = next;
		saveLane(lanePath, lane);
		process.stdout.write(`${JSON.stringify({ issue, attempts: next.attempts, blocker: next.blocker }, null, 2)}\n`);
		return;
	}
	if (command === 'set-fact') {
		const kind = arg(args, '--kind');
		if (!['local-checks', 'review'].includes(kind)) throw new TypeError('kind must be local-checks or review');
		entry.facts ??= {};
		entry.facts[kind] = { head: arg(args, '--head'), value: JSON.parse(arg(args, '--value')) };
		saveLane(lanePath, lane);
		process.stdout.write('ok\n');
		return;
	}
	if (command === 'approve-merge') {
		entry.approvals.merge = true;
		saveLane(lanePath, lane);
		process.stdout.write('ok\n');
		return;
	}
	throw new TypeError(`unknown command: ${command}`);
};

main();
