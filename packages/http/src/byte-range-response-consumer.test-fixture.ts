import {
  createByteRangeResponse,
  type ByteRangeResponseOptions,
  type ByteRangeResponseSource,
  type FrameworkResponseStream,
  type StaticAssetAcceptedEncoding,
  type StaticAssetContentEncoding,
  type StaticAssetNotAcceptable,
  type StaticAssetResolveContext,
} from '@fluojs/http';
import {
  createByteRangeResponse as createPortableByteRangeResponse,
  type ByteRangeResponseOptions as PortableByteRangeResponseOptions,
  type ByteRangeResponseSource as PortableByteRangeResponseSource,
  type FrameworkResponseStream as PortableFrameworkResponseStream,
  type StaticAssetAcceptedEncoding as PortableStaticAssetAcceptedEncoding,
  type StaticAssetContentEncoding as PortableStaticAssetContentEncoding,
  type StaticAssetNotAcceptable as PortableStaticAssetNotAcceptable,
  type StaticAssetResolveContext as PortableStaticAssetResolveContext,
} from '@fluojs/http/portable';

const bytes = Uint8Array.from([0, 1, 2]);
const options: ByteRangeResponseOptions = { contentType: 'application/octet-stream' };
const source: ByteRangeResponseSource = bytes;
const portableOptions: PortableByteRangeResponseOptions = options;
const portableSource: PortableByteRangeResponseSource = source;

void createByteRangeResponse(source, options);
void createPortableByteRangeResponse(portableSource, portableOptions);

const acceptedEncoding: StaticAssetAcceptedEncoding = 'identity';
const contentEncoding: StaticAssetContentEncoding = 'br';
const notAcceptable: StaticAssetNotAcceptable = { notAcceptable: true };
const resolveContext: StaticAssetResolveContext = {
  acceptedEncodings: [acceptedEncoding],
};
const portableAcceptedEncoding: PortableStaticAssetAcceptedEncoding = acceptedEncoding;
const portableContentEncoding: PortableStaticAssetContentEncoding = contentEncoding;
const portableNotAcceptable: PortableStaticAssetNotAcceptable = notAcceptable;
const portableResolveContext: PortableStaticAssetResolveContext = resolveContext;
const stream = {} as FrameworkResponseStream;
const portableStream = {} as PortableFrameworkResponseStream;
const removeErrorListener = stream.onError?.((error) => {
  void error;
});
const removePortableErrorListener = portableStream.onError?.((error) => {
  void error;
});

void [
  acceptedEncoding,
  contentEncoding,
  notAcceptable,
  resolveContext,
  portableAcceptedEncoding,
  portableContentEncoding,
  portableNotAcceptable,
  portableResolveContext,
  removeErrorListener,
  removePortableErrorListener,
];
