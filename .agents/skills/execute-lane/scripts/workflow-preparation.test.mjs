import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPreflight, evaluatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { buildReviewFact } from '../../review-head/scripts/contracts.mjs';
import { observeReviewRetention } from './lane-v4-cli.mjs';
import { prepareReviewInput, prepareReviewTransfer, readReviewTransfer, reviewTransferLimits,
  prepareSourceFootprint, sourceFootprintCategories } from './workflow-preparation.mjs';
import * as preparation from './workflow-preparation.mjs';
import { readRegisteredAgents, validateDispatchTarget } from './dispatch-targets.mjs';
import { createCommandRunner } from '../../../../examples/react-vite-ssr/tests/verify-background-starter.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const modulePath = fileURLToPath(new URL('./workflow-preparation.mjs', import.meta.url));

const vitestReporter = fileURLToPath(
	new URL('./fix-back-vitest-reporter.mjs', import.meta.url),
);
const vitestModules = fileURLToPath(
	new URL('../../../../node_modules', import.meta.url),
);

function vitestRedFixture(t, scenario = 'assertion') {
	const value = fixture(t);
	const { input } = value;
	const testFile = 'packages/fixture/regression.test.mjs';
	const baseline = [
		"export default { test: { projects: [{ test: { name: 'packages', include: ['packages/**/*.test.mjs'],",
		`pool: '${scenario === 'threads' ? 'threads' : 'forks'}',`,
		`setupFiles: ${scenario === 'setup' ? "['./setup.mjs']" : '[]'},`,
		`globalSetup: ${
			scenario === 'global-setup' ? "['./setup.mjs']" : '[]'
		} } }] } };`,
	].join('\n');
	writeFileSync(join(value.root, 'vitest.config.mjs'), baseline);
	writeFileSync(
		join(value.root, 'setup.mjs'),
		"throw new Error('setup failure');\n",
	);
	writeFileSync(
		join(value.root, '.gitignore'),
		'.omo/\nnode_modules\nreview/\nreproduction/\nevidence/\n',
	);
	symlinkSync(vitestModules, join(value.root, 'node_modules'), 'dir');
	git(value.root, 'add', 'vitest.config.mjs', 'setup.mjs', '.gitignore');
	git(value.root, 'commit', '-qm', 'Vitest baseline');
	const previous = git(value.root, 'rev-parse', 'HEAD');
	mkdirSync(join(value.root, 'packages/fixture'), { recursive: true });
	const body =
		scenario === 'runtime'
			? "throw new ReferenceError('AssertionError');"
			: scenario === 'helper'
				? 'check(value);'
				: scenario === 'wrong-line'
					? 'expect(value).toBe(3);'
					: "expect(`ReferenceError: ${value}`).toBe('ReferenceError: 3');";
	const testCall =
		scenario === 'green-skip'
			? 'test.skipIf(value === 3)'
			: scenario === 'green-todo'
				? '(value === 3 ? test.todo : test)'
				: `test${scenario === 'skip' ? '.skip' : scenario === 'todo' ? '.todo' : ''}`;
	const source =
		[
			"import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll, aroundEach, onTestFinished } from 'vitest';",
			"import { value } from '../../source.mjs';",
			...(scenario === 'module' ? ["import './missing.mjs';"] : []),
			...(scenario === 'file-spoof'
				? ["import { mkdirSync, writeFileSync } from 'node:fs';"]
				: []),
			...(scenario === 'syntax' ? ['const = ;'] : []),
			...(scenario === 'helper'
				? ["import { check } from './fixtures/helper.mjs';"]
				: []),
			...(scenario === 'shared-hook'
				? [
						'const check = () => { expect(value).toBe(3); };',
						'beforeEach(check);',
					]
				: []),
			...(scenario === 'finished-hook'
				? ['const check = () => { expect(value).toBe(3); };']
				: []),
			...(scenario === 'around-setup'
				? [
						'aroundEach(async (run) => { expect(value).toBe(3); await run(); });',
					]
				: []),
			...(scenario === 'around-teardown'
				? [
						'aroundEach(async (run) => { await run(); expect(value).toBe(3); });',
					]
				: []),
			...(scenario === 'clean-around'
				? [
						'aroundEach(async (run) => { expect(true).toBe(true); await run(); });',
					]
				: []),
			...(scenario === 'nested' ? ["describe('group', () => {"] : []),
			...(scenario.startsWith('hook-')
				? [`${scenario.slice(5)}(() => { expect(value).toBe(3); });`]
				: []),
			...(scenario === 'clean-hook'
				? ['beforeEach(() => { expect(true).toBe(true); });']
				: []),
			`${testCall}(${scenario === 'green-other' ? "value === 3 ? 'other regression' : 'value regression'" : "'value regression'"}, ${scenario === 'shared-hook' ? 'check);' : '() => {'}`,
			...(scenario === 'unhandled'
				? [
						"process.emit('unhandledRejection', new Error('unhandled failure'));",
					]
				: []),
			...(scenario === 'spoof'
				? [
						'console.log(JSON.stringify({ version: 1, reason: "failed", tests: [] }));',
					]
				: []),
			...(scenario === 'file-spoof'
				? [
						"mkdirSync('.omo', { recursive: true });",
						'writeFileSync(\'.omo/fix-back-vitest.json\', \'{"version":1,"complete":true}\');',
					]
				: []),
			...(scenario === 'shared-hook'
				? []
				: [
						`  ${
							scenario === 'finished-hook'
								? 'onTestFinished(check);'
								: scenario.startsWith('hook-') ||
										scenario.startsWith('around-') ||
										scenario === 'spoof'
									? 'expect(true).toBe(true);'
									: body
						}`,
						'});',
					]),
			...(scenario === 'nested'
				? [
						'});',
						"describe('unrelated', () => { test('must not run', () => { throw new Error('unrelated'); }); });",
					]
				: []),
			...(scenario === 'multiple'
				? ["test('value regression', () => { expect(value).toBe(4); });"]
				: []),
		].join('\n') + '\n';
	writeFileSync(join(value.root, testFile), source);
	const projected = [testFile];
	if (scenario === 'helper') {
		mkdirSync(join(value.root, 'packages/fixture/fixtures'));
		writeFileSync(
			join(value.root, 'packages/fixture/fixtures/helper.mjs'),
			"import { expect } from 'vitest';\nexport const check = (value) => { expect(value).toBe(3); };\n",
		);
		projected.push('packages/fixture/fixtures/helper.mjs');
	}
	writeFileSync(join(value.root, 'source.mjs'), 'export const value = 3;\n');
	git(value.root, 'add', 'packages', 'source.mjs');
	git(value.root, 'commit', '-qm', 'Vitest correction');
	const head = git(value.root, 'rev-parse', 'HEAD');
	git(input.checkout, 'checkout', '--detach', '-q', head);
	symlinkSync(vitestModules, join(input.checkout, 'node_modules'), 'dir');
	input.head_sha = head;
	input.implementation = {
		mode: 'fix-back',
		previous_head_sha: previous,
		head_sha: head,
		contract_sha256: '',
	};
	const argv = [
		process.execPath,
		'node_modules/vitest/vitest.mjs',
		'run',
		'--project=packages',
		testFile,
		scenario === 'nested'
			? '--testNamePattern=^group value regression$'
			: '--testNamePattern=^value regression$',
		`--reporter=${vitestReporter}`,
		'--outputFile=.omo/fix-back-vitest.json',
		'--maxWorkers=1',
		'--no-file-parallelism',
	];
	const command = ['node', ...argv.slice(1)]
		.map((arg) =>
			/^[\w./=:-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
		)
		.join(' ');
	input.contract = createPreflight({
		...input.contract,
		scope: ['source.mjs', ...projected],
		validation: [command],
	});
	input.implementation.contract_sha256 = input.contract.sha256;
	input.changed_paths = git(
		value.root,
		'diff',
		'--name-only',
		value.baseHead,
		head,
	).split('\n');
	input.policy = evaluatePreflight(input.contract, {
		issue: 42,
		issueSha256: input.issue_sha256,
		baseSha: value.base,
		changedFiles: input.changed_paths,
	}).policy;
	input.contract = createPreflight({
		...input.contract,
		scope: input.changed_paths,
	});
	input.implementation.contract_sha256 = input.contract.sha256;
	input.policy = evaluatePreflight(input.contract, {
		issue: 42,
		issueSha256: input.issue_sha256,
		baseSha: value.base,
		changedFiles: input.changed_paths,
	}).policy;
	input.diff = value.store(
		'vitest.diff',
		execFileSync(
			'git',
			[
				'diff',
				'--binary',
				'--full-index',
				'--no-renames',
				value.baseHead,
				head,
			],
			{ cwd: value.root, encoding: 'utf8' },
		),
	);
	input.required_checks = [command];
	writeFileSync(input.accepted_contract_path, JSON.stringify(input.contract));
	input.observation = value.store('vitest-plan.json', {
		issue: 42,
		decision: { action: 'review' },
		obs: {
			preflight: input.contract,
			preflightPolicy: input.policy,
			issueSha256: input.issue_sha256,
			baseSha: value.base,
			headSha: head,
			changedFiles: input.changed_paths,
		},
	});
	const patch = value.store(
		'vitest.patch',
		execFileSync(
			'git',
			[
				'diff',
				'--binary',
				'--full-index',
				'--no-renames',
				previous,
				head,
				'--',
				...projected,
			],
			{ cwd: value.root, encoding: 'utf8' },
		),
	);
	const checkout = join(value.root, 'reproduction');
	git(value.root, 'worktree', 'add', '--quiet', '--detach', checkout, previous);
	symlinkSync(vitestModules, join(checkout, 'node_modules'), 'dir');
	const capture = {
		version: 1,
		stage: 'fix-back-red',
		root: value.root,
		checkout,
		artifact_root: join(input.artifact_root, 'red'),
		issue: 42,
		contract: input.contract,
		implementation: input.implementation,
		command,
		argv,
		regression_patch: { ...patch, path: `evidence/${patch.path}` },
		failure: {
			file: testFile,
			line: source.split('\n').findIndex((line) => line.startsWith('  ')) + 1,
			test:
				scenario === 'wrong-test'
					? 'unrelated'
					: scenario === 'nested'
						? 'group > value regression'
						: 'value regression',
		},
	};
	if (scenario === 'wrong-line') capture.failure.line += 1;
	if (scenario === 'shared-hook')
		capture.failure.line =
			source.split('\n').findIndex((line) => line.startsWith('const check')) +
			1;
	if (scenario === 'finished-hook')
		capture.failure.line =
			source.split('\n').findIndex((line) => line.startsWith('const check')) +
			1;
	if (scenario.startsWith('around-'))
		capture.failure.line =
			source.split('\n').findIndex((line) => line.startsWith('aroundEach')) + 1;
	const run = () => cli(value, 'fix-back-red', capture);
	const green = () => {
		const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
		const result = spawnSync(argv[0], argv.slice(1), {
			cwd: input.checkout,
			env: environment,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
			timeout: 30_000,
		});
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			result.output[3],
			readFileSync(join(input.checkout, '.omo/fix-back-vitest.json'), 'utf8'),
		);
		input.evidence = [
			{
				command,
				receipt: value.store('vitest-green.json', {
					...value.receipt,
					command,
					argv,
					head_sha: head,
					tree_sha: git(input.checkout, 'rev-parse', 'HEAD^{tree}'),
					contract_sha256: input.contract.sha256,
					stdout: value.store('vitest-green.stdout', result.stdout),
					stderr: value.store('vitest-green.stderr', result.stderr),
					test_results: value.store('vitest-green.report', result.output[3]),
				}),
			},
		];
	};
	const attach = () => {
		const result = run();
		assert.equal(
			result.status,
			0,
			[
				result.stderr,
				...['stdout', 'stderr', 'vitest.json'].map((name) =>
					existsSync(join(capture.artifact_root, name))
						? readFileSync(join(capture.artifact_root, name), 'utf8')
						: '',
				),
			].join('\n'),
		);
		// Nested references remain relative to the original receipt directory.
		const bytes = readFileSync(join(capture.artifact_root, 'receipt.json'));
		input.fix_back_red = {
			path: 'red/receipt.json',
			sha256: hash(bytes),
			bytes: bytes.length,
		};
	};
	return { ...value, capture, run, attach, green };
}

test('#4232 Vitest body assertion: real RED and GREEN -> common authenticated evidence', (t) => {
	const value = vitestRedFixture(t);
	// The repository root need not install dependencies used by separate worktrees.
	unlinkSync(join(value.root, 'node_modules'));
	value.attach();
	value.green();

	const prepared = prepareReviewInput(value.input);

	assert.equal(prepared.common.fix_back_red.receipt.exit_code, 1);
	assert.equal(
		prepared.common.readable_index.commands[0].test_results.stats.passed,
		1,
	);
	for (const reviewer of prepared.reviewers) {
		assert.deepEqual(reviewer.input.fix_back_red, prepared.common.fix_back_red);
		assert.deepEqual(
			reviewer.input.readable_index,
			prepared.common.readable_index,
		);
	}
});

for (const scenario of [
	'module',
	'syntax',
	'setup',
	'global-setup',
	'hook-beforeEach',
	'hook-afterEach',
	'hook-beforeAll',
	'hook-afterAll',
	'shared-hook',
	'finished-hook',
	'around-setup',
	'around-teardown',
	'unhandled',
	'runtime',
	'helper',
	'wrong-line',
	'wrong-test',
	'multiple',
	'skip',
	'todo',
	'spoof',
	'file-spoof',
]) {
	test(`#4232 Vitest RED: ${scenario} -> fail-closed preparation block`, (t) => {
		const value = vitestRedFixture(t, scenario);

		const result = value.run();

		assert.equal(result.status, 1);
		const block = JSON.parse(result.stderr);
		assert.equal(block.kind, 'input-preparation');
		assert.equal(block.fix_back_eligible, false);
		assert.match(block.error, /Vitest/u);
		if (scenario === 'file-spoof')
			assert.match(block.error, /missing private reporter completion/u);
		assert.equal(existsSync(join(value.capture.artifact_root, 'stdout')), true);
		assert.equal(existsSync(join(value.capture.artifact_root, 'stderr')), true);
		assert.equal(
			existsSync(join(value.capture.artifact_root, 'receipt.json')),
			false,
		);
	});
}

