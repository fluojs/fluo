export function recordPreparedBuild(root: string, imageKey: string, directories?: readonly string[] | null, planDigest?: string | null): string;
export function verifyPreparedBuild(root: string, path: string | undefined, expectedDirectories?: readonly string[] | null, expectedPlanDigest?: string): boolean;
