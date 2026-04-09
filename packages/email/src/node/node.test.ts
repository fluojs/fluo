import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

const nodemailerState = vi.hoisted(() => ({
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: nodemailerState.createTransport,
  },
}));

import type { NormalizedEmailMessage } from '../types.js';
import * as nodePublicApi from './node.js';
import {
  NodemailerEmailTransport,
  createNodemailerEmailTransport,
  createNodemailerEmailTransportFactory,
} from './node.js';

function createMessage(): NormalizedEmailMessage {
  return {
    attachments: [
      {
        content: new Uint8Array([1, 2, 3]),
        contentType: 'text/plain',
        filename: 'payload.txt',
      },
    ],
    bcc: [{ address: 'bcc@example.com' }],
    cc: [{ address: 'cc@example.com', name: 'Copy' }],
    from: { address: 'from@example.com', name: 'Sender' },
    headers: { 'x-konekti-template': 'welcome' },
    html: '<p>Hello</p>',
    metadata: { ignoredByProvider: true },
    replyTo: [{ address: 'reply@example.com' }],
    subject: 'Subject',
    text: 'Hello',
    to: [{ address: 'to@example.com', name: 'Recipient' }],
  };
}

describe('@konekti/email/node', () => {
  it('exposes the explicit Node-only Nodemailer seam', () => {
    expect(nodePublicApi).toHaveProperty('NodemailerEmailTransport');
    expect(nodePublicApi).toHaveProperty('createNodemailerEmailTransport');
    expect(nodePublicApi).toHaveProperty('createNodemailerEmailTransportFactory');
  });

  it('wraps an existing Nodemailer transporter without changing the root transport contract', async () => {
    const sendMail = vi.fn().mockResolvedValue({
      accepted: ['to@example.com'],
      envelope: { from: 'from@example.com', to: ['to@example.com'] },
      messageId: 'node-1',
      pending: ['pending@example.com'],
      rejected: ['rejected@example.com'],
      response: '250 queued',
    });
    const verify = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    const transport = createNodemailerEmailTransport({
      transporter: {
        close,
        sendMail,
        verify,
      } as never,
    });

    expect(transport).toBeInstanceOf(NodemailerEmailTransport);

    const result = await transport.send(createMessage(), {});

    expect(result).toEqual({
      accepted: ['to@example.com'],
      messageId: 'node-1',
      metadata: { envelope: { from: 'from@example.com', to: ['to@example.com'] } },
      pending: ['pending@example.com'],
      rejected: ['rejected@example.com'],
      response: '250 queued',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            content: Buffer.from([1, 2, 3]),
            contentType: 'text/plain',
            filename: 'payload.txt',
          }),
        ],
        bcc: ['bcc@example.com'],
        cc: ['Copy <cc@example.com>'],
        from: 'Sender <from@example.com>',
        headers: { 'x-konekti-template': 'welcome' },
        html: '<p>Hello</p>',
        replyTo: ['reply@example.com'],
        subject: 'Subject',
        text: 'Hello',
        to: ['Recipient <to@example.com>'],
      }),
    );

    await transport.verify?.();
    await transport.close?.();

    expect(verify).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('creates and owns the Nodemailer transporter only through the node subpath factory helper', async () => {
    const sendMail = vi.fn().mockResolvedValue({
      accepted: ['user@example.com'],
      messageId: 'smtp-1',
      pending: [],
      rejected: [],
      response: '250 delivered',
    });
    const verify = vi.fn().mockResolvedValue(true);
    const close = vi.fn();

    nodemailerState.createTransport.mockReset();
    nodemailerState.createTransport.mockReturnValue({
      close,
      sendMail,
      verify,
    });

    const factory = createNodemailerEmailTransportFactory({
      kind: 'smtp:transactional',
      smtp: {
        auth: { pass: 'secret', user: 'mailer' },
        host: 'smtp.example.com',
        port: 587,
        secure: false,
      },
    });
    const transport = await factory.create();
    const result = await transport.send(
      {
        bcc: [],
        cc: [],
        from: { address: 'noreply@example.com' },
        replyTo: [],
        subject: 'Node helper',
        text: 'hello',
        to: [{ address: 'user@example.com' }],
      },
      {},
    );

    await transport.verify?.();
    await transport.close?.();

    expect(factory.kind).toBe('smtp:transactional');
    expect(factory.ownsResources).toBe(true);
    expect(result).toMatchObject({
      accepted: ['user@example.com'],
      messageId: 'smtp-1',
    });
    expect(nodemailerState.createTransport).toHaveBeenCalledWith({
      auth: { pass: 'secret', user: 'mailer' },
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