for (const scenario of ['clean-hook', 'clean-around', 'nested']) {
	test(`#4232 Vitest ${scenario}: selected body assertion -> accepted RED and GREEN`, (t) => {
		const value = vitestRedFixture(t, scenario);
		value.attach();
		value.green();

		assert.equal(prepareReviewInput(value.input).status, 'prepared');
	});
}

for (const scenario of ['green-skip', 'green-todo', 'green-other']) {
	test(`#4232 Vitest GREEN: real ${scenario} -> rejected despite exit zero`, (t) => {
		const value = vitestRedFixture(t, scenario);
		value.attach();
		value.green();

		assert.throws(
			() => prepareReviewInput(value.input),
			(error) =>
				error.kind === 'input-preparation' && error.fix_back_eligible === false,
		);
	});
}

test('#4232 Vitest preparation: authenticated reporter tampering and missing GREEN -> fail closed', (t) => {
	const value = vitestRedFixture(t);
	value.attach();
	value.green();
	const receipt = JSON.parse(
		readFileSync(join(value.input.artifact_root, 'vitest-green.json'), 'utf8'),
	);
	const report = JSON.parse(
		readFileSync(
			join(value.input.artifact_root, 'vitest-green.report'),
			'utf8',
		),
	);

	for (const [name, mutate] of [
		[
			'incomplete',
			(r) => {
				r.complete = false;
			},
		],
		[
			'reporter',
			(r) => {
				r.reporter_sha256 = '0'.repeat(64);
			},
		],
		[
			'test',
			(r) => {
				r.tests[0].test = 'other regression';
			},
		],
		[
			'file',
			(r) => {
				r.tests[0].file = 'packages/other.test.mjs';
			},
		],
		[
			'hook',
			(r) => {
				r.tests[0].hooks.beforeEach = 'run';
			},
		],
		[
			'unhandled',
			(r) => {
				r.unhandled.push({ name: 'Error' });
			},
		],
		[
			'no-tests',
			(r) => {
				r.tests = [];
			},
		],
		['missing', null],
		['malformed', null],
	]) {
		const changed = structuredClone(report);
		mutate?.(changed);
		const next = {
			...receipt,
			test_results: value.store(
				'vitest-mutated.report',
				name === 'malformed' ? '{"complete":' : changed,
			),
		};
		if (name === 'missing') delete next.test_results;
		value.input.evidence[0].receipt = value.store('vitest-mutated.json', next);
		assert.throws(
			() => prepareReviewInput(value.input),
			(error) =>
				error.kind === 'input-preparation' && error.fix_back_eligible === false,
			name,
		);
	}
});

test('#4232 Vitest capture: substituted checkout entrypoint -> rejected before spawn', (t) => {
	const value = vitestRedFixture(t);
	unlinkSync(join(value.capture.checkout, 'node_modules'));
	mkdirSync(join(value.capture.checkout, 'node_modules/vitest'), {
		recursive: true,
	});
	const marker = join(value.capture.checkout, 'node_modules/entrypoint-ran');
	writeFileSync(
		join(value.capture.checkout, 'node_modules/vitest/vitest.mjs'),
		`import { writeFileSync } from 'node:fs';\nwriteFileSync(${
			JSON.stringify(marker)
		}, 'ran');\n`,
	);

	const result = value.run();

	assert.equal(
		existsSync(marker),
		false,
		'unapproved checkout entrypoint must not execute',
	);
	assert.equal(result.status, 1, result.stderr);
	assert.match(
		JSON.parse(result.stderr).error,
		/substituted executable or runner entrypoint/u,
	);
	assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
	assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
	assert.equal(existsSync(value.capture.artifact_root), false);
	assert.equal(
		git(value.capture.checkout, 'diff', '--cached', '--name-only'),
		'',
	);
});

test('#4232 Vitest review: substituted corrected checkout entrypoint -> typed block', (t) => {
	const value = vitestRedFixture(t);
	value.attach();
	value.green();
	unlinkSync(join(value.input.checkout, 'node_modules'));
	mkdirSync(join(value.input.checkout, 'node_modules/vitest'), {
		recursive: true,
	});
	writeFileSync(
		join(value.input.checkout, 'node_modules/vitest/vitest.mjs'),
		'// inert unapproved entrypoint\n',
	);

	assert.throws(
		() => prepareReviewInput(value.input),
		(error) =>
			error.kind === 'input-preparation' &&
			error.fix_back_eligible === false &&
			/substituted executable or runner entrypoint/u.test(error.message),
	);
});

test('#4232 Vitest argv: runner, reporter and behavior substitution -> no command executed', (t) => {
	const value = vitestRedFixture(t);
	const initial = [...value.capture.argv];
	for (const [name, mutate] of [
		[
			'executable',
			(argv) => {
				argv[0] = '/usr/bin/false';
			},
		],
		[
			'entrypoint',
			(argv) => {
				argv[1] = './node_modules/vitest/vitest.mjs';
			},
		],
		[
			'reporter',
			(argv) => {
				argv[6] = '--reporter=./fake.mjs';
			},
		],
		[
			'project',
			(argv) => {
				argv[3] = '--project=tooling';
			},
		],
		[
			'extra-behavior',
			(argv) => {
				argv.push('--passWithNoTests');
			},
		],
	]) {
		value.capture.argv = [...initial];
		mutate(value.capture.argv);
		const result = value.run();
		assert.equal(result.status, 1, name);
		assert.equal(JSON.parse(result.stderr).fix_back_eligible, false, name);
		assert.equal(existsSync(value.capture.artifact_root), false, name);
	}
});


function redFixture(t, scenario = 'assertion', comparison = null) {
  const value = fixture(t);
  const { input } = value;
  if (comparison) {
    writeFileSync(join(value.root, 'source.mjs'), `export const value = ${JSON.stringify(comparison.before)};\n`);
    git(value.root, 'add', 'source.mjs');
    git(value.root, 'commit', '-qm', 'assertion data baseline');
  }
  const previous = git(value.root, 'rev-parse', 'HEAD');
  const testFile = 'regression.test.mjs';
  const expected = comparison ? JSON.stringify(comparison.after) : scenario === 'green' ? '2' : '3';
  const source = scenario === 'setup'
    ? "import './missing.mjs';\n"
    : scenario === 'module'
      ? `console.log("code: 'ERR_ASSERTION'");\nawait import('./missing.mjs');\n`
      : scenario === 'syntax'
        ? `import test from 'node:test';\nconst = "code: 'ERR_ASSERTION'";\n`
        : `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './source.mjs';\ntest('value regression', () => {\n  ${scenario === 'reference' ? `console.log("code: 'ERR_ASSERTION'"); unknownValue;` : `assert.equal(value, ${expected});`}\n});\n`;
  writeFileSync(join(value.root, testFile), source);
  writeFileSync(join(value.root, 'source.mjs'), `export const value = ${comparison ? JSON.stringify(comparison.after) : '3'};\n`);
  git(value.root, 'add', testFile, 'source.mjs');
  git(value.root, 'commit', '-qm', 'fix-back');
  const head = git(value.root, 'rev-parse', 'HEAD');
  git(input.checkout, 'checkout', '--detach', '-q', head);
  input.head_sha = head;
  input.implementation = { mode: 'fix-back', previous_head_sha: previous, head_sha: head,
    contract_sha256: '' };
  const argv = [process.execPath, '--test', '--test-reporter=tap', testFile];
  const command = `node --test --test-reporter=tap ${testFile}`;
  input.contract = createPreflight({ ...input.contract, scope: ['source.mjs', testFile], validation: [command] });
  input.implementation.contract_sha256 = input.contract.sha256;
  input.policy = evaluatePreflight(input.contract, { issue: 42, issueSha256: input.issue_sha256,
    baseSha: value.base, changedFiles: [testFile, 'source.mjs'] }).policy;
  input.changed_paths = [testFile, 'source.mjs'];
  input.diff = value.store('fix.diff', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', value.baseHead, head], { cwd: value.root, encoding: 'utf8' }));
  input.required_checks = [command];
  const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
  const passing = scenario === 'assertion'
    ? spawnSync(argv[0], argv.slice(1), { cwd: input.checkout, env: environment, encoding: 'utf8' }) : null;
  if (passing) assert.equal(passing.status, 0, passing.stderr);
  input.evidence = [{ command, receipt: value.store('fix-focused.json', { ...value.receipt,
    command, argv, head_sha: head, tree_sha: git(input.checkout, 'rev-parse', 'HEAD^{tree}'),
    ...(passing ? { stdout: value.store('fix-green.stdout', passing.stdout),
      stderr: value.store('fix-green.stderr', passing.stderr) } : {}),
    contract_sha256: input.contract.sha256 }) }];
  writeFileSync(input.accepted_contract_path, JSON.stringify(input.contract));
  input.observation = value.store('fix-plan.json', { issue: 42, decision: { action: 'review' }, obs: {
    preflight: input.contract, preflightPolicy: input.policy, issueSha256: input.issue_sha256,
    baseSha: value.base, headSha: head, changedFiles: input.changed_paths,
  } });
  const patch = value.store('regression.patch', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', previous, head, '--', testFile], { cwd: value.root, encoding: 'utf8' }));
  const checkout = join(value.root, 'reproduction');
  git(value.root, 'worktree', 'add', '--quiet', '--detach', checkout, previous);
  const capture = { version: 1, stage: 'fix-back-red', root: value.root, checkout,
    artifact_root: join(input.artifact_root, 'red'), issue: 42, contract: input.contract,
    implementation: input.implementation, command, argv,
    regression_patch: { ...patch, path: `evidence/${patch.path}` },
    failure: { file: testFile, line: ['module', 'syntax'].includes(scenario) ? 1 : 5,
      test: ['module', 'syntax'].includes(scenario) ? testFile : 'value regression' } };
  const capturePath = join(input.artifact_root, 'capture.json');
  const run = () => {
    writeFileSync(capturePath, JSON.stringify(capture));
    return spawnSync(process.execPath, [modulePath, 'fix-back-red', capturePath], { encoding: 'utf8' });
  };
  const attach = () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const receipt = readFileSync(join(capture.artifact_root, 'receipt.json'));
    input.fix_back_red = { path: 'red/receipt.json', sha256: hash(receipt), bytes: receipt.length };
    return JSON.parse(receipt);
  };
  return { ...value, head: previous, capture, run, attach };
}

for (const marker of ['ERR_MODULE_NOT_FOUND', 'ERR_TEST_FAILURE', 'SyntaxError:', 'ReferenceError:']) {
  test(`#4128 fix-back diagnostic data: ${marker} in assertion values -> capture and preparation accept RED`, (t) => {
    const value = redFixture(t, 'assertion', { before: marker, after: `normalized ${marker}` });
    const receipt = value.attach();

    const prepared = prepareReviewInput(value.input);

    assert.equal(receipt.exit_code, 1);
    const stdout = readFileSync(join(value.capture.artifact_root, receipt.stdout.path), 'utf8');
    assert.ok(stdout.includes(`actual: '${marker}'`));
    assert.ok(stdout.includes(`expected: 'normalized ${marker}'`));
    assert.deepEqual(prepared.common.fix_back_red.receipt, receipt);
  });
}

for (const [scenario, diagnostic] of [
  ['module', /code: 'ERR_TEST_FAILURE'/u],
  ['syntax', /code: 'ERR_TEST_FAILURE'/u],
  ['reference', /name: 'ReferenceError'/u],
]) {
  test(`#4128 fix-back diagnostic kind: genuine ${scenario} failure -> capture rejects non-assertion RED`, (t) => {
    const value = redFixture(t, scenario);

    const result = value.run();

    assert.equal(result.status, 1);
    const block = JSON.parse(result.stderr);
    assert.equal(block.kind, 'input-preparation');
    assert.match(block.error, /expected one named runner assertion failure/u);
    const stdout = readFileSync(join(value.capture.artifact_root, 'stdout'), 'utf8');
    assert.match(stdout, diagnostic);
    if (scenario === 'reference') assert.match(stdout, /^# code: 'ERR_ASSERTION'$/mu);
  });
}

test('#4128 fix-back RED: actual previous-head assertion -> authenticated common evidence', (t) => {
  const value = redFixture(t);
  const receipt = value.attach();

  const prepared = prepareReviewInput(value.input);

  assert.equal(receipt.previous_head_sha, value.head);
  assert.notEqual(receipt.previous_head_sha, value.base);
  assert.equal(receipt.exit_code, 1);
  assert.equal(receipt.producer, 'lead');
  assert.equal(prepared.common.fix_back_red.receipt.head_sha, value.input.head_sha);
  for (const reviewer of prepared.reviewers) assert.equal(reviewer.input.fix_back_red, prepared.common.fix_back_red);
});

for (const scenario of ['green', 'setup']) {
  test(`#4128 fix-back RED: ${scenario} subprocess -> no accepted receipt`, (t) => {
    const value = redFixture(t, scenario);

    const result = value.run();

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
  });
}

for (const defect of ['missing', 'bytes', 'head', 'contract', 'previous', 'partial', 'stdout',
  'patch', 'failure', 'argv', 'producer', 'exit', 'signal', 'duration', 'extra']) {
  test(`#4128 fix-back preparation: ${defect} receipt -> non-fixable preparation block`, (t) => {
    const value = redFixture(t);
    const receipt = value.attach();
    if (defect === 'missing') delete value.input.fix_back_red;
    if (defect === 'bytes') value.input.fix_back_red.bytes += 1;
    if (defect === 'head') receipt.head_sha = value.head;
    if (defect === 'contract') receipt.contract_sha256 = '0'.repeat(64);
    if (defect === 'previous') receipt.previous_head_sha = value.base;
    if (defect === 'partial') receipt.complete = false;
    if (defect === 'stdout') writeFileSync(join(value.capture.artifact_root, receipt.stdout.path), 'tampered');
    if (defect === 'patch') receipt.regression_patch = receipt.stderr;
    if (defect === 'failure') receipt.failure.test = 'other test';
    if (defect === 'argv') receipt.argv = [process.execPath, '--version'];
    if (defect === 'producer') receipt.producer = 'child';
    if (defect === 'exit') receipt.exit_code = 0;
    if (defect === 'signal') receipt.signal = 'SIGTERM';
    if (defect === 'duration') receipt.duration_ms = -1;
    if (defect === 'extra') receipt.extra = true;
    if (!['missing', 'bytes', 'stdout'].includes(defect)) {
      value.input.fix_back_red = value.store('red/receipt.json', receipt);
    }

    assert.throws(() => prepareReviewInput(value.input),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false);
  });
}

for (const defect of ['product-patch', 'wrong-test', 'wrong-head', 'spawn', 'ancestry']) {
  test(`#4128 RED capture: ${defect} -> rejected before reviewer dispatch`, (t) => {
    const value = redFixture(t);
    if (defect === 'product-patch') {
      const patch = value.store('product.patch', execFileSync('git', ['diff', '--binary', '--full-index',
        value.head, value.input.head_sha, '--', 'source.mjs'], { cwd: value.root, encoding: 'utf8' }));
      value.capture.regression_patch = { ...patch, path: `evidence/${patch.path}` };
    }
    if (defect === 'wrong-test') value.capture.failure.test = 'unrelated failure';
    if (defect === 'wrong-head') value.capture.implementation.head_sha = value.base;
    if (defect === 'spawn') value.capture.argv[0] = `/nonexistent/${process.execPath.split('/').at(-1)}`;
    if (defect === 'ancestry') value.capture.implementation.previous_head_sha = '0'.repeat(40);

    const result = value.run();

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  });
}

test('#4128 review preparation: missing implementation -> rejected; ordinary and conflict modes need no RED', (t) => {
  const value = fixture(t);
  const { implementation, ...missing } = value.input;
  assert.throws(() => prepareReviewInput(missing), (error) => error.kind === 'input-preparation');
  for (const mode of ['implement', 'resolve-conflict']) {
    assert.equal(prepareReviewInput({ ...value.input, implementation: { ...implementation, mode } }).status, 'prepared');
  }
});

function fixture(t) {
  const directory = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir();
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(join(directory, 'fluo-workflow-preparation-'));
  if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, '.omo'));
  writeFileSync(join(root, '.gitignore'), '.omo/\n');
  writeFileSync(join(root, '.omo/omo.jsonc'),
    readFileSync(new URL('../../../../.omo/omo.jsonc', import.meta.url)));
  git(root, 'config', 'user.name', 'Preparation Test');
  git(root, 'config', 'user.email', 'preparation@example.invalid');
  writeFileSync(join(root, 'source.mjs'), 'export const value = 1;\n');
  git(root, 'add', 'source.mjs');
  git(root, 'commit', '-qm', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  const footprintInput = { version: 1, issue: 42, issue_sha256: 'c'.repeat(64), base_sha: base,
    categories: Object.fromEntries(sourceFootprintCategories.map((name) => [name, {
      affected: name === 'direct_callers', reason: `${name}: fixture source has no other integration`,
      sources: [{ path: 'source.mjs', sha256: hash(readFileSync(join(root, 'source.mjs'))) }],
      searches: [`Inspect source.mjs for ${name}`],
    }])) };
  const footprint = prepareSourceFootprint(root, footprintInput);
  const contract = createPreflight({ issue: 42, issue_sha256: 'c'.repeat(64), base_sha: base,
    scope: ['source.mjs'], non_scope: [], predicted_files: ['source.mjs'],
    acceptance: ['Keep executable value behavior'], validation: ['node focused check'] });
  git(root, 'checkout', '-qb', 'issue-42');
  // An upstream commit incorporated by merge must not enter the authored diff.
  git(root, 'checkout', '-q', 'main');
  writeFileSync(join(root, 'upstream.txt'), 'upstream\n');
  git(root, 'add', 'upstream.txt');
  git(root, 'commit', '-qm', 'upstream');
  const baseHead = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', baseHead);
  git(root, 'checkout', '-q', 'issue-42');
  writeFileSync(join(root, 'source.mjs'), 'export const value = 2;\n');
  git(root, 'add', 'source.mjs');
  git(root, 'commit', '-qm', 'implementation');
  git(root, 'merge', '--no-edit', '-q', 'main');
  const head = git(root, 'rev-parse', 'HEAD');
  const tree = git(root, 'rev-parse', 'HEAD^{tree}');
  const checkout = join(root, 'review');
  git(root, 'worktree', 'add', '--quiet', '--detach', checkout, head);
  const artifactRoot = join(root, 'evidence');
  mkdirSync(artifactRoot);
  const store = (path, value) => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    writeFileSync(join(artifactRoot, path), bytes);
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  };
  const diff = store('authored.diff', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', baseHead, head], { cwd: root, encoding: 'utf8' }));
  const stdout = store('focused.stdout', 'actual focused check passed\n');
  const stderr = store('focused.stderr', '');
  const receipt = { version: 1, complete: true, command: 'node focused check',
    head_sha: head, tree_sha: tree, contract_sha256: contract.sha256,
    status: 'passed', exit_code: 0, signal: null, duration_ms: 1, stdout, stderr };
  const policy = evaluatePreflight(contract, {
    issue: 42, issueSha256: contract.issue_sha256, baseSha: base, changedFiles: ['source.mjs'],
  }).policy;
  const acceptedPath = join(artifactRoot, 'accepted.json');
  writeFileSync(acceptedPath, JSON.stringify(contract));
  const observation = store('plan.json', { issue: 42, decision: { action: 'review' }, obs: {
    preflight: contract, preflightPolicy: policy, issueSha256: contract.issue_sha256,
    headSha: head, baseSha: base, changedFiles: ['source.mjs'],
  } });
  const input = { version: 1, stage: 'review', root, checkout, issue: 42,
    issue_sha256: contract.issue_sha256, contract, policy, base_ref: 'origin/main',
    accepted_contract_path: acceptedPath, observation,
    base_head_sha: baseHead, head_sha: head, artifact_root: artifactRoot,
    implementation: { mode: 'implement', previous_head_sha: base, head_sha: head, contract_sha256: contract.sha256 },
    diff, changed_paths: ['source.mjs'], required_checks: ['node focused check'],
    evidence: [{ command: 'node focused check', receipt: store('focused.json', receipt) }], footprint };
  return { root, input, store, receipt, footprintInput, base, baseHead, head, tree };
}

function callerFootprint(value) {
  const symbol = 'value';
  const command = `git grep -n -w -F -e ${symbol} ${value.base} --`;
  return { ...value.footprintInput, caller_searches: [{ symbol, command,
    matches: [{ path: 'source.mjs', line: 1, text: 'export const value = 1;' }] }] };
}

function cli(value, stage, input) {
  const path = join(value.input.artifact_root, `${stage}-input.json`);
  writeFileSync(path, JSON.stringify(input));
  return spawnSync(process.execPath, [modulePath, stage, path], {
    encoding: 'utf8', env: { ...process.env, ...value.env },
  });
}

function finalization(value) {
  const { sha256, ...contract_input } = value.input.contract;
  contract_input.validation_requirements = [{ validation: 'node focused check', kind: 'local',
    command: 'node focused check', prerequisites: { tools: [], artifacts: [] } }];
  return { version: 1, stage: 'finalize-preflight', root: value.root,
    footprint: { ...callerFootprint(value), sha256: '' }, contract_input };
}

test('#4129 preflight CLI: complete repository caller search -> authenticated dispatch and digest', (t) => {
  const value = fixture(t);
  const input = { version: 1, stage: 'preflight', root: value.root, footprint: callerFootprint(value) };

  const result = cli(value, 'preflight', input);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).footprint.caller_searches, input.footprint.caller_searches);
  assert.notEqual(JSON.parse(result.stdout).footprint.sha256, value.input.footprint.sha256);
});

