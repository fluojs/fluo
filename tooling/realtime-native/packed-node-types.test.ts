import { execFile } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { workspacePackageManifests } from "../release/release-intents.mjs";
import { resolveWorkspaceBuildOrder } from "../scripts/run-workspace-build-closure.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const commandTimeout = 120_000;
const execute = promisify(execFile);

it(
	"packed Node declarations: isolated consumer -> typed ws sockets without direct ws dependencies (#4199)",
	async () => {
		const sandbox = realpathSync(
			mkdtempSync(join(tmpdir(), "fluo-websockets-node-types-")),
		);
		try {
			// No ancestor may contribute ambient types or workspace dependency links.
			for (
				let ancestor = dirname(sandbox);;
				ancestor = dirname(ancestor)
			) {
				expect(
					existsSync(join(ancestor, "node_modules")),
					`consumer ancestor ${ancestor}`,
				).toBe(false);
				if (ancestor === dirname(ancestor)) {
					break;
				}
			}

			const environment = {
				...process.env,
				NODE_PATH: "",
				NODE_OPTIONS: "",
				CI: "1",
			};
			const packages = workspacePackageManifests(root);
			const artifacts: Record<string, string> = {};
			for (
				const name of resolveWorkspaceBuildOrder(
					"@fluojs/websockets",
					root,
				)
			) {
				const record = packages.find(({ manifest }) =>
					manifest.name === name
				);
				if (!record) {
					throw new Error(`Missing workspace package ${name}.`);
				}
				const target = join(
					sandbox,
					"artifacts",
					name.replace("@fluojs/", ""),
				);
				await execute(
					"pnpm",
					[
						"--dir",
						dirname(record.packageJsonPath),
						"pack",
						"--pack-destination",
						target,
					],
					{ cwd: root, env: environment, timeout: commandTimeout },
				);
				const tarballs = readdirSync(target).filter((entry) =>
					entry.endsWith(".tgz")
				);
				expect(tarballs, `packed ${name}`).toHaveLength(1);
				artifacts[name] = `file:${join(target, tarballs[0])}`;
			}

			const consumer = join(sandbox, "consumer");
			mkdirSync(consumer);
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					private: true,
					type: "module",
					dependencies: {
						"@fluojs/websockets": artifacts["@fluojs/websockets"],
					},
					devDependencies: {
						typescript: "6.0.2",
						"@types/node": "22.19.15",
					},
					// Resolve only internal packages to this checkout's unmodified pnpm tarballs.
					pnpm: { overrides: artifacts },
				}),
			);
			writeFileSync(
				join(consumer, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						skipLibCheck: false,
						module: "NodeNext",
						moduleResolution: "NodeNext",
						types: ["node"],
						noEmit: true,
					},
					files: ["index.ts"],
				}),
			);
			writeFileSync(
				join(consumer, "index.ts"),
				`
import type { TypedOnMessageHandler, WebSocketGatewayContext } from '@fluojs/websockets/node';

export function sendPing(socket: WebSocketGatewayContext['socket']): void {
  socket.send('ping');
  // @ts-expect-error A real ws.WebSocket rejects unknown methods; any must fail this check.
  socket.nonexistentSocketMethod();
}

export const handler: TypedOnMessageHandler<{ ping: string }, 'ping'> = (_payload, socket) => {
  socket.send('ping');
  // @ts-expect-error The handler socket must also retain its ws.WebSocket type.
  socket.nonexistentSocketMethod();
};
`,
			);
			// Setup failures remain separate from the compiler assertion below.
			await execute(
				"pnpm",
				[
					"install",
					"--ignore-workspace",
					"--ignore-scripts",
					"--no-frozen-lockfile",
				],
				{ cwd: consumer, env: environment, timeout: commandTimeout },
			);

			await expect(execute(
				process.execPath,
				[
					join(consumer, "node_modules/typescript/bin/tsc"),
					"--noEmit",
					"-p",
					"tsconfig.json",
				],
				{ cwd: consumer, env: environment, timeout: commandTimeout },
			)).resolves.toEqual({ stdout: "", stderr: "" });

			const installed = JSON.parse(
				readFileSync(
					join(
						consumer,
						"node_modules/@fluojs/websockets/package.json",
					),
					"utf8",
				),
			);
			expect(installed.dependencies["@types/ws"]).toBe("^8.18.1");
			expect(installed.devDependencies).not.toHaveProperty("@types/ws");
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	},
	600_000,
);
