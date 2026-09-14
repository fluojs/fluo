export function classifyAcquisitionFailure(input: { status?: number; text?: string }): { retry: boolean };
export function validateArtifactMetadata(metadata: unknown, expected: { id: number; name: string; runId: number; sha: string; digest: string }): true;
export function acquireBuildArtifact(input: {
  readonly fetch: (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  readonly expected: { readonly id: number; readonly name: string; readonly runId: number; readonly sha: string; readonly digest: string; readonly metadataUrl: string; readonly downloadUrl: string };
  readonly outputPath: string;
  readonly attempts?: number;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}): Promise<{ readonly attempt: number; readonly digest: string; readonly elapsedMs: number; readonly outputPath: string }>;
export function main(argv?: readonly string[], dependencies?: {
  readonly downloadUrl?: string;
  readonly extract?: (archivePath: string, outputDirectory: string) => void;
  readonly fetch?: (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  readonly metadataUrl?: string;
  readonly repository?: string;
  readonly writeOutput?: (value: string) => unknown;
}): Promise<void>;
