interface NodeMemoryUsageSnapshot {
  arrayBuffers: number;
  external: number;
  heapTotal: number;
  heapUsed: number;
  rss: number;
}

type NodeMemoryUsageSampler = () => NodeMemoryUsageSnapshot;

interface NodeProcessLike {
  memoryUsage?: NodeMemoryUsageSampler;
}

interface NodeGlobalLike {
  process?: NodeProcessLike;
}

function resolveNodeProcess(): NodeProcessLike | undefined {
  const runtimeGlobal: NodeGlobalLike = globalThis;

  return runtimeGlobal.process;
}

/** Read Node.js process memory usage through the Terminus Node runtime seam. */
export function readNodeMemoryUsage(): NodeMemoryUsageSnapshot {
  const memoryUsage = resolveNodeProcess()?.memoryUsage;

  if (typeof memoryUsage !== 'function') {
    throw new Error('Node.js process.memoryUsage() is not available in this runtime.');
  }

  return memoryUsage();
}
