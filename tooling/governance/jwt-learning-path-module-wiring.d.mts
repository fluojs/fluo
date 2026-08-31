export type JwtLearningPathReadText = (relativePath: string) => string;

/**
 * Enforces the executable Chapter 14 JWT module graph across EN/KO documents.
 */
export declare function enforceJwtLearningPathModuleWiring(
  readText?: JwtLearningPathReadText,
): void;
