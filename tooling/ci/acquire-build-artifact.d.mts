export function classifyAcquisitionFailure(input: { status?: number; text?: string }): { retry: boolean };
export function validateArtifactMetadata(metadata: unknown, expected: { id: number; name: string; runId: number; sha: string; digest: string }): true;
