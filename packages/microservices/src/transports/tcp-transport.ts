import { createServer, Socket } from 'node:net';

import type { MicroserviceTransport, TransportHandler, TransportPacket } from '../types.js';

interface WireResponse {
  error?: string;
  payload?: unknown;
  requestId: string;
}

interface TcpMicroserviceTransportOptions {
  host?: string;
  port: number;
  requestTimeoutMs?: number;
}

/**
 * Lightweight TCP transport for request-response messages and fire-and-forget events.
 *
 * This adapter uses newline-delimited JSON frames over raw sockets and is intended for
 * simple first-party microservice setups where both sides can share the same framing contract.
 */
export class TcpMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private listenPromise: Promise<void> | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly host: string;
  private readonly requestTimeoutMs: number;
  private readonly server = createServer((socket) => {
    this.sockets.add(socket);
    this.bindSocketParser<TransportPacket>(socket, async (packet) => this.handleInboundPacket(socket, packet));
    socket.once('close', () => this.sockets.delete(socket));
  });

  /**
   * Creates a TCP transport bound to one host/port pair.
   *
   * @param options TCP host, port, and request-timeout settings.
   */
  constructor(private readonly options: TcpMicroserviceTransportOptions) {
    this.host = options.host ?? '127.0.0.1';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
  }

  /**
   * Starts the TCP server and registers the runtime packet handler.
   *
   * @param handler Runtime callback invoked for inbound event and message packets.
   * @returns A promise that resolves once the TCP server is listening.
   */
  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;

    if (this.server.listening) {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  /**
   * Emits one fire-and-forget event over the TCP transport.
   *
   * @param pattern Pattern identifying the remote event handler.
   * @param payload Serializable payload sent to the remote runtime.
   * @returns A promise that resolves after the event frame is written.
   */
  async emit(pattern: string, payload: unknown): Promise<void> {
    await this.sendWirePacket({ kind: 'event', pattern, payload });
  }

  /**
   * Sends one request-response message over the TCP transport.
   *
   * @param pattern Pattern identifying the remote message handler.
   * @param payload Serializable request payload.
   * @param signal Optional abort signal used to cancel the request.
   * @returns The remote handler response payload.
   */
  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestId = randomRequestId();
    return await this.sendWirePacket({ kind: 'message', pattern, payload, requestId }, signal);
  }

  /**
   * Closes the TCP server and destroys any active sockets.
   *
   * @returns A promise that resolves once the server is fully closed.
   */
  async close(): Promise<void> {
    if (this.listenPromise) {
      await this.listenPromise;
    }

    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();

    if (!this.server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleInboundPacket(socket: Socket, packet: TransportPacket): Promise<void> {
    if (!this.handler) {
      return;
    }

    if (packet.kind === 'event') {
      await this.handler(packet);
      return;
    }

    const requestId = packet.requestId;

    if (!requestId) {
      return;
    }

    try {
      const payload = await this.handler(packet);
      this.writeLine(socket, JSON.stringify({ payload, requestId } satisfies WireResponse));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unhandled microservice error';
      this.writeLine(socket, JSON.stringify({ error: message, requestId } satisfies WireResponse));
    }
  }

  private async sendWirePacket(packet: TransportPacket, signal?: AbortSignal): Promise<unknown> {
    return await new Promise<unknown>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }

        socket.removeAllListeners();
      };

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback();
      };

      const fail = (error: unknown) => {
        settle(() => {
          socket.destroy();
          reject(error);
        });
      };

      if (signal) {
        if (signal.aborted) {
          fail(new Error('Microservice send aborted before dispatch.'));
          return;
        }

        onAbort = () => {
          fail(new Error('Microservice send aborted.'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        fail(new Error(`Microservice TCP request timed out after ${String(this.requestTimeoutMs)}ms.`));
      }, this.requestTimeoutMs);

      if (packet.kind === 'event') {
        socket.once('connect', () => {
          this.writeLine(socket, JSON.stringify(packet));
          settle(() => {
            socket.end();
            resolve(undefined);
          });
        });
      } else {
        this.bindSocketParser<WireResponse>(socket, (value) => {
          const response = value as WireResponse;

          if (response.requestId !== packet.requestId) {
            return;
          }

          if (response.error) {
            fail(new Error(response.error));
            return;
          }

          settle(() => {
            socket.end();
            resolve(response.payload);
          });
        });

        socket.once('connect', () => {
          this.writeLine(socket, JSON.stringify(packet));
        });
      }

      socket.once('error', fail);
      socket.connect(this.options.port, this.host);
    });
  }

  private bindSocketParser<TPacket>(socket: Socket, onPacket: (packet: TPacket) => void): void {
    let buffer = '';

    socket.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let newLineIndex = buffer.indexOf('\n');

      while (newLineIndex >= 0) {
        const line = buffer.slice(0, newLineIndex).trim();
        buffer = buffer.slice(newLineIndex + 1);

        if (line.length > 0) {
          try {
            void Promise.resolve(onPacket(JSON.parse(line) as TPacket)).catch(() => undefined);
          } catch {
            return;
          }
        }

        newLineIndex = buffer.indexOf('\n');
      }
    });
  }

  private writeLine(socket: Socket, line: string): void {
    socket.write(`${line}\n`);
  }
}

function randomRequestId(): string {
  return Math.random().toString(36).slice(2, 14);
}
