import { readAppShape } from '../shared/app-shape';
import { nativeFetch } from '../shared/native-app';

export default {
  fetch(request: Request, env: { BENCH_APP_SHAPE: string; BENCH_CONFIGURATION: string }) {
    return nativeFetch(readAppShape(env.BENCH_APP_SHAPE), request, env.BENCH_CONFIGURATION);
  },
};
