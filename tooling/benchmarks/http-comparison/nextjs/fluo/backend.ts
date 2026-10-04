import { NextHttpApplicationAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';
import { readAppShape, resolveAppModule } from '../../dist/next-backend/shared/fluo-app.js';

export const adapter = NextHttpApplicationAdapter.create();
const app = await FluoFactory.create(resolveAppModule(readAppShape(process.env.BENCH_APP_SHAPE)), { adapter });
await app.listen();