for (const [name, mutate] of [
  ['missing', (f) => { delete f.caller_searches; }],
  ['empty', (f) => { f.caller_searches = []; }],
  ['duplicate', (f) => { f.caller_searches.push(structuredClone(f.caller_searches[0])); }],
  ['omitted-match', (f) => { f.caller_searches[0].matches = []; }],
  ['wrong-line', (f) => { f.caller_searches[0].matches[0].line = 2; }],
  ['wrong-text', (f) => { f.caller_searches[0].matches[0].text = 'other'; }],
  ['restricted-search', (f) => { f.caller_searches[0].command += ' source.mjs'; }],
  ['shell-injection', (f) => { f.caller_searches[0].command += '; touch injected'; }],
]) {
  test(`#4129 preflight CLI: ${name} caller search -> typed block without dispatch`, (t) => {
    const value = fixture(t);
    const footprint = callerFootprint(value);
    mutate(footprint);

    const result = cli(value, 'preflight', { version: 1, stage: 'preflight', root: value.root, footprint });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
    assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  });
}

test('#4129 caller authentication: tooling callers and exit-one empty results -> complete pinned-base inventory', (t) => {
  const value = fixture(t);
  git(value.root, 'checkout', '-q', 'main');
  for (const path of ['tooling/ci/caller.mjs', 'tooling/governance/fixtures/caller.mjs']) {
    mkdirSync(join(value.root, path, '..'), { recursive: true });
    writeFileSync(join(value.root, path), 'value();\n');
    git(value.root, 'add', path);
  }
  git(value.root, 'commit', '-qm', 'tooling callers');
  const base = git(value.root, 'rev-parse', 'HEAD');
  const footprint = callerFootprint(value);
  footprint.base_sha = base;
  footprint.caller_searches[0].command = `git grep -n -w -F -e value ${base} --`;
  footprint.caller_searches[0].matches.push(
    { path: 'tooling/ci/caller.mjs', line: 1, text: 'value();' },
    { path: 'tooling/governance/fixtures/caller.mjs', line: 1, text: 'value();' });
  footprint.caller_searches.push({ symbol: 'absentSymbol', command: `git grep -n -w -F -e absentSymbol ${base} --`, matches: [] });

  const result = cli(value, 'preflight', { version: 1, stage: 'preflight', root: value.root, footprint });

  assert.equal(result.status, 0, result.stderr);
  footprint.caller_searches[0].matches.pop();
  assert.equal(cli(value, 'preflight', { version: 1, stage: 'preflight', root: value.root, footprint }).status, 1);
});

test('#4129 caller authentication: quoted and colon-bearing paths -> exact repository paths and line text', (t) => {
  const value = fixture(t);
  git(value.root, 'checkout', '-q', 'main');
  const path = 'docs/\uD55C\uAE00:12:guide.md';
  mkdirSync(join(value.root, 'docs'));
  writeFileSync(join(value.root, path), 'value:34:remaining text\n');
  git(value.root, 'add', path);
  git(value.root, 'commit', '-qm', 'caller path');
  const footprint = callerFootprint(value);
  footprint.base_sha = git(value.root, 'rev-parse', 'HEAD');
  footprint.caller_searches[0].command = `git grep -n -w -F -e value ${footprint.base_sha} --`;
  footprint.caller_searches[0].matches.unshift({ path, line: 1, text: 'value:34:remaining text' });

  const result = cli(value, 'preflight', { version: 1, stage: 'preflight', root: value.root, footprint });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).footprint.caller_searches, footprint.caller_searches);
});

test('#4129 finalization CLI: digest-free contract input -> authenticated accepted artifact without writes', (t) => {
  const value = fixture(t);
  const input = finalization(value);
  const prepared = cli(value, 'preflight', { version: 1, stage: 'preflight', root: value.root, footprint: callerFootprint(value) });
  assert.equal(prepared.status, 0, prepared.stderr);
  input.footprint = JSON.parse(prepared.stdout).footprint;
  const before = git(value.root, 'status', '--porcelain=v1');

  const result = cli(value, 'finalize-preflight', input);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, 'preflight-contract');
  assert.deepEqual(output.contract, createPreflight(input.contract_input));
  assert.equal(git(value.root, 'status', '--porcelain=v1'), before);
});

for (const [name, mutate] of [
  ['issue', (i) => { i.contract_input.issue += 1; }],
  ['issue-digest', (i) => { i.contract_input.issue_sha256 = '0'.repeat(64); }],
  ['base', (i) => { i.contract_input.base_sha = '0'.repeat(40); }],
  ['digest', (i) => { i.contract_input.sha256 = '0'.repeat(64); }],
  ['dispatch', (i) => { i.contract_input.dispatch = {}; }],
  ['requirements', (i) => { delete i.contract_input.validation_requirements; }],
  ['legacy-footprint', (i) => { delete i.footprint.caller_searches; }],
]) {
  test(`#4129 finalization CLI: ${name} mismatch -> nonzero preparation block`, (t) => {
    const value = fixture(t);
    const input = finalization(value);
    input.footprint = prepareSourceFootprint(value.root, callerFootprint(value));
    mutate(input);

    const result = cli(value, 'finalize-preflight', input);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
  });
}

function implementation(t, legacy = false) {
  const value = fixture(t);
  git(value.root, 'checkout', '-q', 'main');
  const worktree = join(value.root, '.worktrees/issue-42');
  git(value.root, 'worktree', 'add', '--quiet', worktree, 'issue-42');
  writeFileSync(join(worktree, '.gitignore'), 'node_modules\n');
  mkdirSync(join(worktree, 'packages/core/dist'), { recursive: true });
  writeFileSync(join(worktree, 'packages/core/dist/index.js'), 'export {};\n');
  git(worktree, 'add', '.gitignore', 'packages/core/dist/index.js');
  git(worktree, 'commit', '-qm', 'dependency prerequisites');
  mkdirSync(join(worktree, 'node_modules'));
  const toolDir = join(value.input.artifact_root, 'tools');
  mkdirSync(toolDir);
  writeFileSync(join(toolDir, 'fixture-tool'), '#!/bin/sh\nexit 99\n');
  chmodSync(join(toolDir, 'fixture-tool'), 0o755);
  const contract = createPreflight({ ...value.input.contract, ...(legacy ? {} : {
    validation_requirements: [{ validation: 'node focused check', kind: 'local',
      command: 'fixture-tool source.mjs', prerequisites: {
        tools: [{ name: 'fixture-tool', path_dirs: [toolDir] }],
        artifacts: [{ path: 'source.mjs', kind: 'file' }, { path: 'node_modules', kind: 'directory' },
          { path: 'packages/core/dist/index.js', kind: 'file' }] } }],
  }) });
  writeFileSync(value.input.accepted_contract_path, JSON.stringify(contract));
  const input = { version: 1, lane_id: 'fixture', issue_number: 42, issue_url: 'https://example.test/42',
    issue_title: 'Fixture', base_branch: 'main', branch: 'issue-42', worktree: '.worktrees/issue-42',
    starting_head_sha: git(worktree, 'rev-parse', 'HEAD'), preflight_sha256: contract.sha256,
    mode: 'implement', existing_pr: null, blockers: [], fix_back_attempt: null };
  return { ...value, worktree, toolDir, wrapper: { version: 1, stage: 'implement', root: value.root,
    accepted_contract_path: value.input.accepted_contract_path, contract, input } };
}

