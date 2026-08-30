#!/usr/bin/env node
// execute-lane v4 CLI: observation + lane file IO around the pure engine.
//
// Commands:
//   init            --root . --lane-id <id> --issue <n> [--issue <n> ...]
//   plan            --root . --lane <path> --issue <n>
//   plan-all        --root . --lane <path>
//   watch           --root . --lane <path> [--interval 60] [--once]
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
import { fileURLToPath } from 'node:url';

import { applyChildResult, decideNext, summarizeTransitions } from './lane-v4.mjs';

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

// Consumer-visible only: test files, test-support types, fixtures, and docs do
// not ship to consumers and therefore do not require a changeset per
// docs/contracts/release-governance.md. Exported so the gate is testable —
// when this lived inline it could drift silently.
export const isConsumerVisibleFile = (file) => {
	if (!file.startsWith('packages/') || file.endsWith('.md')) {
		return false;
	}
	if (/\.(test|test-fixture)\.[cm]?ts$/.test(file)) {
		return false;
	}
	const withinPackage = file.replace(/^packages\/[^/]+\//, '');
	return !/(^|\/)(test-types|__tests__|test)\//.test(withinPackage);
};

export const isChangesetFile = (file) => /^\.changeset\/.+\.md$/.test(file) && !file.endsWith('README.md');

// `$create-lane` emits a canonical lane v2 ledger at `.omo/lanes/<lane-id>.json`.
// v4 consumes only the issue set and the dependency edges from it; every other v2
// field describes v1's DAG/authority machinery, which v4 does not have. Exported
// so the translation is testable rather than buried in argument parsing.
export const laneV2ToInitSpecs = (laneV2) => {
	if (laneV2?.version !== 2) {
		throw new TypeError('lane v2 intake requires "version": 2');
	}
	const issues = laneV2.confirmed_issues;
	if (!Array.isArray(issues) || issues.length === 0 || issues.some((n) => !Number.isSafeInteger(n) || n < 1)) {
		throw new TypeError('lane v2 confirmed_issues must be a non-empty array of positive integers');
	}
	const members = new Set(issues);
	const graph = laneV2.dependency_graph ?? {};
	const specs = issues.map((n) => {
		const deps = (graph[String(n)] ?? []).map(Number);
		for (const d of deps) {
			if (!members.has(d)) {
				throw new TypeError(`lane v2 dependency ${d} of issue ${n} is not in confirmed_issues`);
			}
		}
		return { n, deps };
	});
	return {
		laneId: laneV2.lane_id,
		baseBranch: laneV2.base_branch ?? 'main',
		specs,
	};
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
		publicPackagesTouched = files.some(isConsumerVisibleFile);
		changesetPresent = files.some(isChangesetFile);
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

	const unmetDependencies = (entry.depends_on ?? []).filter((dep) => {
		const s = run(root, 'gh', ['issue', 'view', String(dep), '--json', 'state', '--jq', '.state']);
		return s !== 'CLOSED';
	});

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
		unmetDependencies,
	};
};

const main = () => {
	const [command, ...args] = process.argv.slice(2);
	const root = resolve(arg(args, '--root', '.'));

	if (command === 'init') {
		// Either translate a `$create-lane` v2 ledger, or take explicit --issue specs.
		const fromLaneV2 = args.includes('--from-lane-v2') ? arg(args, '--from-lane-v2') : null;
		let laneId;
		let baseBranch = 'main';
		let specs;
		if (fromLaneV2 !== null) {
			const translated = laneV2ToInitSpecs(JSON.parse(readFileSync(resolve(root, fromLaneV2), 'utf8')));
			laneId = args.includes('--lane-id') ? arg(args, '--lane-id') : translated.laneId;
			baseBranch = translated.baseBranch;
			specs = translated.specs;
		} else {
			laneId = arg(args, '--lane-id');
			// --issue accepts `N` or `N:dep1,dep2` (deps must be lane members).
			specs = [];
			for (let i = 0; i < args.length; i += 1) {
				if (args[i] !== '--issue') continue;
				const [numRaw, depsRaw] = String(args[i + 1]).split(':');
				const n = Number(numRaw);
				const deps = depsRaw ? depsRaw.split(',').map(Number) : [];
				specs.push({ n, deps });
			}
		}
		const all = specs.map((s) => s.n);
		if (
			specs.length === 0 ||
			specs.some((s) => !Number.isSafeInteger(s.n) || s.n < 1) ||
			specs.some((s) => s.deps.some((d) => !all.includes(d)))
		) {
			throw new TypeError('init requires positive --issue values; deps must be lane members (N:dep1,dep2)');
		}
		const dir = resolve(root, '.omo', 'lanes-v4');
		mkdirSync(dir, { recursive: true });
		const lane = {
			version: 4,
			lane_id: laneId,
			base_branch: baseBranch,
			issues: Object.fromEntries(
				specs.map(({ n, deps }) => [String(n), {
					issue: n,
					branch: `issue-${n}`,
					depends_on: deps,
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

	// Watch runs for a long time: re-load the lane file every tick so
	// facts/approvals recorded by concurrent operator commands are seen.
	const snapshotAll = () => {
		const fresh = loadLane(lanePath);
		return Object.keys(fresh.issues).map((key) => {
			const n = Number(key);
			const obs = observeIssue(root, fresh, n);
			const decision = decideNext(fresh.issues[key], obs);
			return { issue: n, decision };
		});
	};

	if (command === 'plan-all') {
		process.stdout.write(`${JSON.stringify(snapshotAll(), null, 2)}\n`);
		return;
	}
	if (command === 'watch') {
		// Auto-tick: re-observe the lane, print ONLY decision transitions,
		// exit 0 when the lane settles (every issue done or blocked). This
		// closes the dependent-release wake gap without any journal: each
		// tick is a fresh GitHub/git observation.
		const intervalSec = Number(arg(args, '--interval', '60'));
		const once = args.includes('--once');
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const loop = async () => {
			let prev = null;
			for (; ;) {
				const next = snapshotAll();
				const { changes, settled } = summarizeTransitions(prev, next);
				for (const c of changes) {
					process.stdout.write(
						`${new Date().toISOString()} issue ${c.issue}: ${c.from ?? '(start)'} -> ${c.to}\n`,
					);
				}
				if (settled) {
					process.stdout.write(`LANE-SETTLED ${JSON.stringify(next.map((r) => ({ issue: r.issue, action: r.decision.action })))}\n`);
					return;
				}
				if (once) return;
				prev = next;
				await sleep(intervalSec * 1000);
			}
		};
		loop();
		return;
	}

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

// Only run the CLI when this file is the process entrypoint, so the pure
// helpers above can be imported by tests without argument parsing exploding.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
