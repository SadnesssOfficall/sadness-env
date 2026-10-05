import { readFileSync, statSync } from 'node:fs';
import { EnvFileError } from './errors.js';

export const MAX_FILE_BYTES = 1024 * 1024;

const READ_FAILURES: Readonly<Record<string, string>> = {
  ENOENT: 'file not found',
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EISDIR: 'is a directory',
};

function failure(path: string, error: unknown): EnvFileError {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  return new EnvFileError(
    `cannot read ${path}: ${READ_FAILURES[code] ?? (code || 'unknown error')}`,
  );
}

export function readTextFile(path: string): string {
  let content: Buffer;
  try {
    if (!statSync(path).isFile()) throw new EnvFileError(`cannot read ${path}: not a regular file`);
    content = readFileSync(path);
  } catch (error) {
    throw error instanceof EnvFileError ? error : failure(path, error);
  }
  if (content.byteLength > MAX_FILE_BYTES) {
    throw new EnvFileError(`cannot read ${path}: file is larger than ${MAX_FILE_BYTES} bytes`);
  }
  return content.toString('utf8');
}
