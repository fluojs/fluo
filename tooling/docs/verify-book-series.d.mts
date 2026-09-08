export interface BookIssue {
  readonly code: string;
  readonly path: string;
  readonly target?: string;
}

export interface BookVerification {
  readonly chapters: number;
  readonly locales: readonly string[];
  readonly issues: readonly BookIssue[];
}

export function verifyBookSeries(
  repoRoot: string,
  options?: { readonly locale?: 'ko' | 'both' },
): BookVerification;
