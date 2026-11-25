import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
export const reportPath = ".omo/fix-back-vitest.json";
export const reporterPath = new URL(
	"./fix-back-vitest-reporter.mjs",
	import.meta.url,
);
export const reporterHash = () =>
	createHash("sha256").update(readFileSync(reporterPath)).digest("hex");

/** Authenticate a complete runner report at the RED/GREEN evidence boundary. */
export function validateVitestProof(report, failure, state) {
	const requireProof = (condition, message) => {
		if (!condition) throw new TypeError(message);
	};
	const hooksPassed = (hooks) =>
		hooks &&
		typeof hooks === "object" &&
		!Array.isArray(hooks) &&
		Object.entries(hooks).every(
			([name, value]) =>
				["beforeAll", "afterAll", "beforeEach", "afterEach"].includes(
					name,
				) &&
				value === "pass",
		);
	requireProof(
		report &&
			report.version === 1 &&
			report.runner === "vitest" &&
			report.reporter_sha256 === reporterHash() &&
			report.complete === true &&
			report.reason === state &&
			Array.isArray(report.unhandled) &&
			report.unhandled.length === 0 &&
			Array.isArray(report.modules) &&
			report.modules.length === 1 &&
			Array.isArray(report.suites) &&
			Array.isArray(report.tests) &&
			report.tests.length > 0,
		"incomplete or unsuccessful real Vitest report",
	);
	requireProof(
		report.modules[0].file === failure.file &&
			report.modules[0].state === state &&
			[...report.modules, ...report.suites].every(
				(suite) =>
					suite.file === failure.file &&
					["passed", "failed", "skipped"].includes(suite.state) &&
					Array.isArray(suite.errors) &&
					suite.errors.length === 0 &&
					hooksPassed(suite.hooks),
			),
		"module, setup or suite hook failure",
	);
	const selected = report.tests.filter(
		(test) => test.file === failure.file && test.test === failure.test,
	);
	requireProof(
		selected.length === 1 &&
			report.tests.every(
				(test) =>
					test.file === failure.file &&
					typeof test.test === "string" &&
					Array.isArray(test.errors) &&
					hooksPassed(test.hooks) &&
					(test === selected[0] ||
						(test.state === "skipped" && test.errors.length === 0)),
			),
		"unrelated, multiple or incomplete test results",
	);
	const test = selected[0];
	requireProof(
		test.state === state &&
			test.mode === "run" &&
			test.fails === false &&
			test.retry === 0 &&
			test.repeat === 0,
		"selected test did not execute exactly once",
	);
	requireProof(
		report.stats?.passed === (state === "passed" ? 1 : 0) &&
			report.stats?.failed === (state === "failed" ? 1 : 0),
		"inconsistent Vitest result counts",
	);
	if (state === "passed") {
		requireProof(test.errors.length === 0, "GREEN retained test errors");
		return report;
	}
	requireProof(
		test.errors.length === 1,
		"expected one test-body assertion failure",
	);
	const error = test.errors[0];
	const location = error.locations?.[0];
	requireProof(
		error.body === true &&
			error.name === "AssertionError" &&
			(error.code === null || error.code === "ERR_ASSERTION") &&
			Array.isArray(error.locations) &&
			location?.file === failure.file &&
			location.line === failure.line &&
			Number.isSafeInteger(location.column) &&
			location.column > 0,
		"expected one test-body assertion at the first source file/line",
	);
	return report;
}

// Vitest batches final task state before replaying reporter events. Hook-time
// result().errors is therefore not a snapshot of errors raised by that hook.
export default class FixBackVitestReporter {
	onInit(context) {
		if (
			context.projects.length !== 1 ||
			context.projects[0].config.name !== "packages" ||
			context.projects[0].config.pool !== "forks"
		) {
			throw new Error(
				"fix-back Vitest: requires the isolated packages forks pool",
			);
		}
		const installed = createRequire(require.resolve("vitest/package.json"));
		this.parseStacktrace =
			installed("@vitest/utils/source-map").parseStacktrace;
		this.runnerSource = resolve(
			dirname(installed.resolve("@vitest/runner")),
			"chunk-artifact.js",
		);
		const lines = readFileSync(this.runnerSource, "utf8").split("\n");
		const callbacks = lines.flatMap((line, index) =>
			line.trim() ===
					'await $("test.callback", () => limitMaxConcurrency(() => fn()));'
				? [index + 1]
				: []
		);
		if (callbacks.length !== 1) {
			throw new Error(
				"fix-back Vitest: unsupported installed body invocation",
			);
		}
		this.bodyLine = callbacks[0];
		this.context = context;
	}

	onTestRunEnd(modules, unhandledErrors, reason) {
		const context = this.context;
		const file = (id) => relative(context.config.root, id);
		const errors = (items) =>
			(items ?? []).map((error) => {
				const frames = this.parseStacktrace(
					typeof error.stack === "string" ? error.stack : "",
					{ ignoreStackEntries: [] },
				);
				const firstSource = frames.find(
					(frame) =>
						frame.line > 0 &&
						frame.column > 0 &&
						!frame.file.includes("/node_modules/") &&
						!frame.file.startsWith("node:"),
				);
				return {
					name: error.name ?? null,
					code: error.code ?? null,
					stack: typeof error.stack === "string" ? error.stack : null,
					body: frames.some((frame) =>
						frame.file === this.runnerSource &&
						frame.line === this.bodyLine
					) &&
						firstSource?.file === error.stacks?.[0]?.file,
					locations: (error.stacks ?? [])
						.filter(
							(frame) =>
								frame.line > 0 &&
								frame.column > 0 &&
								!frame.file.includes("/node_modules/") &&
								!frame.file.startsWith("node:"),
						)
						.map((frame) => ({
							file: file(frame.file),
							line: frame.line,
							column: frame.column,
						})),
				};
			});
		const suite = (entity) => ({
			file: file(entity.moduleId ?? entity.module.moduleId),
			state: entity.state(),
			errors: errors(entity.errors()),
			hooks: entity.task.result?.hooks ?? {},
		});
		const tests = modules.flatMap((module) =>
			[...module.children.allTests()].map((test) => ({
				file: file(module.moduleId),
				test: test.fullName,
				state: test.result().state,
				mode: test.options.mode,
				fails: test.options.fails === true,
				repeat: test.options.repeats ?? 0,
				retry: test.options.retry ?? 0,
				hooks: test.task.result?.hooks ?? {},
				errors: errors(test.result().errors),
			}))
		);
		const report = {
			version: 1,
			runner: "vitest",
			reporter_sha256: reporterHash(),
			run_id: process.env.FLUO_FIX_BACK_VITEST_RUN_ID,
			complete: true,
			reason,
			unhandled: errors(unhandledErrors),
			modules: modules.map(suite),
			suites: modules.flatMap((module) =>
				[...module.children.allSuites()].map(suite)
			),
			tests,
			stats: {
				passed: tests.filter((test) => test.state === "passed").length,
				failed: tests.filter((test) => test.state === "failed").length,
			},
		};
		const output = resolve(context.config.root, reportPath);
		if (context.config.outputFile !== reportPath) {
			throw new Error("fix-back Vitest: non-canonical output");
		}
		mkdirSync(dirname(output), { recursive: true });
		// A worker-created lookalike must make the run fail, never replace evidence.
		const bytes = JSON.stringify(report);
		writeFileSync(output, bytes, { flag: "wx" });
		// The collector reserves fd 3 in the runner; worker stdout and worker
		// files cannot stand in for successful reporter completion.
		writeFileSync(3, bytes);
	}
}
