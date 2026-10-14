import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';

import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';

import { EmailMessageValidationError } from '../errors.js';
import type { NormalizedEmailMessage } from '../types.js';
import { NodemailerEmailTransport } from './node.js';

async function createSmtpBoundary(greeting = '220 fluo SMTP ready') {
  const messages: string[] = [];
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const closed: Promise<unknown>[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    closed.push(once(socket, 'close', { signal: AbortSignal.timeout(5000) }));
    socket.setEncoding('utf8');
    socket.write(`${greeting}\r\n`);
    let input = '';
    let data: string[] | undefined;
    let acceptedRecipients = 0;
    socket.on('data', (chunk: string) => {
      input += chunk;
      let end = input.indexOf('\r\n');
      while (end >= 0) {
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = undefined;
            socket.write('250 queued fluo-message\r\n');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
        } else {
          commands.push(line);
          if (line.startsWith('EHLO')) {
            socket.write('250-fluo\r\n250 PIPELINING\r\n');
          } else if (line.startsWith('MAIL FROM:')) {
            acceptedRecipients = 0;
            socket.write('250 OK\r\n');
          } else if (line.startsWith('RCPT TO:') && line.includes('reject@example.com')) {
            socket.write('550 recipient refused\r\n');
          } else if (line.startsWith('RCPT TO:')) {
            acceptedRecipients += 1;
            socket.write('250 OK\r\n');
          } else if (line === 'DATA') {
            if (acceptedRecipients > 0) {
              data = [];
              socket.write('354 send message\r\n');
            } else {
              socket.write('554 no valid recipients\r\n');
            }
          } else if (line === 'QUIT') {
            socket.end('221 bye\r\n');
          } else {
            socket.write('250 OK\r\n');
          }
        }
        end = input.indexOf('\r\n');
      }
    });
  });
  const listening = once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP boundary has no TCP address.');

  return {
    commands,
    messages,
    closed,
    sockets,
    smtp: { host: '127.0.0.1', port: address.port, secure: false, ignoreTLS: true },
    async cleanup() {
      for (const socket of sockets) socket.destroy();
      await Promise.all(closed);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function createMessage(): NormalizedEmailMessage {
  return {
    from: { address: 'from@example.com', name: 'Sender, Support' },
    to: [{ address: 'to@example.com', name: 'Recipient, Team' }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'SMTP boundary',
    text: 'Hello from fluo',
    attachments: [{ filename: 'payload.txt', content: new Uint8Array([1, 2, 3]), contentType: 'application/octet-stream' }],
  };
}

describe('Nodemailer real SMTP boundary', () => {
  it('verifies and sends structured addresses and attachments through a caller-owned transporter', async () => {
    const boundary = await createSmtpBoundary();
    const transporter = nodemailer.createTransport(boundary.smtp);
    const transport = NodemailerEmailTransport.create({ transporter });

    try {
      await transport.verify();
      const receipt = await transport.send(createMessage(), {});

      expect(receipt).toMatchObject({
        accepted: ['to@example.com'],
        rejected: [],
        pending: [],
        response: '250 queued fluo-message',
        metadata: { envelope: { from: 'from@example.com', to: ['to@example.com'] } },
      });
      expect(receipt.messageId).toMatch(/^<.+@.+>$/);
      expect(boundary.messages).toHaveLength(1);
      expect(boundary.messages[0]).toContain('From: "Sender, Support" <from@example.com>');
      expect(boundary.messages[0]).toContain('To: "Recipient, Team" <to@example.com>');
      expect(boundary.messages[0]).toContain('Hello from fluo');
      expect(boundary.messages[0]).toContain('filename=payload.txt');
      expect(boundary.messages[0]).toContain('AQID');
      expect(boundary.commands.filter((command) => command.startsWith('EHLO'))).toHaveLength(2);
    } finally {
      transporter.close();
      await boundary.cleanup();
    }
  });

  it('keeps rejected recipients separate from accepted recipients at the real SMTP seam', async () => {
    const boundary = await createSmtpBoundary();
    const transporter = nodemailer.createTransport(boundary.smtp);
    const transport = NodemailerEmailTransport.create({ transporter });

    try {
      const receipt = await transport.send({ ...createMessage(), to: [{ address: 'to@example.com' }, { address: 'reject@example.com' }] }, {});

      expect(receipt).toMatchObject({ accepted: ['to@example.com'], pending: [], rejected: ['reject@example.com'] });
    } finally {
      transporter.close();
      await boundary.cleanup();
    }
  });

  it('preserves provider errors when every SMTP recipient is rejected', async () => {
    const boundary = await createSmtpBoundary();
    const transporter = nodemailer.createTransport(boundary.smtp);
    const transport = NodemailerEmailTransport.create({ transporter });

    try {
      await expect(transport.send({ ...createMessage(), to: [{ address: 'reject@example.com' }] }, {}))
        .rejects.toMatchObject({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' });
      expect(boundary.messages).toEqual([]);
    } finally {
      transporter.close();
      await boundary.cleanup();
    }
  });

  it.each([
    { address: 'from@example.com\r\nBcc: attacker@example.com' },
    { address: 'from@example.com', name: 'Sender\nBcc: attacker@example.com' },
  ])('rejects newline address parts before a real transporter opens a connection: %j', async (from) => {
    const boundary = await createSmtpBoundary();
    const transporter = nodemailer.createTransport(boundary.smtp);
    const transport = NodemailerEmailTransport.create({ transporter });

    try {
      await expect(transport.send({ ...createMessage(), from }, {})).rejects.toBeInstanceOf(EmailMessageValidationError);
      expect(boundary.sockets.size).toBe(0);
    } finally {
      transporter.close();
      await boundary.cleanup();
    }
  });

  it('forwards verify errors from the real SMTP provider', async () => {
    const boundary = await createSmtpBoundary('421 service unavailable');
    const transporter = nodemailer.createTransport(boundary.smtp);
    const transport = NodemailerEmailTransport.create({ transporter });

    try {
      await expect(transport.verify()).rejects.toMatchObject({ responseCode: 421, command: 'CONN' });
    } finally {
      transporter.close();
      await boundary.cleanup();
    }
  });

  it('closes factory-owned pooled SMTP connections through the adapter close boundary', async () => {
    const boundary = await createSmtpBoundary();
    const factory = NodemailerEmailTransport.createFactory({ smtp: { ...boundary.smtp, pool: true } });
    const transport = await factory.create();

    try {
      await transport.send(createMessage(), {});
      expect(factory.ownsResources).toBe(true);
      expect(boundary.sockets.size).toBe(1);

      await transport.close?.();
      await Promise.all(boundary.closed);
      expect([...boundary.sockets].every((socket) => socket.destroyed)).toBe(true);
    } finally {
      await transport.close?.();
      await boundary.cleanup();
    }
  });
});