function completion(t, mode = 'implement') {
  const value = implementation(t);
  const input = value.wrapper.input;
  input.mode = mode;
  if (mode === 'fix-back') {
    input.fix_back_attempt = 1;
    input.blockers = [{ reviewer: 'code', signature: 'fixture', evidence: 'source.mjs:1',
      fix_back_eligible: true, status: 'unresolved' }];
    input.existing_pr = { number: 42, url: 'https://example.test/pr/42', head_branch: input.branch };
  }
  const commitChange = () => {
    writeFileSync(join(value.worktree, 'source.mjs'), 'export const value = 3;\n');
    git(value.worktree, 'add', 'source.mjs');
    git(value.worktree, 'commit', '-qm', 'complete implementation');
    const head = git(value.worktree, 'rev-parse', 'HEAD');
    return { version: 1, result: 'completed', mode, lane_id: input.lane_id, issue_number: input.issue_number,
      branch: input.branch, worktree: input.worktree, pr: input.existing_pr,
      preflight_sha256: input.preflight_sha256, previous_head_sha: input.starting_head_sha,
      head_sha: head, commit_sha: head, changed_files: ['source.mjs'],
      verification: [{ command: 'node focused check', status: 'passed' }],
      fix_back_result: mode === 'implement' ? 'not-applicable' : 'remediated',
      addressed_blockers: input.blockers.map((blocker) => ({ ...blocker, status: 'remediated' })),
      remaining_blockers: [] };
  };
  const wrapper = { ...value.wrapper, stage: 'implement-result', result: null };
  return { ...value, wrapper, commitChange };
}

// IPC readiness and close are the synchronization, never elapsed time.
async function runningCommand(t, cwd) {
  const worker = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "process.send('ready'); process.on('message', () => process.disconnect());"],
      { cwd: require('node:os').tmpdir(), stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    child.once('message', () => process.send({ descendant: child.pid }));
    process.once('message', () => {
      child.once('close', () => process.disconnect());
      child.send('stop');
    });
  `;
  const child = spawn(process.execPath, ['-e', worker], { cwd, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const closed = once(child, 'close', { signal: AbortSignal.timeout(15000) });
  const stop = async () => {
    if (child.connected) child.send('stop');
    await closed;
  };
  t.after(stop);
  const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(15000) });
  return { pid: child.pid, descendant: ready.descendant, stop };
}

test('#4139 completion CLI: missing result with running command and staged change -> all incomplete evidence', async (t) => {
  const value = completion(t);
  const command = await runningCommand(t, value.worktree);
  writeFileSync(join(value.worktree, 'source.mjs'), 'staged\n');
  git(value.worktree, 'add', 'source.mjs');

  const result = cli(value, 'implement-result', value.wrapper);

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  const output = JSON.parse(result.stderr);
  assert.equal(output.kind, 'incomplete-run');
  assert.deepEqual(output.reasons, ['missing-result', 'running-processes', 'unchanged-head', 'dirty-worktree']);
  assert.equal(output.lane_id, value.wrapper.input.lane_id);
  assert.equal(output.issue_number, 42);
  assert.equal(output.preflight_sha256, value.wrapper.contract.sha256);
  assert.equal(output.starting_head_sha, value.wrapper.input.starting_head_sha);
  assert.equal(output.current_head_sha, output.starting_head_sha);
  assert.equal(output.branch, 'issue-42');
  assert.equal(output.worktree, realpathSync(value.worktree));
  assert.deepEqual(output.changes, { staged: ['source.mjs'], unstaged: [], untracked: [] });
  assert.deepEqual(output.result, { present: false, valid: false, error: null });
  const parent = output.processes.find((entry) => entry.pid === command.pid);
  const descendant = output.processes.find((entry) => entry.pid === command.descendant);
  assert.equal(parent.attribution.kind, 'cwd');
  assert.equal(parent.attribution.path, realpathSync(value.worktree));
  assert.equal(descendant.ppid, command.pid);
  assert.deepEqual(descendant.attribution, { kind: 'descendant', ancestor_pid: command.pid });
  assert.equal(typeof descendant.command, 'string');
});

test('#4139 completion API: clean new commit without result -> incomplete rather than inferred completion', (t) => {
  const value = completion(t);
  const result = value.commitChange();

  const output = preparation.prepareImplementResult(value.wrapper);

  assert.equal(output.kind, 'incomplete-run');
  assert.deepEqual(output.reasons, ['missing-result']);
  assert.equal(output.current_head_sha, result.head_sha);
  assert.deepEqual(output.processes, []);
});

for (const mode of ['implement', 'fix-back']) {
  test(`#4139 completion API/CLI: ${mode} result with live command -> accepts same assignment only after close`, async (t) => {
    const value = completion(t, mode);
    value.wrapper.result = value.commitChange();
    const sibling = `${value.worktree}-sibling`;
    git(value.root, 'worktree', 'add', '--quiet', '--detach', sibling, value.wrapper.result.head_sha);
    await runningCommand(t, sibling);
    const command = await runningCommand(t, value.worktree);
    const before = git(value.worktree, 'rev-parse', 'HEAD');

    const blocked = preparation.prepareImplementResult(value.wrapper);
    assert.equal(blocked.kind, 'incomplete-run');
    assert.deepEqual(blocked.reasons, ['running-processes']);
    assert.deepEqual(blocked.processes.map((entry) => entry.pid).sort((a, b) => a - b),
      [command.pid, command.descendant].sort((a, b) => a - b));
    await command.stop();
    const accepted = preparation.prepareImplementResult(value.wrapper);
    const result = cli(value, 'implement-result', value.wrapper);

    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.kind, 'implement-result');
    assert.strictEqual(accepted.result, value.wrapper.result);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).result, value.wrapper.result);
    assert.equal(git(value.worktree, 'rev-parse', 'HEAD'), before);
    assert.equal(git(value.worktree, 'status', '--porcelain=v1'), '');
  });
}

test('#4139 completion API: valid result with staged unstaged and untracked paths -> preserves all dirty evidence', (t) => {
  const value = completion(t);
  value.wrapper.result = value.commitChange();
  writeFileSync(join(value.worktree, 'source.mjs'), 'staged\n');
  git(value.worktree, 'add', 'source.mjs');
  writeFileSync(join(value.worktree, 'source.mjs'), 'unstaged\n');
  writeFileSync(join(value.worktree, 'untracked file.txt'), 'untracked\n');

  const output = preparation.prepareImplementResult(value.wrapper);

  assert.equal(output.kind, 'incomplete-run');
  assert.deepEqual(output.reasons, ['dirty-worktree']);
  assert.deepEqual(output.changes, { staged: ['source.mjs'], unstaged: ['source.mjs'], untracked: ['untracked file.txt'] });
  assert.deepEqual(output.result, { present: true, valid: true, error: null });
});

test('#4139 completion API/CLI: malformed result -> incomplete retains validator diagnostic', (t) => {
  const value = completion(t);
  value.wrapper.result = { ...value.commitChange(), extra: true };

  const output = preparation.prepareImplementResult(value.wrapper);
  const result = cli(value, 'implement-result', value.wrapper);

  assert.equal(output.kind, 'incomplete-run');
  assert.deepEqual(output.reasons, ['invalid-result']);
  assert.equal(output.result.present, true);
  assert.equal(output.result.valid, false);
  assert.match(output.result.error, /unknown key extra/u);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).kind, 'incomplete-run');
});

for (const [name, mutate] of [
  ['head', (v) => { v.wrapper.result.head_sha = v.base; v.wrapper.result.commit_sha = v.base; }],
  ['changed-files', (v) => { v.wrapper.result.changed_files = ['fabricated.mjs']; }],
  ['duplicate-files', (v) => { v.wrapper.result.changed_files.push('source.mjs'); }],
  ['branch', (v) => git(v.worktree, 'checkout', '--detach', '-q')],
  ['accepted-contract', (v) => writeFileSync(v.wrapper.accepted_contract_path, '{}')],
  ['binding', (v) => { v.wrapper.input.preflight_sha256 = '0'.repeat(64); }],
  ['result-binding', (v) => { v.wrapper.result.lane_id = 'another-lane'; }],
  ['wrong-repository', (v) => {
    git(v.root, 'worktree', 'remove', '--force', v.worktree);
    mkdirSync(v.worktree);
    git(v.worktree, 'init', '-q', '-b', 'issue-42');
  }],
  ['worktree-symlink', (v) => {
    const moved = `${v.worktree}-moved`;
    git(v.root, 'worktree', 'move', v.worktree, moved);
    symlinkSync(moved, v.worktree);
  }],
  ['scope', (v) => {
    writeFileSync(join(v.worktree, 'outside.mjs'), 'outside\n');
    git(v.worktree, 'add', 'outside.mjs');
    git(v.worktree, 'commit', '-qm', 'outside scope');
    v.wrapper.result.head_sha = git(v.worktree, 'rev-parse', 'HEAD');
    v.wrapper.result.commit_sha = v.wrapper.result.head_sha;
    v.wrapper.result.changed_files = ['outside.mjs', 'source.mjs'];
  }],
  ['history', (v) => {
    git(v.worktree, 'checkout', '--orphan', 'unrelated', '-q');
    git(v.worktree, 'commit', '-qam', 'rewritten root');
    git(v.worktree, 'branch', '-f', 'issue-42');
    git(v.worktree, 'checkout', 'issue-42', '-q');
    v.wrapper.result.head_sha = git(v.worktree, 'rev-parse', 'HEAD');
    v.wrapper.result.commit_sha = v.wrapper.result.head_sha;
  }],
  ['wrapper', (v) => { v.wrapper.extra = true; }],
]) {
  test(`#4139 completion API/CLI: ${name} drift -> non-fixable input-preparation block`, (t) => {
    const value = completion(t);
    value.wrapper.result = value.commitChange();
    mutate(value);

    assert.throws(() => preparation.prepareImplementResult(value.wrapper),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false);
    const result = cli(value, 'implement-result', value.wrapper);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
    assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  });
}

for (const observer of ['ps', ...(process.platform === 'darwin' ? ['lsof'] : [])]) {
  test(`#4139 completion CLI: ${observer} observer fails -> input block never empty process success`, (t) => {
    const value = completion(t);
    value.wrapper.result = value.commitChange();
    writeFileSync(join(value.toolDir, observer), '#!/bin/sh\nexit 71\n');
    chmodSync(join(value.toolDir, observer), 0o755);
    value.env = { PATH: `${value.toolDir}:${process.env.PATH}` };

    const result = cli(value, 'implement-result', value.wrapper);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    const output = JSON.parse(result.stderr);
    assert.equal(output.kind, 'input-preparation');
    assert.equal(output.fix_back_eligible, false);
    assert.match(output.error, /process observation/u);
  });
}

test('#4139 completion CLI: empty observer output -> unavailable observation cannot prove completion', (t) => {
  const value = completion(t);
  value.wrapper.result = value.commitChange();
  const observer = process.platform === 'darwin' ? 'lsof' : 'ps';
  writeFileSync(join(value.toolDir, observer), '#!/bin/sh\nexit 0\n');
  chmodSync(join(value.toolDir, observer), 0o755);
  value.env = { PATH: `${value.toolDir}:${process.env.PATH}` };

  const result = cli(value, 'implement-result', value.wrapper);

  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error, /process observation/u);
});

test('#4139 completion API: new commit with identical tree -> incomplete empty diff', (t) => {
  const value = completion(t);
  git(value.worktree, 'commit', '--allow-empty', '-qm', 'no implementation');

  const output = preparation.prepareImplementResult(value.wrapper);

  assert.equal(output.kind, 'incomplete-run');
  assert.deepEqual(output.reasons, ['missing-result', 'empty-diff']);
});

test('#4129 implement CLI: clean assigned worktree and executable prerequisites -> registered dispatch without execution', (t) => {
  const value = implementation(t);
  const before = git(value.worktree, 'rev-parse', 'HEAD');

  const result = cli(value, 'implement', value.wrapper);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dispatch.subagent_type, 'fluo-issue-implementer');
  assert.deepEqual(output.input, value.wrapper.input);
  assert.deepEqual(output.contract, value.wrapper.contract);
  assert.equal(output.prerequisites.status, 'checked');
  assert.equal(output.prerequisites.local[0].tools[0].path, join(value.toolDir, 'fixture-tool'));
  assert.equal(git(value.worktree, 'rev-parse', 'HEAD'), before);
  assert.equal(git(value.worktree, 'status', '--porcelain=v1'), '');
});

test('#4129 implement CLI: legacy prerequisites and fix-back -> explicit undeclared state with same dispatch', (t) => {
  const value = implementation(t, true);
  value.wrapper.input.mode = 'fix-back';
  value.wrapper.input.fix_back_attempt = 1;
  value.wrapper.input.blockers = [{ reviewer: 'code', signature: 'fixture', evidence: 'source.mjs:1',
    fix_back_eligible: true, status: 'unresolved' }];

  const result = cli(value, 'implement', value.wrapper);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).prerequisites.status, 'undeclared');
  assert.equal(JSON.parse(result.stdout).dispatch.subagent_type, 'fluo-issue-implementer');
});

test('#4129 implement prerequisites: inherited PATH and CI-only requirement -> checked local files and separate remote check', (t) => {
  const value = implementation(t);
  const requirements = structuredClone(value.wrapper.contract.validation_requirements);
  requirements[0].prerequisites.tools[0].path_dirs = [];
  requirements.push({ validation: 'GitHub Verify', kind: 'ci-only', check: 'Verify', reason: 'Remote artifact transport' });
  value.wrapper.contract = createPreflight({ ...value.wrapper.contract,
    validation: ['node focused check', 'GitHub Verify'], validation_requirements: requirements });
  value.wrapper.input.preflight_sha256 = value.wrapper.contract.sha256;
  writeFileSync(value.wrapper.accepted_contract_path, JSON.stringify(value.wrapper.contract));
  value.env = { PATH: `${value.toolDir}:${process.env.PATH}` };

  const result = cli(value, 'implement', value.wrapper);

  assert.equal(result.status, 0, result.stderr);
  const prerequisites = JSON.parse(result.stdout).prerequisites;
  assert.equal(prerequisites.local.length, 1);
  assert.deepEqual(prerequisites.local[0].artifacts.map((a) => a.available), [true, true, true]);
  assert.deepEqual(prerequisites.ci_only, [requirements[1]]);
});

