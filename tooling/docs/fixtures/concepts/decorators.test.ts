import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { AppModule } from './decorators-app';

it('uses explicit tokens and request DTO metadata through the real pipeline', async () => {
  const app = await Test.createApp({ rootModule: AppModule });
  try {
    const valid = await app.request('POST', '/messages').body({ text: 'hello' }).send();
    expect(valid.status).toBe(201);
    expect(valid.body).toEqual({ message: 'received: hello' });
    const invalid = await app.request('POST', '/messages').body({ text: 42 }).send();
    expect(invalid.status).toBe(400);
  } finally {
    await app.close();
  }
});
