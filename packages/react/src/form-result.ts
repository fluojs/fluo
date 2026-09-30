/** HTTP-approved native destination and enhanced post-save read policy. */
export type ReactFormResultOptions = {
  readonly destination: string;
  readonly followUp: 'navigate' | 'refresh';
};

/** A confirmed mutation result carrying the existing HTTP-owned response writer. */
export type ReactFormResult = ReactFormResultOptions;
