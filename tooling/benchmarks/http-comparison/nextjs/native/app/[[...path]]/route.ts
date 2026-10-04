import { readAppShape } from '../../../../dist/next-native/shared/app-shape.js';
import { nativeFetch } from '../../../../dist/next-native/shared/native-app.js';

export async function GET(request: Request) {
  return nativeFetch(readAppShape(process.env.BENCH_APP_SHAPE), request);
}
export const POST = GET;
