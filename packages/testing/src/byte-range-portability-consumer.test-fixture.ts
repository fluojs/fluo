import {
  createByteRangeResponse,
  type ByteRangeResponseOptions,
  type ByteRangeResponseSource,
} from '@fluojs/http';
import {
  createHttpAdapterPortabilityHarness,
} from '@fluojs/testing/http-adapter-portability';
import {
  createWebRuntimeHttpAdapterPortabilityHarness,
} from '@fluojs/testing/web-runtime-adapter-portability';

const bytes = Uint8Array.from([0, 1, 2]);
const options: ByteRangeResponseOptions = { contentType: 'application/octet-stream' };
const source: ByteRangeResponseSource = bytes;

void createByteRangeResponse(source, options);
void createHttpAdapterPortabilityHarness;
void createWebRuntimeHttpAdapterPortabilityHarness;