for (const scenario of [
  { name: 'single-quoted PATH argument without assignment', path: () => '', argument: "'PATH='", found: 'declared' },
  { name: 'double-quoted PATH argument without assignment', path: () => '', argument: '"PATH="', found: 'declared' },
  { name: 'quoted PATH argument preserves inherited lookup', path: () => '', argument: "'PATH='", declared: false, found: 'inherited' },
  { name: 'single-quoted PATH argument after leading assignment', path: (d) => `PATH=${d.command}`, argument: "'PATH='", found: 'command' },
  { name: 'double-quoted PATH argument after leading assignment', path: (d) => `PATH=${d.command}`, argument: '"PATH="', found: 'command' },
  { name: 'single-quoted PATH argument after export assignment', path: (d) => `export PATH=${d.command};`, argument: "'PATH='", found: 'command' },
  { name: 'double-quoted PATH argument after export assignment', path: (d) => `export PATH=${d.command};`, argument: '"PATH="', found: 'command' },
  { name: 'literal replacement ignores inherited-only pnpm', path: (d) => `PATH=${d.empty}`, declared: false, found: null },
  { name: 'export replacement ignores inherited and declared directories', path: (d) => `export PATH=${d.empty};`, found: null },
  { name: 'single-quoted replacement ignores inherited and declared directories', path: (d) => `PATH='${d.empty}'`, found: null },
  { name: 'literal command PATH wins over declared directories', path: (d) => `PATH=${d.command}`, found: 'command' },
  { name: 'export command PATH wins over declared directories', path: (d) => `export PATH=${d.command};`, found: 'command' },
  { name: 'single-quoted literal PATH', path: (d) => `PATH='${d.command}'`, found: 'command' },
  { name: 'double-quoted literal PATH with spaces', path: (d) => `PATH="${d.spaces}"`, found: 'spaces' },
  { name: 'appended inherited PATH preserves command directory priority', path: (d) => `PATH=${d.command}:$PATH`, found: 'command' },
  { name: 'prepended inherited PATH preserves inherited directory priority', path: (d) => `PATH=$PATH:${d.command}`, found: 'inherited' },
  { name: 'middle inherited PATH expands at its position', path: (d) => `PATH=${d.empty}:$PATH:${d.command}`, found: 'inherited' },
  { name: 'double-quoted inherited PATH expands', path: (d) => `PATH="${d.empty}:$PATH"`, found: 'inherited' },
  { name: 'export double-quoted inherited PATH expands', path: (d) => `export PATH="${d.empty}:$PATH";`, found: 'inherited' },
  { name: 'single-quoted PATH variable stays literal', path: (d) => `PATH='${d.empty}:$PATH'`, found: null },
  { name: 'empty replacement does not restore inherited PATH', path: () => 'PATH=""', found: null },
  { name: 'relative PATH resolves from assigned worktree', path: () => 'PATH=node_modules/path-tools', found: 'relative' },
  { name: 'non-executable candidate is excluded', path: (d) => `PATH=${d.nonExecutable}`, found: null },
  { name: 'directory candidate is excluded', path: (d) => `PATH=${d.directory}`, found: null },
  { name: 'command substitution is blocked without execution', path: (d) => `PATH=$(/bin/sh -c 'printf ran > "${d.marker}"')`, blocked: true },
  { name: 'backtick substitution is blocked without execution', path: (d) => `PATH=\`printf ran > "${d.marker}"\``, blocked: true },
  { name: 'unsupported variable is blocked', path: () => 'PATH=$HOME/bin:$PATH', blocked: true },
  { name: 'parameter operation is blocked', path: () => 'PATH=${PATH:-/bin}', blocked: true },
  { name: 'tilde expansion is blocked', path: () => 'PATH=~/bin', blocked: true },
  { name: 'glob expansion is blocked', path: (d) => `PATH=${d.empty}/*`, blocked: true },
  { name: 'unterminated quoting is blocked', path: (d) => `PATH="${d.command}`, blocked: true },
  { name: 'wrapped assignment is blocked', path: (d) => `env PATH=${d.command}`, blocked: true },
  { name: 'later assignment is blocked', path: (d) => `printf ready; PATH=${d.command}`, blocked: true },
  { name: 'multiple PATH assignments are blocked', path: (d) => `PATH=${d.command} PATH=${d.empty}`, blocked: true },
  { name: 'quoted argument does not hide later assignment', path: (d) => `printf 'PATH='; PATH=${d.command}`, blocked: true },
  { name: 'quoted argument does not hide wrapped assignment', path: (d) => `env PATH=${d.command}`, argument: "'PATH='", blocked: true },
  { name: 'quoted argument does not hide second assignment', path: (d) => `PATH=${d.command} PATH=${d.empty}`, argument: '"PATH="', blocked: true },
  { name: 'quoted argument does not hide unset PATH', path: (d) => `PATH=${d.command}`, argument: "'PATH='; unset PATH", blocked: true },
  { name: 'single-quoted env assignment is blocked', path: (d) => `/usr/bin/env 'PATH=${d.empty}'`, blocked: true },
  { name: 'double-quoted env assignment is blocked', path: (d) => `/usr/bin/env "PATH=${d.empty}"`, blocked: true },
  { name: 'single-quoted export assignment is blocked', path: (d) => `export 'PATH=${d.empty}';`, blocked: true },
  { name: 'double-quoted export assignment is blocked', path: (d) => `export "PATH=${d.empty}";`, blocked: true },
  { name: 'env split-quoted assignment name is blocked', path: (d) => `env PA'TH'=${d.empty}`, blocked: true },
  { name: 'export split-quoted assignment name is blocked', path: (d) => `export "PA"TH=${d.empty};`, blocked: true },
  { name: 'env quoted assignment equals is blocked', path: (d) => `env PATH"=${d.empty}"`, blocked: true },
  { name: 'export quoted assignment equals is blocked', path: (d) => `export PATH'=${d.empty}';`, blocked: true },
  { name: 'later quoted env assignment is blocked', path: (d) => `printf ready && env 'PATH=${d.empty}'`, blocked: true },
  { name: 'later quoted export assignment is blocked', path: (d) => `printf ready; export "PATH=${d.empty}";`, blocked: true },
  { name: 'piped quoted env assignment is blocked', path: (d) => `printf ready | env 'PATH=${d.empty}'`, blocked: true },
  { name: 'command wrapper retains quoted env assignment', path: (d) => `command /usr/bin/env 'PATH=${d.empty}'`, blocked: true },
  { name: 'exec wrapper retains quoted env assignment', path: (d) => `exec env "PATH=${d.empty}"`, blocked: true },
  { name: 'env wrapper retains quoted export assignment', path: (d) => `env OTHER=value sh -c 'export "PATH=${d.empty}"; pnpm test' --`, blocked: true },
  { name: 'leading PATH does not hide quoted env assignment', path: (d) => `PATH=${d.command} env 'PATH=${d.empty}'`, blocked: true },
  { name: 'leading PATH does not hide quoted export assignment', path: (d) => `PATH=${d.command} command export "PATH=${d.empty}";`, blocked: true },
  { name: 'env command keeps ordinary quoted argument', path: () => 'env', argument: "'PATH='", found: 'declared' },
  { name: 'command wrapper keeps ordinary quoted argument', path: () => 'command', argument: '"PATH="', found: 'declared' },
  { name: 'later command keeps ordinary quoted argument', path: () => 'printf ready &&', argument: "'PATH='", found: 'declared' },
  { name: 'ordinary export text is not a command', path: () => 'printf export', argument: "'PATH='", found: 'declared' },
  { name: 'ordinary env text is not a command', path: () => 'printf env', argument: '"PATH="', found: 'declared' },
  { name: 'grouped quoted export assignment is blocked', path: (d) => `{ export 'PATH=${d.empty}';`, argument: 'test; }', blocked: true },
  { name: 'subshell quoted env assignment is blocked', path: (d) => `( env "PATH=${d.empty}"`, argument: 'test )', blocked: true },
  { name: 'newline quoted export assignment is blocked', path: (d) => `printf ready\nexport 'PATH=${d.empty}';`, blocked: true },
  { name: 'split-quoted env command retains assignment operands', path: (d) => `/usr/bin/e'n'v 'PATH=${d.empty}'`, blocked: true },
]) {
  test(`#4150 implement command PATH: ${scenario.name} -> ${scenario.blocked ? 'typed block' : scenario.found ? 'resolved executable' : 'missing pnpm'}`, (t) => {
    const value = implementation(t);
    const directories = Object.fromEntries(['empty', 'command', 'inherited', 'spaces', 'nonExecutable', 'directory']
      .map((name) => [name, join(value.input.artifact_root, name === 'spaces' ? 'command tools' : name)]));
    directories.relative = join(realpathSync(value.worktree), 'node_modules/path-tools');
    directories.marker = join(value.input.artifact_root, 'executed');
    for (const [name, directory] of Object.entries(directories)) {
      if (name === 'marker') continue;
      mkdirSync(directory, { recursive: true });
      if (name === 'empty') continue;
      if (name === 'directory') {
        mkdirSync(join(directory, 'pnpm'));
        continue;
      }
      writeFileSync(join(directory, 'pnpm'), `#!/bin/sh\nprintf ran > "${directories.marker}"\nexit 99\n`);
      chmodSync(join(directory, 'pnpm'), name === 'nonExecutable' ? 0o644 : 0o755);
    }
    writeFileSync(join(value.toolDir, 'pnpm'), `#!/bin/sh\nprintf ran > "${directories.marker}"\nexit 99\n`);
    chmodSync(join(value.toolDir, 'pnpm'), 0o755);
    directories.declared = value.toolDir;
    const prefix = scenario.path(directories);
    const command = `${prefix} pnpm ${scenario.argument ?? 'test'}`
      + (prefix.startsWith('PATH=') ? '' : `; /bin/sh -c 'printf ran > "${directories.marker}"'`);
    const requirements = structuredClone(value.wrapper.contract.validation_requirements);
    requirements[0].command = command;
    requirements[0].prerequisites.tools = [{ name: 'pnpm', path_dirs: scenario.declared === false ? [] : [value.toolDir] }];
    value.wrapper.contract = createPreflight({ ...value.wrapper.contract, validation_requirements: requirements });
    value.wrapper.input.preflight_sha256 = value.wrapper.contract.sha256;
    writeFileSync(value.wrapper.accepted_contract_path, JSON.stringify(value.wrapper.contract));
    value.env = { PATH: `${directories.inherited}:${process.env.PATH}` };

    const result = cli(value, 'implement', value.wrapper);

    assert.equal(existsSync(directories.marker), false, 'preparation must execute neither command nor tool');
    assert.equal(result.status, scenario.found ? 0 : 1, result.stderr || result.stdout);
    if (scenario.found) {
      assert.equal(JSON.parse(result.stdout).prerequisites.local[0].tools[0].path,
        join(directories[scenario.found], 'pnpm'));
    } else {
      assert.equal(result.stdout, '');
      const output = JSON.parse(result.stderr);
      assert.equal(output.kind, 'input-preparation');
      assert.equal(output.fix_back_eligible, false);
      if (scenario.blocked) {
        assert.match(output.error, /unsupported command PATH/u);
        assert.ok(output.error.includes(command));
      } else {
        const missing = JSON.parse(output.error.slice(output.error.indexOf('[{')));
        assert.deepEqual(missing, [{ command, tool: 'pnpm' }]);
      }
    }
  });
}

function commandPathFixture(t, buildCommand) {
  const value = implementation(t);
  const marker = join(value.input.artifact_root, 'executed');
  for (const name of ['pnpm', 'node']) {
    writeFileSync(join(value.toolDir, name), `#!/bin/sh\nprintf ran > "${marker}"\nexit 99\n`);
    chmodSync(join(value.toolDir, name), 0o755);
  }
  const command = buildCommand(value.toolDir, marker);
  const requirements = structuredClone(value.wrapper.contract.validation_requirements);
  requirements[0].command = command;
  requirements[0].prerequisites.tools = ['pnpm', 'node'].map((name) => ({ name, path_dirs: [value.toolDir] }));
  value.wrapper.contract = createPreflight({ ...value.wrapper.contract, validation_requirements: requirements });
  value.wrapper.input.preflight_sha256 = value.wrapper.contract.sha256;
  writeFileSync(value.wrapper.accepted_contract_path, JSON.stringify(value.wrapper.contract));
  return { ...value, command, marker };
}

function assertUnsupportedCommandPath(value) {
  const result = cli(value, 'implement', value.wrapper);

  assert.equal(existsSync(value.marker), false, 'preparation must execute neither command nor tool');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout, '');
  const output = JSON.parse(result.stderr);
  assert.equal(output.kind, 'input-preparation');
  assert.equal(output.fix_back_eligible, false);
  assert.match(output.error, /unsupported command PATH/u);
  assert.ok(output.error.includes(value.command));
}

test('#4150 PATH lifetime: non-export compound commands -> typed nonexecuting block', (t) => {
  for (const operator of ['&&', '||', ';', '|', '&', '\n']) {
    const value = commandPathFixture(t, (directory, marker) =>
      `PATH=${directory} pnpm --version ${operator} node check.mjs; /bin/sh -c 'printf ran > "${marker}"'`);

    assertUnsupportedCommandPath(value);
  }
});

test('#4150 env resets: wrapped PATH removal -> typed nonexecuting block', (t) => {
  for (const options of ['-u PATH', '--unset=PATH', '-i', '--unset PATH', '-uPATH', '--ignore-environment', '-']) {
    const value = commandPathFixture(t, (_directory, marker) =>
      `/usr/bin/env ${options} pnpm test; /bin/sh -c 'printf ran > "${marker}"'`);

    assertUnsupportedCommandPath(value);
  }
});

