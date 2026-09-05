import {
  createNodeFileSystemAssetSource,
  type NodeFileSystemAssetPrecompression,
  type NodeFileSystemAssetSourceOptions,
} from '@fluojs/platform-nodejs';

const precompressed: NodeFileSystemAssetPrecompression = {
  brotli: true,
  gzip: false,
};
const options: NodeFileSystemAssetSourceOptions = {
  precompressed,
  root: '/srv/assets',
};

void createNodeFileSystemAssetSource(options);
