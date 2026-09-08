export interface DocsKnowledgeIssue {
  readonly code: string;
  readonly path: string;
  readonly target?: string;
}

export interface DocsKnowledgeVerification {
  readonly documents: number;
  readonly issues: readonly DocsKnowledgeIssue[];
}

export function verifyDocsKnowledge(repoRoot: string): DocsKnowledgeVerification;