test('#4150 PATH lifetime: export compound and quoted operators -> resolved nonexecuting controls', (t) => {
  for (const buildCommand of [
    (directory, marker) => `export PATH=${directory}; pnpm --version && node check.mjs; /bin/sh -c 'printf ran > "${marker}"'`,
    (directory) => `PATH=${directory} pnpm '&&' "||" ';' '|' '&' '(' ')' '{' '}'`,
    () => `env -u OTHER pnpm 'PATH=' '--unset=PATH' '-i'`,
    () => `pnpm 'env -u PATH' '--unset=PATH' '-i'`,
    () => `env -vuindirect pnpm '-vi' 'PATH='`,
    () => `env -vui pnpm '-i'`,
    () => `env --unset=OTHER pnpm '--chdir' '/tmp' '-i'`,
    () => `env --unset OTHER pnpm '--split-string' '-vi'`,
  ]) {
    const value = commandPathFixture(t, buildCommand);

    const result = cli(value, 'implement', value.wrapper);

    assert.equal(existsSync(value.marker), false, 'preparation must execute neither command nor tool');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).prerequisites.local[0].tools.map((tool) => tool.path),
      ['pnpm', 'node'].map((name) => join(value.toolDir, name)));
  }
});

test('#4150 env option clusters: ignore-environment flags -> typed nonexecuting block', (t) => {
  for (const options of ['-vi', '-iv', '-vvvi', '-v0i', '-viu OTHER', '-vu PATH']) {
    const value = commandPathFixture(t, (_directory, marker) =>
      `/usr/bin/env ${options} pnpm test; /bin/sh -c 'printf ran > "${marker}"'`);

    assertUnsupportedCommandPath(value);
  }
});

test('#4150 env unknown options: operand cannot hide reset -> typed nonexecuting block', (t) => {
  for (const options of ['--chdir /tmp -i', '--chdir=/tmp -i', "--split-string 'OTHER=1' -i", '--chdir /tmp']) {
    const value = commandPathFixture(t, (_directory, marker) =>
      `/usr/bin/env ${options} pnpm test; /bin/sh -c 'printf ran > "${marker}"'`);

    assertUnsupportedCommandPath(value);
  }
});

test('#4129 implement prerequisites: missing tools and build artifacts -> every missing item names its command', (t) => {
  const value = implementation(t);
  rmSync(join(value.toolDir, 'fixture-tool'));
  rmSync(join(value.worktree, 'node_modules'), { recursive: true });
  const requirements = structuredClone(value.wrapper.contract.validation_requirements);
  requirements[0].prerequisites.artifacts[2].path = 'packages/core/dist/missing.js';
  value.wrapper.contract = createPreflight({ ...value.wrapper.contract, validation_requirements: requirements });
  value.wrapper.input.preflight_sha256 = value.wrapper.contract.sha256;
  writeFileSync(value.wrapper.accepted_contract_path, JSON.stringify(value.wrapper.contract));

  const result = cli(value, 'implement', value.wrapper);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  const missing = JSON.parse(error.slice(error.indexOf('[{')));
  assert.deepEqual(missing, [
    { command: 'fixture-tool source.mjs', tool: 'fixture-tool' },
    { command: 'fixture-tool source.mjs', artifact: { path: 'node_modules', kind: 'directory' } },
    { command: 'fixture-tool source.mjs', artifact: { path: 'packages/core/dist/missing.js', kind: 'file' } },
  ]);
});

for (const defect of ['wrong-kind', 'escaped-artifact', 'wrong-repository']) {
  test(`#4129 implement identity/prerequisites: ${defect} -> typed input block`, (t) => {
    const value = implementation(t);
    if (defect === 'wrong-kind') {
      rmSync(join(value.worktree, 'node_modules'), { recursive: true });
      writeFileSync(join(value.worktree, 'node_modules'), 'not a directory');
    }
    if (defect === 'escaped-artifact') {
      rmSync(join(value.worktree, 'node_modules'), { recursive: true });
      symlinkSync(value.toolDir, join(value.worktree, 'node_modules'));
    }
    if (defect === 'wrong-repository') {
      git(value.root, 'worktree', 'remove', '--force', value.worktree);
      mkdirSync(value.worktree);
      git(value.worktree, 'init', '-q', '-b', 'issue-42');
    }

    const result = cli(value, 'implement', value.wrapper);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(JSON.parse(result.stderr).error,
      defect === 'wrong-repository' ? /wrong repository checkout/u : /missing prerequisites/u);
  });
}

for (const [name, mutate] of [
  ['missing-tool', (v) => rmSync(join(v.toolDir, 'fixture-tool'))],
  ['non-executable-tool', (v) => chmodSync(join(v.toolDir, 'fixture-tool'), 0o644)],
  ['missing-artifact', (v) => rmSync(join(v.worktree, 'source.mjs'))],
  ['wrong-head', (v) => { v.wrapper.input.starting_head_sha = v.base; }],
  ['wrong-branch', (v) => git(v.worktree, 'checkout', '--detach', '-q')],
  ['dirty', (v) => writeFileSync(join(v.worktree, 'extra.txt'), 'dirty')],
  ['wrong-digest', (v) => { v.wrapper.input.preflight_sha256 = '0'.repeat(64); }],
  ['wrong-accepted', (v) => writeFileSync(v.wrapper.accepted_contract_path, '{}')],
  ['wrong-root', (v) => { v.wrapper.root = v.worktree; }],
]) {
  test(`#4129 implement CLI: ${name} -> no successful dispatch`, (t) => {
    const value = implementation(t);
    mutate(value);

    const result = cli(value, 'implement', value.wrapper);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
    assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  });
}

for (const footprint of [null, [], 'footprint', {}, { version: 1 },
  { status: 'prepared', kind: 'preflight-input', dispatch: {}, footprint: {} }]) {
  test(`#4129 review footprint: ${JSON.stringify(footprint)} -> named shape error and CLI recovery`, (t) => {
    const value = fixture(t);
    value.input.footprint = footprint;

    assert.throws(() => prepareReviewInput(value.input), (error) =>
      error.name === 'WorkflowPreparationError' && error.code === 'invalid-source-footprint');
    const result = cli(value, 'review', value.input);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, 'invalid-source-footprint');
    assert.match(JSON.parse(result.stderr).error, /raw footprint/u);
  });
}

function retainedPreparation(t) {
  const value = fixture(t);
  const { input } = value;
  input.contract = createPreflight({ ...input.contract, scope: ['source.mjs', 'docs/'] });
  input.policy = evaluatePreflight(input.contract, { issue: 42, issueSha256: input.issue_sha256,
    baseSha: value.base, changedFiles: ['source.mjs'] }).policy;
  const previous = buildReviewFact({ head_sha: value.head, preflight_sha256: input.policy.sha256,
    active_axes: input.policy.active_axes, reviews: input.policy.active_axes.map((reviewer) => ({
      reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: value.head,
      preflight_sha256: input.policy.sha256, verdict_signal: 'PASS', blockers: [],
      evidence: [{ acceptance: 'Keep executable value behavior', locations: ['source.mjs:1'] }], observations: [],
    })) }, value.head, input.policy);
  mkdirSync(join(value.root, 'docs/guides'), { recursive: true });
  writeFileSync(join(value.root, 'docs/guides/routing.md'), '# Routing\n');
  git(value.root, 'add', 'docs/guides/routing.md');
  git(value.root, 'commit', '-qm', 'explanation');
  input.head_sha = git(value.root, 'rev-parse', 'HEAD');
  input.implementation = { mode: 'resolve-conflict', previous_head_sha: value.head,
    head_sha: input.head_sha, contract_sha256: input.contract.sha256 };
  git(input.checkout, 'checkout', '--detach', '-q', input.head_sha);
  input.changed_paths = ['docs/guides/routing.md', 'source.mjs'];
  input.diff = value.store('retained.diff', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', value.baseHead, input.head_sha], { cwd: value.root, encoding: 'utf8' }));
  writeFileSync(input.accepted_contract_path, JSON.stringify(input.contract));
  input.evidence[0].receipt = value.store('retained-receipt.json', { ...value.receipt,
    head_sha: input.head_sha, tree_sha: git(input.checkout, 'rev-parse', 'HEAD^{tree}'),
    contract_sha256: input.contract.sha256 });
  const proof = observeReviewRetention(value.root, { previousReview: previous,
    previousAcceptedAt: '2026-01-01T00:00:00.000Z', headSha: input.head_sha,
    baseHeadSha: value.baseHead, policy: input.policy, worktree: input.checkout });
  assert.ok(proof);
  const observation = { issue: 42, decision: { action: 'review',
    dispatch: { contract: { subagent_type: 'fluo-contract-reviewer' } } }, obs: {
    preflight: input.contract, preflightPolicy: input.policy, issueSha256: input.issue_sha256,
    baseSha: value.base, headSha: input.head_sha, changedFiles: input.changed_paths, reviewRetention: proof,
  } };
  input.observation = value.store('retained-plan.json', observation);
  return { ...value, observation };
}

test('#4099 preparation: independently authenticated retention -> only fresh reviewers with complete common evidence', (t) => {
  const value = retainedPreparation(t);

  const result = prepareReviewInput(value.input);

  assert.deepEqual(result.reviewers.map((reviewer) => reviewer.reviewer), ['contract']);
  assert.equal(result.reviewers[0].input, result.common);
  assert.deepEqual(result.common.policy.active_axes, ['contract', 'code', 'verification']);
  assert.deepEqual(result.common.retention, value.observation.obs.reviewRetention);
  assert.deepEqual(result.common.changed_paths, ['docs/guides/routing.md', 'source.mjs']);
  assert.deepEqual(result.common.required_checks, ['node focused check']);
});

for (const mutation of ['narrowed-without-proof', 'manifest-omission', 'digest-tampering', 'missing-receipt']) {
  test(`#4099 preparation: ${mutation} -> input-preparation`, (t) => {
    const value = retainedPreparation(t);
    if (mutation === 'narrowed-without-proof') delete value.observation.obs.reviewRetention;
    if (mutation === 'manifest-omission') value.observation.obs.reviewRetention.compared_files = [];
    if (mutation === 'digest-tampering') value.observation.obs.reviewRetention.compared_files[0].new_sha256 = '0'.repeat(64);
    if (mutation === 'missing-receipt') value.input.evidence = [];
    value.input.observation = value.store('altered-plan.json', value.observation);

    assert.throws(() => prepareReviewInput(value.input), (error) => error.kind === 'input-preparation');
  });
}

test('review preparation: real merged graph -> one identical authenticated input for every axis', (t) => {
  const value = fixture(t);

  const result = prepareReviewInput(value.input);

  assert.equal(result.status, 'prepared');
  assert.equal(result.common.verification_base_sha, value.base);
  assert.equal(result.common.authored_merge_base_sha, value.baseHead);
  assert.notEqual(value.base, value.baseHead);
  assert.deepEqual(result.common.changed_paths, ['source.mjs']);
  assert.equal(result.common.footprint.categories.reflective_integration.affected, false);
  assert.deepEqual(result.reviewers.map((entry) => entry.reviewer), ['contract', 'code', 'verification']);
  assert.deepEqual(result.reviewers.map((entry) => entry.dispatch), [
    { subagent_type: 'fluo-contract-reviewer' },
    { subagent_type: 'fluo-code-reviewer' },
    { subagent_type: 'fluo-verification-reviewer' },
  ]);
  for (const reviewer of result.reviewers) assert.equal(reviewer.input, result.common);
});

test('#4091 preflight preparation: authenticated footprint -> registered preflight dispatch', (t) => {
  const value = fixture(t);
  const path = join(value.input.artifact_root, 'preflight-input.json');
  writeFileSync(path, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: callerFootprint(value) }));

  const output = JSON.parse(execFileSync(process.execPath, [modulePath, 'preflight', path], { encoding: 'utf8' }));

  assert.deepEqual(output.dispatch, { subagent_type: 'fluo-issue-preflight' });
  assert.deepEqual(output.footprint, prepareSourceFootprint(value.root, callerFootprint(value)));
});

test('#4091 preparation: absent registration -> typed non-fixable input block', (t) => {
  const value = fixture(t);
  const config = JSON.parse(readFileSync(join(value.root, '.omo/omo.jsonc')));
  delete config.agents['fluo-code-reviewer'];
  writeFileSync(join(value.root, '.omo/omo.jsonc'), JSON.stringify(config));

  assert.throws(() => prepareReviewInput(value.input),
    (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
      && error.code === 'dispatch-target-unavailable' && error.subagent_type === 'fluo-code-reviewer');
});

test('#4091 registration JSONC: comments and trailing commas -> both preparation dispatch payloads', (t) => {
  const value = fixture(t);
  const path = join(value.root, '.omo/omo.jsonc');
  const { agents } = JSON.parse(readFileSync(path));
  writeFileSync(path, `// registered stage agents
{ /* operator note */
  "routes": ["https://example.test//model/*prompt*/",],
  "agents": ${JSON.stringify(agents)},
}`);
  const inputPath = join(value.input.artifact_root, 'preflight-input.json');
  writeFileSync(inputPath, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: callerFootprint(value) }));

  const preflight = JSON.parse(execFileSync(process.execPath, [modulePath, 'preflight', inputPath], { encoding: 'utf8' }));
  const review = prepareReviewInput(value.input);

  assert.equal(preflight.dispatch.subagent_type, 'fluo-issue-preflight');
  assert.deepEqual(review.reviewers.map((entry) => entry.dispatch.subagent_type),
    ['fluo-contract-reviewer', 'fluo-code-reviewer', 'fluo-verification-reviewer']);
});

test('#4091 registration JSONC: escaped strings and comment markers -> unchanged agent values', (t) => {
  const value = fixture(t);
  const prompt = 'A "quoted" \\path // literal /*comment*/ ,} ,]';
  const model = 'https://example.test//provider/*model*/';
  const agents = { 'fluo-issue-preflight': { prompt, models: [model] } };
  writeFileSync(join(value.root, '.omo/omo.jsonc'), `// registration
{ "agents": {
    "fluo-issue-preflight": {
      "prompt": ${JSON.stringify(prompt)},
      "models": [${JSON.stringify(model)}, /* array trailing comma */],
    },
  }, // object trailing comma
}`);

  const registered = readRegisteredAgents(value.root);

  assert.deepEqual(registered, agents);
});

