import {
  createByteRangeResponse,
  type ByteRangeResponseOptions,
  type ByteRangeResponseSource,
} from '@fluojs/http';
import {
  createByteRangeResponse as createPortableByteRangeResponse,
  type ByteRangeResponseOptions as PortableByteRangeResponseOptions,
  type ByteRangeResponseSource as PortableByteRangeResponseSource,
} from '@fluojs/http/portable';

const bytes = Uint8Array.from([0, 1, 2]);
const options: ByteRangeResponseOptions = { contentType: 'application/octet-stream' };
const source: ByteRangeResponseSource = bytes;
const portableOptions: PortableByteRangeResponseOptions = options;
const portableSource: PortableByteRangeResponseSource = source;

void createByteRangeResponse(source, options);
void createPortableByteRangeResponse(portableSource, portableOptions);
