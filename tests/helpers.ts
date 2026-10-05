import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import { run } from '../src/cli/main.js';

const workspaces: string[] = [];

afterEach(() => {
  for (const directory of workspaces.splice(0)) rmSync(directory, { recursive: true, force: true });
});

export function workspace(files: Record<string, string> = {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'sadness-env-'));
  workspaces.push(directory);
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}

export function cli(args: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const code = run(args, {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    cwd,
    env,
  });
  return { code, stdout, stderr };
}