test('#4091 registration entries: own plain objects -> registered; invalid values and inherited names -> unavailable', () => {
  const dispatch = { subagent_type: 'fluo-issue-preflight' };
  const nullPrototype = Object.create(null);
  nullPrototype[dispatch.subagent_type] = {};

  assert.doesNotThrow(() => validateDispatchTarget(dispatch, { [dispatch.subagent_type]: {} }));
  assert.doesNotThrow(() => validateDispatchTarget(dispatch, nullPrototype));
  for (const entry of [null, [], true, 1, 'agent', () => {}, new Date(0), Object.create({ inherited: true })]) {
    assert.throws(() => validateDispatchTarget(dispatch, { [dispatch.subagent_type]: entry }),
      (error) => error.code === 'dispatch-target-unavailable' && error.subagent_type === dispatch.subagent_type);
  }
  for (const subagent_type of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => validateDispatchTarget({ subagent_type }, {}),
      (error) => error.code === 'dispatch-target-unavailable' && error.subagent_type === subagent_type);
  }
  assert.throws(() => validateDispatchTarget(dispatch, Object.create({ [dispatch.subagent_type]: {} })),
    (error) => error.code === 'dispatch-target-unavailable');
});

for (const [defect, content] of [
  ['missing', null], ['truncated', '{"agents":'], ['unterminated-comment', '{"agents":{}} /*'],
  ['leading-comma', '{,}'], ['missing-value', '{"agents":,}'],
  ['split-token', '{"agents": 1/* comment */2}'], ['double-comma', '{"agents":{},,}'],
  ['root-null', 'null'], ['root-array', '[]'], ['root-number', '1'], ['root-string', '"registration"'],
  ['agents-missing', '{}'], ['agents-array', '{"agents":[]}'], ['agents-null', '{"agents":null}'],
  ['agents-number', '{"agents":1}'], ['agents-string', '{"agents":"registration"}'],
]) {
  test(`#4091 registration unreadable: ${defect} -> typed preparation block`, (t) => {
    const value = fixture(t);
    const path = join(value.root, '.omo/omo.jsonc');
    if (content === null) rmSync(path);
    else writeFileSync(path, content);
    const inputPath = join(value.input.artifact_root, 'preflight-input.json');
    writeFileSync(inputPath, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: callerFootprint(value) }));

    const result = spawnSync(process.execPath, [modulePath, 'preflight', inputPath], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    const block = JSON.parse(result.stderr);
    assert.equal(block.kind, 'input-preparation');
    assert.equal(block.code, 'dispatch-registration-unreadable');
    assert.equal(block.fix_back_eligible, false);
    assert.throws(() => readRegisteredAgents(value.root),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
        && error.code === 'dispatch-registration-unreadable');
    assert.throws(() => prepareReviewInput(value.input),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
        && error.code === 'dispatch-registration-unreadable');
  });
}

test('review readable index: retained focused receipts -> authenticated decoder free exact results and unknown counts', (t) => {
  const value = fixture(t);

  const result = prepareReviewInput(value.input);

  assert.ok(result.common.readable_index, 'reviewers need a readable authenticated index');
  const index = result.common.readable_index;
  assert.equal(index.head_sha, value.head);
  assert.equal(index.tree_sha, value.tree);
  assert.equal(index.contract_sha256, value.input.contract.sha256);
  assert.equal(index.policy_sha256, value.input.policy.sha256);
  assert.equal(index.commands[0].command, 'node focused check');
  assert.equal(index.commands[0].test_results, null);
  assert.deepEqual(index.commands[0].packed_commands, []);
  assert.equal(index.commands[0].receipt.sha256, value.input.evidence[0].receipt.sha256);
  assert.equal(index.commands[0].stdout.sha256, value.receipt.stdout.sha256);
  assert.ok(index.sha256);
  for (const reviewer of result.reviewers) assert.equal(reviewer.input.readable_index, index);
});

async function packedIndexFixture(t) {
  const value = fixture(t);
  const root = join(value.input.artifact_root, 'packed');
  const commands = [];
  const runner = createCommandRunner(root, commands, 'actual-1');
  t.after(() => runner.dispose());
  const testPath = join(value.input.artifact_root, 'actual.test.mjs');
  writeFileSync(testPath, `import test from 'node:test'; import assert from 'node:assert/strict';
test('actual check', () => assert.equal(1 + 1, 2));\n`);
  await runner.run('actual-tests', ['--test', '--test-reporter=tap', testPath], value.input.artifact_root,
    { NODE_TEST_CONTEXT: undefined }, process.execPath);
  value.receipt.stdout = value.store('focused.stdout', readFileSync(commands[0].evidence.stdout.path, 'utf8'));
  value.receipt.packed_receipt = value.store('packed/pack-release.json', { head: value.head,
    source: { head: value.head, tree: value.tree }, status: 'passed', commands });
  value.input.evidence[0].receipt = value.store('focused.json', value.receipt);
  return value;
}

test('review readable index: real packed command and Node results -> exposes actual inventory without decoder', async (t) => {
  const value = await packedIndexFixture(t);

  const { common } = prepareReviewInput(value.input);

  assert.ok(common.readable_index.commands[0].test_results, 'actual Node subprocess must report its executed tests');
  assert.equal(common.readable_index.commands[0].test_results.summary.tests, 1);
  assert.equal(common.readable_index.commands[0].test_results.summary.pass, 1);
  const packed = common.readable_index.commands[0].packed_commands;
  assert.equal(packed.length, 1);
  assert.equal(packed[0].label, 'actual-tests');
  assert.equal(packed[0].command[0], process.execPath);
  assert.equal(packed[0].exit_code, 0);
  assert.equal(packed[0].signal, null);
  assert.equal(packed[0].test_results.summary.tests, 1);
  assert.ok(packed[0].duration_ms >= 0);
  const supplied = value.store('readable-index.json', common.readable_index);
  assert.deepEqual(prepareReviewInput({ ...value.input, readable_index: supplied }).common.readable_index, common.readable_index);
});

for (const defect of ['missing', 'truncated', 'altered', 'rebound-count', 'stale-head', 'rebound-policy', 'rebound-contract']) {
  test(`review readable index: ${defect} retained index -> input preparation rejection`, (t) => {
    const value = fixture(t);
    const index = prepareReviewInput(value.input).common.readable_index;
    value.input.readable_index = value.store('readable-index.json', index);
    if (defect === 'missing') rmSync(join(value.input.artifact_root, 'readable-index.json'));
    if (defect === 'truncated') writeFileSync(join(value.input.artifact_root, 'readable-index.json'), '{}');
    if (defect === 'altered') {
      const bytes = readFileSync(join(value.input.artifact_root, 'readable-index.json'));
      bytes[bytes.length - 3] ^= 1;
      writeFileSync(join(value.input.artifact_root, 'readable-index.json'), bytes);
    }
    if (defect.startsWith('rebound') || defect === 'stale-head') {
      if (defect === 'rebound-count') index.commands[0].test_results = { summary: { tests: 99 } };
      else index[defect === 'stale-head' ? 'head_sha' : defect === 'rebound-policy' ? 'policy_sha256' : 'contract_sha256'] = 'd'.repeat(defect === 'stale-head' ? 40 : 64);
      value.input.readable_index = value.store('readable-index.json', index);
    }

    assert.throws(() => prepareReviewInput(value.input), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.equal(error.fix_back_eligible, false);
      assert.match(error.message, /readable index/u);
      return true;
    });
  });
}

for (const defect of ['missing-packed', 'truncated-packed', 'rebound-command', 'stale-packed-head', 'altered-raw']) {
  test(`review readable index: ${defect} packed source -> authenticated source rejection`, async (t) => {
    const value = await packedIndexFixture(t);
    const path = join(value.input.artifact_root, 'packed/pack-release.json');
    const packed = JSON.parse(readFileSync(path));
    if (defect === 'missing-packed') rmSync(path);
    if (defect === 'truncated-packed') writeFileSync(path, '{}');
    if (defect === 'rebound-command' || defect === 'stale-packed-head') {
      if (defect === 'rebound-command') packed.commands[0].command = ['pnpm', 'fiction'];
      else packed.head = 'd'.repeat(40);
      value.receipt.packed_receipt = value.store('packed/pack-release.json', packed);
      value.input.evidence[0].receipt = value.store('focused.json', value.receipt);
    }
    if (defect === 'altered-raw') writeFileSync(packed.commands[0].evidence.stdout.path, 'changed raw bytes');

    assert.throws(() => prepareReviewInput(value.input), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.equal(error.fix_back_eligible, false);
      assert.match(error.message, /packed/u);
      return true;
    });
  });
}

const defects = [
  ['wrong-checkout', (v) => { v.input.checkout = v.root; git(v.root, 'checkout', '-q', 'main'); }, /wrong checkout\/head/u],
  ['wrong-head', (v) => { v.input.head_sha = v.base; }, /wrong checkout\/head/u],
  ['wrong-base', (v) => { v.input.base_head_sha = v.base; }, /stale origin\/base/u],
  ['wrong-issue', (v) => { v.input.issue_sha256 = 'd'.repeat(64); }, /stale canonical plan observation/u],
  ['wrong-contract', (v) => { v.input.contract.acceptance.push('unaccepted'); }, /contract digest mismatch/u],
  ['wrong-policy', (v) => { v.input.policy.sha256 = 'd'.repeat(64); }, /stale canonical plan observation/u],
  ['missing-path', (v) => { v.input.changed_paths = []; }, /stale canonical plan observation/u],
  ['old-accepted-contract', (v) => {
    v.input.contract = createPreflight({ ...v.input.contract, acceptance: ['Older approved acceptance'] });
  }, /stale accepted contract/u],
  ['missing-observation', (v) => { rmSync(join(v.input.artifact_root, 'plan.json')); }, /canonical plan observation: artifact unavailable/u],
  ['missing-diff', (v) => { rmSync(join(v.input.artifact_root, v.input.diff.path)); }, /review diff: artifact unavailable/u],
  ['truncated-diff', (v) => { writeFileSync(join(v.input.artifact_root, v.input.diff.path), 'diff'); }, /review diff: truncated artifact/u],
  ['tampered-diff', (v) => {
    const bytes = readFileSync(join(v.input.artifact_root, v.input.diff.path)); bytes[bytes.length - 2] ^= 1;
    writeFileSync(join(v.input.artifact_root, v.input.diff.path), bytes);
  }, /review diff: artifact digest mismatch/u],
  ['authenticated-wrong-diff', (v) => { v.input.diff = v.store('other.diff', 'diff --git a/other b/other\n'); }, /does not match complete/u],
  ['missing-evidence', (v) => { v.input.evidence = []; }, /missing required focused evidence/u],
  ['missing-receipt', (v) => { rmSync(join(v.input.artifact_root, 'focused.json')); }, /focused receipt: artifact unavailable/u],
  ['truncated-receipt', (v) => { writeFileSync(join(v.input.artifact_root, 'focused.json'), '{}'); }, /focused receipt: truncated artifact/u],
  ['stale-evidence', (v) => {
    v.receipt.head_sha = v.base; v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /stale head\/tree\/contract/u],
  ['wrong-tree-evidence', (v) => {
    v.receipt.tree_sha = 'd'.repeat(40); v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /stale head\/tree\/contract/u],
  ['wrong-contract-evidence', (v) => {
    v.receipt.contract_sha256 = 'd'.repeat(64); v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /stale head\/tree\/contract/u],
  ['incomplete-evidence', (v) => {
    v.receipt.complete = false; v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /incomplete receipt/u],
  ['failed-evidence', (v) => {
    v.receipt.exit_code = 1; v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /no completed passing command/u],
  ['tampered-stdout', (v) => {
    const bytes = readFileSync(join(v.input.artifact_root, 'focused.stdout')); bytes[0] ^= 1;
    writeFileSync(join(v.input.artifact_root, 'focused.stdout'), bytes);
  }, /focused stdout: artifact digest mismatch/u],
  ['missing-footprint-category', (v) => { delete v.input.footprint.categories.book; }, /categories: non-canonical keys/u],
  ['wrong-footprint-source', (v) => {
    v.input.footprint.categories.governance.sources[0].sha256 = 'd'.repeat(64);
  }, /source digest mismatch/u],
  ['unexplained-unaffected-footprint', (v) => {
    v.input.footprint.categories.generated_consumers.reason = '';
  }, /missing impact, selection rationale/u],
  ['stale-footprint', (v) => { v.input.footprint.sha256 = 'd'.repeat(64); }, /stale source footprint binding/u],
  ['scope-expansion', (v) => {
    const contract = createPreflight({ ...v.input.contract, scope: ['other/'], predicted_files: ['other/source.mjs'] });
    v.input.contract = contract;
    v.input.implementation.contract_sha256 = contract.sha256;
    writeFileSync(v.input.accepted_contract_path, JSON.stringify(contract));
    const observation = JSON.parse(readFileSync(join(v.input.artifact_root, 'plan.json'), 'utf8'));
    observation.obs.preflight = contract;
    v.input.observation = v.store('plan.json', observation);
  }, /scope-expansion: source.mjs/u],
];
for (const [name, mutate, expected] of defects) {
  test(`review preparation: ${name} -> input block before any reviewer dispatch`, (t) => {
    const value = fixture(t);
    mutate(value);

    assert.throws(() => prepareReviewInput(value.input), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.equal(error.fix_back_eligible, false);
      assert.match(error.message, expected);
      return true;
    });
  });
}

test('workflow preparation CLI: preflight sidecar -> runnable stage input consumed by review', (t) => {
  const value = fixture(t);
  const inputPath = join(value.root, 'preflight-input.json');
  writeFileSync(inputPath, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: callerFootprint(value) }));

  const output = execFileSync(process.execPath, [modulePath, 'preflight', inputPath], { encoding: 'utf8' });

  value.input.footprint = JSON.parse(output).footprint;
  assert.equal(prepareReviewInput(value.input).common.footprint.sha256, value.input.footprint.sha256);
});

test('workflow preparation CLI: authenticated real inputs -> executable review dispatch payload', (t) => {
  const value = fixture(t);
  const path = join(value.root, 'review-input.json');
  writeFileSync(path, JSON.stringify(value.input));

  const output = execFileSync(process.execPath, [modulePath, 'review', path], { encoding: 'utf8' });

  assert.equal(JSON.parse(output).common.head_sha, value.head);
});

test('artifact guard mutation: removing digest comparison -> tampered artifact regression fails', (t) => {
  const value = fixture(t);
  const source = readFileSync(modulePath, 'utf8');
  const needle = 'requireInput(sha256(bytes) === reference.sha256,';
  assert.equal(source.split(needle).length, 2);
  const mutated = source.replace(needle, 'requireInput(true,');
  const path = join(value.root, 'mutation-input.json');
  const bytes = readFileSync(join(value.input.artifact_root, 'focused.stdout')); bytes[0] ^= 1;
  writeFileSync(join(value.input.artifact_root, 'focused.stdout'), bytes);
  writeFileSync(path, JSON.stringify(value.input));
  const driver = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const target = pathToFileURL(${JSON.stringify(modulePath)}).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: ${JSON.stringify(mutated)}, shortCircuit: true };
      return next(url, context);
    } });
    const { prepareReviewInput } = await import(target);
    assert.throws(() => prepareReviewInput(JSON.parse(fs.readFileSync(${JSON.stringify(path)}, 'utf8'))),
      /focused stdout: artifact digest mismatch/);
  `;

  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', driver],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /Missing expected exception/u);
    process.stdout.write(`${JSON.stringify({ kind: 'mutation-evidence',
      guard: 'artifact-sha256', command: [process.execPath, '--input-type=module', '-e', driver],
      exit_code: error.status, stdout: error.stdout, stderr: error.stderr })}\n`);
    return true;
  });
});

test('authored diff guard mutation: removing byte comparison -> authenticated wrong diff regression fails', (t) => {
  const value = fixture(t);
  const source = readFileSync(modulePath, 'utf8');
  const needle = 'requireInput(actualDiff.equals(capturedDiff),';
  assert.equal(source.split(needle).length, 2);
  const mutated = source.replace(needle, 'requireInput(true,');
  value.input.diff = value.store('authored.diff', 'diff --git a/wrong b/wrong\n');
  const path = join(value.root, 'mutation-input.json');
  writeFileSync(path, JSON.stringify(value.input));
  const driver = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const target = pathToFileURL(${JSON.stringify(modulePath)}).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: ${JSON.stringify(mutated)}, shortCircuit: true };
      return next(url, context);
    } });
    const { prepareReviewInput } = await import(target);
    assert.throws(() => prepareReviewInput(JSON.parse(fs.readFileSync(${JSON.stringify(path)}, 'utf8'))),
      /does not match complete merge-base-to-head authored diff/);
  `;

  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', driver],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /Missing expected exception/u);
    process.stdout.write(`${JSON.stringify({ kind: 'mutation-evidence',
      guard: 'authored-diff-bytes', command: [process.execPath, '--input-type=module', '-e', driver],
      exit_code: error.status, stdout: error.stdout, stderr: error.stderr })}\n`);
    return true;
  });
});

