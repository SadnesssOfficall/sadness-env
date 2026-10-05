import { formatIssue, type Issue } from './issues.js';

export class EnvFileError extends Error {
  override name = 'EnvFileError';
}

export class SchemaError extends Error {
  override name = 'SchemaError';
}

export class EnvValidationError extends Error {
  override name = 'EnvValidationError';

  constructor(readonly issues: readonly Issue[]) {
    super(
      `Invalid environment:\n${issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `  - ${formatIssue(issue)}`)
        .join('\n')}`,
    );
  }
}
