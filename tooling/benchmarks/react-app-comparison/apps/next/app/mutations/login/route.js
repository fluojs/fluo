import { authenticate, SESSION_COOKIE, SESSION_VALUE } from '../../../../../fixture/domain.mjs';
import { postRedirect, rejected } from '../../../lib/responses';

export async function POST(request) {
  const form = await request.formData();
  if (!authenticate(form.get('username'), form.get('password'))) {
    return rejected(401, 'Invalid credentials');
  }
  return postRedirect(
    '/admin/products',
    `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
  );
}
