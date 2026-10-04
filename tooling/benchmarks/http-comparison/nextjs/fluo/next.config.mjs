import { fileURLToPath } from 'node:url';
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';
export default withFluoNextBackend({
  turbopack: { root: fileURLToPath(new URL('../../../../../', import.meta.url)) },
});
