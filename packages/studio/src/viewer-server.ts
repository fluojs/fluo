#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const viewerHost = '127.0.0.1';
const mimeTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Supported parsed command-line request for the packaged Studio viewer. */
export type StudioViewerRequest = { readonly kind: 'help' } | { readonly kind: 'launch'; readonly port: number };

/** Running local HTTP server for the packaged Studio viewer. */
export interface StudioViewerServer {
  readonly url: URL;
  close(): Promise<void>;
}

interface StudioViewerServerOptions {
  readonly port: number;
  readonly viewerDirectory: string;
}

/**
 * Parses command-line arguments for the packaged Studio viewer.
 *
 * @param arguments_ - Arguments passed after the viewer command name.
 * @returns A help or launch request.
 */
export function parseStudioViewerArguments(arguments_: readonly string[]): StudioViewerRequest {
  let port = 0;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    switch (argument) {
      case '--help':
      case '-h':
        return { kind: 'help' };
      case '--port': {
        const portArgument = arguments_[index + 1];

        if (portArgument === undefined) {
          throw new Error('Missing port after --port.');
        }

        port = parsePort(portArgument);
        index += 1;
        break;
      }
      default:
        throw new Error(`Unsupported viewer option: ${argument}`);
    }
  }

  return { kind: 'launch', port };
}

/**
 * Starts an HTTP server that serves the installed Studio viewer artifacts.
 *
 * @param options - Local server options and the packaged artifact directory.
 * @returns The running server and its local URL.
 */
export async function startStudioViewerServer(options: StudioViewerServerOptions): Promise<StudioViewerServer> {
  const viewerDirectory = resolve(options.viewerDirectory);
  const server = createServer((request, response) => {
    void serveViewerAsset(request.url, response, viewerDirectory);
  });

  await listen(server, options.port);
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Studio viewer did not bind to a TCP port.');
  }

  return {
    url: new URL(`http://${viewerHost}:${String(address.port)}/`),
    close: () => close(server),
  };
}

async function serveViewerAsset(requestUrl: string | undefined, response: import('node:http').ServerResponse, viewerDirectory: string): Promise<void> {
  const pathname = new URL(requestUrl ?? '/', `http://${viewerHost}`).pathname;
  const relativePath = pathname === '/' ? 'index.html' : `.${pathname}`;
  const assetPath = resolve(viewerDirectory, relativePath);

  if (!assetPath.startsWith(`${viewerDirectory}${sep}`)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const content = await readFile(assetPath);
    const mimeType = mimeTypes[extname(assetPath)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': mimeType }).end(content);
  } catch {
    response.writeHead(404).end();
  }
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: viewerHost, port }, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
        return;
      }

      rejectClose(error);
    });
  });
}

async function runStudioViewerCli(arguments_: readonly string[]): Promise<void> {
  const request = parseStudioViewerArguments(arguments_);

  switch (request.kind) {
    case 'help':
      process.stdout.write('Usage: fluo-studio-viewer [--port <0-65535>]\n');
      return;
    case 'launch': {
      const server = await startStudioViewerServer({
        port: request.port,
        viewerDirectory: fileURLToPath(new URL('.', import.meta.url)),
      });
      process.stdout.write(`Fluo Studio viewer: ${server.url.href}\nPress Ctrl+C to stop.\n`);
      return;
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runStudioViewerCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown Studio viewer launch error.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
