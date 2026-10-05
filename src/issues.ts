export type IssueCode = 'syntax' | 'duplicate' | 'missing' | 'invalid' | 'unknown';

export interface Issue {
  severity: 'error' | 'warning';
  code: IssueCode;
  message: string;
  key?: string;
  file?: string;
  line?: number;
}

export function locate(issue: Issue): string {
  const position = [issue.file, issue.line].filter((part) => part !== undefined).join(':');
  if (issue.key === undefined) return position;
  return position === '' ? issue.key : `${issue.key} (${position})`;
}

export function formatIssue(issue: Issue): string {
  const subject = locate(issue);
  return subject === '' ? issue.message : `${subject}: ${issue.message}`;
}
