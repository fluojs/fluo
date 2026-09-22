import { Inject, Scope } from '@fluojs/core';

export class AuditLog {
  entries: string[] = [];
}

@Scope('singleton')
@Inject(AuditLog)
export class PostsService {
  constructor(private readonly audit: AuditLog) {}

  list(): readonly string[] {
    return [...this.audit.entries];
  }

  create(title: string): string {
    this.audit.entries.push(`created: ${title}`);
    return title;
  }
}
