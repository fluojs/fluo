import { AuthModule, UseAuth } from '@fluojs/auth-http';
import { PassportModule } from '@fluojs/passport';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';
import { AuthModule as GuideApplication } from './passport-guide-app.js';

describe('canonical HTTP authentication guide composition', () => {
  it('runs custom HTTP authentication through the canonical adapter registry', async () => {
    const app = await Test.createApp({ rootModule: GuideApplication });

    try {
      const response = await app.request('GET', '/service').header('x-api-key', 'guide-service-key').send();

      expect(response).toMatchObject({ status: 200, body: { caller: 'service-1' } });
      expect(AuthModule).toBe(PassportModule);
      expect(typeof UseAuth).toBe('function');
    } finally {
      await app.close();
    }
  });
});
