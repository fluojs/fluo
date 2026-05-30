export interface SocketIoCloseResult {
  readonly kind: 'closed' | 'forced';
  readonly timeoutError?: SocketIoShutdownTimeoutError;
}

export interface SocketIoCloseTarget {
  close(callback?: () => void): unknown;
  disconnectSockets?: (close?: boolean) => unknown;
  httpServer?: unknown;
}

export class SocketIoShutdownTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out while closing Socket.IO server after ${String(timeoutMs)}ms.`);
    this.name = 'SocketIoShutdownTimeoutError';
  }
}

function detachAdapterOwnedHttpServer(io: SocketIoCloseTarget): void {
  io.httpServer = undefined;
}

function forceDisconnectManagedClients(io: SocketIoCloseTarget): void {
  io.disconnectSockets?.(true);
}

export function closeSocketIoServerWithTimeout(io: SocketIoCloseTarget, timeoutMs: number): Promise<SocketIoCloseResult> {
  return new Promise<SocketIoCloseResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      const timeoutError = new SocketIoShutdownTimeoutError(timeoutMs);

      try {
        forceDisconnectManagedClients(io);
      } catch (error) {
        settled = true;
        reject(error);
        return;
      }

      settled = true;
      resolve({ kind: 'forced', timeoutError });
    }, timeoutMs);

    detachAdapterOwnedHttpServer(io);

    try {
      io.close(() => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve({ kind: 'closed' });
      });
    } catch (error) {
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }
  });
}
