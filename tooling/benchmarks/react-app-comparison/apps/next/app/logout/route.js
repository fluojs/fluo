import { SESSION_COOKIE } from '../../../../fixture/domain.mjs';
import { postRedirect } from '../../lib/responses';

export function POST() {
  return postRedirect('/products', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
