#!/usr/bin/env node

const { runCli } = await import('../dist/cli.js');

process.exitCode = await runCli(process.argv.slice(2));
