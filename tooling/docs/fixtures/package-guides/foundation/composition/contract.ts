import { publicToken } from '@fluojs/core';

/**
 * Cross-package composition contract: the validated config snapshot flows
 * through a DI factory provider into this typed public token, and the i18n
 * controller reads it as its default request locale.
 */
export const WELCOME_LOCALE = publicToken<string>('docs-foundation/composition/welcome-locale/v1');
