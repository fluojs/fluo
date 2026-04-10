import { describe, expect, it } from 'vitest';

import type { CallHandler, InterceptorContext } from '@fluojs/http';

import { Exclude } from './decorators/exclude.js';
import { SerializerInterceptor } from './serializer-interceptor.js';

describe('SerializerInterceptor', () => {
  it('serializes class instance responses with metadata', async () => {
    class UserView {
      id: string;

      @Exclude()
      password: string;

      constructor(id: string, password: string) {
        this.id = id;
        this.password = password;
      }
    }

    const interceptor = new SerializerInterceptor();
    const context = {} as InterceptorContext;
    const next: CallHandler = {
      async handle() {
        return new UserView('u-1', 'secret');
      },
    };

    await expect(interceptor.intercept(context, next)).resolves.toEqual({ id: 'u-1' });
  });
});
