#!/usr/bin/env node

process.emitWarning(
  'The `konekti` command is a temporary compatibility alias. Use `fluo` as the canonical CLI command.',
  'DeprecationWarning',
);

const { runCli } = await import('../dist/cli.js');

process.exitCode = await runCli(process.argv.slice(2));