function largeReviewFixture(t, reason = '한글🙂"\\\n'.repeat(3500)) {
  const value = fixture(t);
  value.footprintInput.categories.direct_callers.reason = reason;
  value.input.footprint = prepareSourceFootprint(value.root, value.footprintInput);
  return value;
}

test('#4231 transfer CLI: 179.4 KB single-line dispatch -> bounded complete delivery', (t) => {
  const value = largeReviewFixture(t, 'x'.repeat(46000));
  const original = prepareReviewInput(value.input);
  assert.ok(Buffer.byteLength(JSON.stringify(original)) > 179400);

  const result = cli(value, 'review', value.input);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) < 50000,
    'every CLI dispatch must fit a single bounded tool read');
  assert.equal(JSON.parse(result.stdout).kind, 'review-transfer');
});

function transferFixture(t, reason) {
  const value = largeReviewFixture(t, reason);
  const result = cli(value, 'review', value.input);
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.kind, 'review-transfer');
  const transfer = envelope.transfer;
  const manifest = JSON.parse(readFileSync(join(value.input.artifact_root, transfer.manifest.path)));
  return { ...value, envelope, transfer, manifest };
}

function retainTransferManifest(value) {
  const unitBytes = value.manifest.units.reduce((sum, { reference }) => sum + reference.bytes, 0);
  let bytes = Buffer.from(JSON.stringify(value.manifest));
  while (value.manifest.total_bytes !== unitBytes + bytes.length) {
    value.manifest.total_bytes = unitBytes + bytes.length;
    bytes = Buffer.from(JSON.stringify(value.manifest));
  }
  writeFileSync(join(value.input.artifact_root, value.transfer.manifest.path), bytes);
  value.transfer.manifest.bytes = bytes.length;
  value.transfer.manifest.sha256 = hash(bytes);
}

function readerInput(value, index = null) {
  return { version: 1, stage: 'review-read', artifact_root: value.input.artifact_root,
    transfer: value.transfer, index };
}

test('#4231 transfer reader: UTF-8 escaped long value -> identical complete input on all axes', (t) => {
  const value = transferFixture(t);
  const expected = prepareReviewInput(value.input);
  assert.deepEqual(value.envelope.reviewers.map(({ reviewer }) => reviewer),
    ['contract', 'code', 'verification']);

  for (const reviewer of value.envelope.reviewers) {
    const restored = readReviewTransfer(value.input.artifact_root, reviewer.transfer);
    assert.deepEqual(restored, expected);
    assert.deepEqual(restored.reviewers.find(({ reviewer: axis }) => axis === reviewer.reviewer).input,
      expected.common);
  }
  const manifestResult = cli(value, 'review-read', readerInput(value));
  assert.equal(manifestResult.status, 0, manifestResult.stderr);
  assert.deepEqual(JSON.parse(manifestResult.stdout), value.manifest);
  const fragments = value.manifest.units.map(({ index, reference, lines }) => {
    const result = cli(value, 'review-read', readerInput(value, index));
    assert.equal(result.status, 0, result.stderr);
    const actual = readFileSync(join(value.input.artifact_root, reference.path));
    assert.equal(reference.bytes, actual.length);
    assert.equal(reference.sha256, hash(actual));
    assert.equal(lines, actual.toString().split('\n').length);
    assert.ok(actual.length < 50000 && actual.toString().split('\n').length <= 1500);
    assert.ok(Buffer.byteLength(result.stdout) < 50000 && result.stdout.split('\n').length <= 1500);
    return JSON.parse(result.stdout).text;
  });
  const complete = Buffer.from(fragments.join(''));
  assert.equal(complete.length, value.transfer.prepared.bytes);
  assert.equal(hash(complete), value.transfer.prepared.sha256);
  assert.deepEqual(JSON.parse(complete), expected);
  const manifestBytes = readFileSync(join(value.input.artifact_root, value.transfer.manifest.path));
  assert.ok(manifestBytes.length < 50000 && manifestBytes.toString().split('\n').length <= 1500);
  assert.equal(value.manifest.total_bytes,
    manifestBytes.length + value.manifest.units.reduce((sum, { reference }) => sum + reference.bytes, 0));
});

test('#4231 transfer CLI: small input -> original success JSON without decoder or new arguments', (t) => {
  const value = fixture(t);
  const expected = prepareReviewInput(value.input);

  const result = cli(value, 'review', value.input);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.deepEqual(prepareReviewTransfer(value.input), expected);
});

test('#4231 transfer CLI: one MB serialized dispatch -> supported complete delivery', (t) => {
  const value = transferFixture(t, 'q'.repeat(280000));

  const restored = readReviewTransfer(value.input.artifact_root, value.transfer);

  assert.ok(value.transfer.prepared.bytes > 1024 * 1024);
  assert.deepEqual(restored, prepareReviewInput(value.input));
});

test('#4231 transfer CLI: near total allowance -> bounded manifest and complete repeated delivery', (t) => {
  const value = transferFixture(t, 's'.repeat(500000));

  const repeated = cli(value, 'review', value.input);

  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout), value.envelope);
  assert.deepEqual(readReviewTransfer(value.input.artifact_root, value.transfer), prepareReviewInput(value.input));
  assert.ok(value.transfer.prepared.bytes <= reviewTransferLimits.prepared_bytes);
  assert.ok(value.transfer.prepared.bytes > 2000000);
  assert.ok(value.transfer.manifest.bytes < 50000);
});

test('#4231 transfer CLI: retained unit escaped via symlink -> reject without overwriting external bytes', (t) => {
  const value = transferFixture(t, 'z'.repeat(46000));
  const entry = value.manifest.units[0];
  const path = join(value.input.artifact_root, entry.reference.path);
  const bytes = readFileSync(path);
  const external = join(value.root, 'external-unit.json');
  writeFileSync(external, bytes);
  rmSync(path);
  symlinkSync(external, path);

  const result = cli(value, 'review', value.input);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
  assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  assert.match(JSON.parse(result.stderr).error, /escaped root/u);
  assert.deepEqual(readFileSync(external), bytes);
});

test('#4231 transfer CLI: total allowance exceeded -> structured non-fixable rejection', (t) => {
  const value = largeReviewFixture(t, 'q'.repeat(600000));

  const result = cli(value, 'review', value.input);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
  assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  assert.match(JSON.parse(result.stderr).error, /prepared size exceeds total allowance/u);
});

for (const defect of ['manifest-missing', 'manifest-truncated', 'manifest-altered', 'manifest-json', 'manifest-lines',
  'unit-missing', 'unit-truncated', 'unit-altered', 'unit-json', 'duplicate', 'omitted', 'reordered', 'offset',
  'unit-length', 'unit-bytes', 'unit-lines', 'unit-overflow', 'manifest-overflow', 'total',
  'prepared-length', 'prepared-digest', 'binding', 'limits', 'escaped-reference']) {
  test(`#4231 transfer reader: ${defect} -> input-preparation without partial output`, (t) => {
    const value = transferFixture(t, 'r'.repeat(46000));
    const entry = value.manifest.units[0];
    const manifestPath = join(value.input.artifact_root, value.transfer.manifest.path);
    const unitPath = join(value.input.artifact_root, entry.reference.path);
    let retain = false;
    if (defect === 'manifest-missing') rmSync(manifestPath);
    if (defect === 'manifest-truncated') writeFileSync(manifestPath, '{}');
    if (defect === 'manifest-altered') {
      const bytes = readFileSync(manifestPath); bytes[10] ^= 1; writeFileSync(manifestPath, bytes);
    }
    if (defect === 'manifest-json') value.transfer.manifest = value.store('bad-manifest.json', '{');
    if (defect === 'manifest-lines') {
      const bytes = Buffer.from('\n'.repeat(1500) + JSON.stringify(value.manifest));
      writeFileSync(manifestPath, bytes);
      value.transfer.manifest.bytes = bytes.length; value.transfer.manifest.sha256 = hash(bytes);
    }
    if (defect === 'unit-missing') rmSync(unitPath);
    if (defect === 'unit-truncated') writeFileSync(unitPath, '{}');
    if (defect === 'unit-altered') {
      const bytes = readFileSync(unitPath); bytes[10] ^= 1; writeFileSync(unitPath, bytes);
    }
    if (defect === 'unit-json') { entry.reference = value.store('bad-unit.json', '{'); retain = true; }
    if (defect === 'duplicate') { value.manifest.units[1] = entry; retain = true; }
    if (defect === 'omitted') { value.manifest.units.pop(); retain = true; }
    if (defect === 'reordered') { value.manifest.units.reverse(); retain = true; }
    if (defect === 'offset') { entry.offset += 1; retain = true; }
    if (defect === 'unit-length') { entry.content_bytes -= 1; retain = true; }
    if (defect === 'unit-bytes') { entry.reference.bytes -= 1; retain = true; }
    if (defect === 'unit-lines') { entry.lines = 1501; retain = true; }
    if (defect === 'unit-overflow') { entry.reference.bytes = 50000; retain = true; }
    if (defect === 'manifest-overflow') value.transfer.manifest.bytes = 50000;
    if (defect === 'total') { value.manifest.total_bytes = reviewTransferLimits.total_bytes + 1; }
    if (defect === 'prepared-length') value.transfer.prepared.bytes -= 1;
    if (defect === 'prepared-digest') value.transfer.prepared.sha256 = 'a'.repeat(64);
    if (defect === 'binding') value.transfer.binding.policy_sha256 = value.transfer.binding.contract_sha256;
    if (defect === 'limits') { value.manifest.limits.chunk_bytes += 1; retain = true; }
    if (defect === 'escaped-reference') { entry.reference.path = '../outside.json'; retain = true; }
    if (retain) retainTransferManifest(value);
    else if (defect === 'total') {
      const bytes = Buffer.from(JSON.stringify(value.manifest));
      writeFileSync(manifestPath, bytes);
      value.transfer.manifest.bytes = bytes.length; value.transfer.manifest.sha256 = hash(bytes);
    }

    assert.throws(() => readReviewTransfer(value.input.artifact_root, value.transfer), (error) =>
      error.kind === 'input-preparation' && error.fix_back_eligible === false);
    const result = cli(value, 'review-read', readerInput(value));
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    const block = JSON.parse(result.stderr);
    assert.equal(block.kind, 'input-preparation');
    assert.equal(block.fix_back_eligible, false);
  });
}

test('#4231 transfer digest mutation: authenticated altered content -> regression detects removed comparison', (t) => {
  const value = transferFixture(t, 'Ж'.repeat(23000));
  for (const entry of value.manifest.units) {
    const path = join(value.input.artifact_root, entry.reference.path);
    const unit = JSON.parse(readFileSync(path));
    unit.text = unit.text.replaceAll('Ж', 'Ф');
    const bytes = Buffer.from(JSON.stringify(unit));
    writeFileSync(path, bytes);
    entry.reference.bytes = bytes.length; entry.reference.sha256 = hash(bytes);
  }
  retainTransferManifest(value);
  assert.throws(() => readReviewTransfer(value.input.artifact_root, value.transfer),
    /review transfer: prepared digest mismatch/u);
  const source = readFileSync(modulePath, 'utf8');
  const needle = "requireInput(sha256(bytes) === transfer.prepared.sha256,";
  assert.equal(source.split(needle).length, 2);
  const mutated = source.replace(needle, 'requireInput(true,');
  const path = join(value.input.artifact_root, 'transfer-mutation.json');
  writeFileSync(path, JSON.stringify(value.transfer));
  const driver = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const target = pathToFileURL(${JSON.stringify(modulePath)}).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: ${JSON.stringify(mutated)}, shortCircuit: true };
      return next(url, context);
    } });
    const { readReviewTransfer } = await import(target);
    assert.throws(() => readReviewTransfer(${JSON.stringify(value.input.artifact_root)},
      JSON.parse(fs.readFileSync(${JSON.stringify(path)}))), /review transfer: prepared digest mismatch/);
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Missing expected exception/u);
  process.stdout.write(`${JSON.stringify({ kind: 'mutation-evidence', guard: 'review-transfer-prepared-sha256',
    exit_code: result.status, stdout: result.stdout, stderr: result.stderr })}\n`);
});
