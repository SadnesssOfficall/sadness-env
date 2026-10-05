import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli, workspace } from './helpers.js';

const SCHEMA = JSON.stringify({
  variables: {
    PORT: { type: 'port', default: 3000 },
    DATABASE_URL: { type: 'url', secret: true },
    JWT_SECRET: { type: 'string', minLength: 16 },
  },
});
const SECRET_URL = 'postgres://app:p4ssw0rd-LEAK@db/app';

describe('top level', () => {
  it('prints help and exits 0', () => {
    const result = cli(['--help'], workspace());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('sadness-env check');
  });

  it('prints help for a subcommand', () => {
    expect(cli(['check', '--help'], workspace()).code).toBe(0);
  });

  it('prints the package version', () => {
    expect(cli(['--version'], workspace()).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('exits 2 with usage when called without a command', () => {
    const result = cli([], workspace());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });

  it('exits 2 for unknown commands and options', () => {
    expect(cli(['bogus'], workspace())).toMatchObject({ code: 2 });
    const result = cli(['check', '--nope'], workspace());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('sadness-env:');
  });
});

describe('check', () => {
  it('passes a valid file', () => {
    const dir = workspace({
      '.env': `DATABASE_URL=${SECRET_URL}\nJWT_SECRET=0123456789abcdef`,
      'env.schema.json': SCHEMA,
    });
    const result = cli(['check'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok (3 variables checked)');
  });

  it('exits 1 and lists problems without printing any secret value', () => {
    const dir = workspace({
      '.env': `DATABASE_URL=${SECRET_URL}x\nJWT_SECRET=short-secret-LEAK\nPORT=70000`,
      'env.schema.json': JSON.stringify({
        variables: {
          PORT: { type: 'port' },
          DATABASE_URL: { type: 'url', protocols: ['mysql'], secret: true },
          JWT_SECRET: { type: 'string', minLength: 32 },
        },
      }),
    });
    const result = cli(['check'], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('PORT: must be an integer between 1 and 65535 (got "70000")');
    expect(result.stdout).toContain('DATABASE_URL: protocol must be one of: mysql');
    expect(result.stdout).toContain('3 errors');
    expect(result.stdout + result.stderr).not.toContain('LEAK');
  });

  it('writes machine-readable output with --json and never includes values', () => {
    const dir = workspace({
      '.env': 'JWT_SECRET=tiny-LEAK',
      'env.schema.json': SCHEMA,
    });
    const result = cli(['check', '--json'], dir);
    const report = JSON.parse(result.stdout) as { ok: boolean; schema: string; issues: unknown[] };
    expect(result.code).toBe(1);
    expect(report).toMatchObject({ ok: false, schema: 'env.schema.json' });
    expect(report.issues).toHaveLength(2);
    expect(result.stdout).not.toContain('LEAK');
  });

  it('checks several files in order and reports the names the user typed', () => {
    const dir = workspace({
      '.env': 'DATABASE_URL=postgres://h/db',
      '.env.production': 'JWT_SECRET=0123456789abcdef\nbroken',
      'env.schema.json': SCHEMA,
    });
    const result = cli(['check', '-f', '.env', '-f', '.env.production'], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('.env, .env.production');
    expect(result.stdout).toContain('.env.production:2: expected KEY=value');
  });

  it('falls back to the keys of .env.example when no schema exists', () => {
    const dir = workspace({ '.env.example': 'A=\nB=\n', '.env': 'A=1\nC=3' });
    const result = cli(['check', '--json'], dir);
    const report = JSON.parse(result.stdout) as {
      schema: string;
      issues: { code: string; key: string }[];
    };
    expect(result.code).toBe(1);
    expect(report.schema).toBe('.env.example');
    expect(report.issues.map((issue) => `${issue.code}:${issue.key}`).sort()).toEqual([
      'missing:B',
      'unknown:C',
    ]);
  });

  it('does not use .env.example as the schema for itself', () => {
    const dir = workspace({ '.env.example': 'A=\n' });
    const result = cli(['check', '-f', '.env.example'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('syntax only');
  });

  it('only checks syntax when nothing describes the variables', () => {
    const dir = workspace({ '.env': 'A=1\n=oops' });
    expect(cli(['check'], dir).code).toBe(1);
    expect(cli(['check'], workspace({ '.env': 'A=1' })).code).toBe(0);
  });

  it('turns undeclared variables into errors with --strict', () => {
    const dir = workspace({
      '.env': `DATABASE_URL=${SECRET_URL}\nJWT_SECRET=0123456789abcdef\nEXTRA=1`,
      'env.schema.json': SCHEMA,
    });
    expect(cli(['check'], dir).code).toBe(0);
    expect(cli(['check', '--strict'], dir).code).toBe(1);
  });

  it('reads declared variables from the process environment with --process-env', () => {
    const dir = workspace({ '.env': 'PORT=3000', 'env.schema.json': SCHEMA });
    expect(cli(['check'], dir).code).toBe(1);
    const env = { DATABASE_URL: SECRET_URL, JWT_SECRET: '0123456789abcdef', PATH: '/bin' };
    const result = cli(['check', '--process-env'], dir, env);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('PATH');
  });

  it('exits 2 for a missing env file, a broken schema and unexpected arguments', () => {
    expect(cli(['check'], workspace({ 'env.schema.json': SCHEMA }))).toMatchObject({ code: 2 });
    const badJson = workspace({ '.env': 'A=1', 'env.schema.json': '{nope' });
    expect(cli(['check'], badJson).stderr).toContain('not valid JSON');
    const badSchema = workspace({
      '.env': 'A=1',
      'env.schema.json': '{"variables":{"A":{"type":"port","default":0}}}',
    });
    expect(cli(['check'], badSchema)).toMatchObject({ code: 2 });
    expect(cli(['check', 'extra'], workspace({ '.env': 'A=1' })).code).toBe(2);
  });

  it('accepts a schema from a custom path', () => {
    const dir = workspace({
      '.env': `DATABASE_URL=${SECRET_URL}\nJWT_SECRET=0123456789abcdef`,
      'config/schema.json': SCHEMA,
    });
    expect(cli(['check', '--schema', 'config/schema.json'], dir).code).toBe(0);
  });
});

describe('generate', () => {
  it('writes .env.example from the schema', () => {
    const dir = workspace({ 'env.schema.json': SCHEMA });
    const result = cli(['generate'], dir);
    expect(result.code).toBe(0);
    const content = readFileSync(join(dir, '.env.example'), 'utf8');
    expect(content).toContain('PORT=3000');
    expect(content).toContain('DATABASE_URL=\n');
  });

  it('writes from an env file without any values', () => {
    const dir = workspace({ '.env': `TOKEN=abc123-LEAK\nDATABASE_URL=${SECRET_URL}` });
    expect(cli(['generate'], dir).code).toBe(0);
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toBe('TOKEN=\nDATABASE_URL=\n');
  });

  it('refuses to overwrite an existing file unless forced', () => {
    const dir = workspace({ '.env': 'A=1', '.env.example': 'KEEP=me\n' });
    const refused = cli(['generate'], dir);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--force');
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toBe('KEEP=me\n');
    expect(cli(['generate', '--force'], dir).code).toBe(0);
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toBe('A=\n');
  });

  it('can never overwrite the file it reads from', () => {
    const dir = workspace({ '.env': 'SECRET_TOKEN=keep-LEAK' });
    const result = cli(['generate', '--out', '.env', '--force'], dir);
    expect(result.code).toBe(2);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('SECRET_TOKEN=keep-LEAK');
  });

  it('prints to stdout without touching the disk', () => {
    const dir = workspace({ '.env': 'A=1' });
    const result = cli(['generate', '--stdout'], dir);
    expect(result.stdout).toBe('A=\n');
    expect(existsSync(join(dir, '.env.example'))).toBe(false);
  });

  it('refuses to generate from a file with syntax errors', () => {
    const dir = workspace({ '.env': 'A=1\nB="open' });
    const result = cli(['generate', '--stdout'], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('open');
  });

  it('rejects conflicting sources', () => {
    const dir = workspace({ 'env.schema.json': SCHEMA, '.env': 'A=1' });
    expect(cli(['generate', '--schema', 'env.schema.json', '--from', '.env'], dir).code).toBe(2);
  });

  it('produces a file that passes check against the same schema', () => {
    const dir = workspace({ 'env.schema.json': SCHEMA });
    cli(['generate'], dir);
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${SECRET_URL}\nJWT_SECRET=0123456789abcdef\n`);
    expect(cli(['check', '--strict'], dir).code).toBe(0);
  });
});

describe('diff', () => {
  const files = {
    'a.env': 'KEEP=1\nGONE=x\nMODE=dev\nAPI_TOKEN=old-LEAK\n',
    'b.env': 'KEEP=1\nNEW=y\nMODE=prod\nAPI_TOKEN=new-LEAK\n',
  };

  it('lists keys by category and exits 1', () => {
    const result = cli(['diff', 'a.env', 'b.env'], workspace(files));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('- GONE');
    expect(result.stdout).toContain('+ NEW');
    expect(result.stdout).toContain('~ MODE');
    expect(result.stdout).toContain('~ API_TOKEN (secret)');
    expect(result.stdout).toContain('1 removed, 1 added, 2 changed, 1 unchanged');
    expect(result.stdout).not.toMatch(/dev|prod|LEAK/);
  });

  it('shows non-secret values with --reveal and still masks secrets', () => {
    const result = cli(['diff', 'a.env', 'b.env', '--reveal'], workspace(files));
    expect(result.stdout).toContain('~ MODE  "dev" -> "prod"');
    expect(result.stdout).toContain('API_TOKEN  ******** -> ********');
    expect(result.stdout).not.toContain('LEAK');
  });

  it('emits only key names in JSON', () => {
    const result = cli(['diff', 'a.env', 'b.env', '--json', '--reveal'], workspace(files));
    expect(JSON.parse(result.stdout)).toEqual({
      left: 'a.env',
      right: 'b.env',
      onlyLeft: ['GONE'],
      onlyRight: ['NEW'],
      changed: ['API_TOKEN', 'MODE'],
      unchanged: 1,
    });
  });

  it('exits 0 when the files match', () => {
    const dir = workspace({ 'a.env': 'A=1', 'b.env': 'A=1' });
    expect(cli(['diff', 'a.env', 'b.env'], dir).code).toBe(0);
  });

  it('exits 2 without two files or with a missing file', () => {
    const dir = workspace({ 'a.env': 'A=1' });
    expect(cli(['diff', 'a.env'], dir).code).toBe(2);
    expect(cli(['diff', 'a.env', 'a.env', 'a.env'], dir).code).toBe(2);
    expect(cli(['diff', 'a.env', 'missing.env'], dir).code).toBe(2);
  });

  it('does not let a hostile file inject terminal escapes into the output', () => {
    const dir = workspace({
      'a.env': 'MODE="\u001b[2Jx"',
      'b.env': 'MODE=y',
    });
    const result = cli(['diff', 'a.env', 'b.env', '--reveal'], dir);
    expect(result.stdout).not.toContain('\u001b');
  });
});
