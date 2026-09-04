#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStudioViewerCli } from './viewer-server.js';

const viewerDirectory = dirname(fileURLToPath(import.meta.url));

void runStudioViewerCli(process.argv.slice(2), viewerDirectory).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown Studio viewer launch error.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
