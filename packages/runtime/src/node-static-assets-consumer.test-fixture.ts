import {
  createNodeFileSystemAssetSource,
  type NodeFileSystemAssetPrecompression,
  type NodeFileSystemAssetSourceOptions,
} from '@fluojs/runtime/node';

const precompressed: NodeFileSystemAssetPrecompression = {
  brotli: true,
  gzip: false,
};
const options: NodeFileSystemAssetSourceOptions = {
  precompressed,
  root: '/srv/assets',
};

void createNodeFileSystemAssetSource(options);
