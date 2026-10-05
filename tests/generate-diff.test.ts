import { describe, expect, it } from 'vitest';
import { diffEnv } from '../src/diff.js';
import { generateFromEntries, generateFromSchema } from '../src/generate.js';
import { parseEnv } from '../src/parser.js';
import { parseSchema } from '../src/schema.js';

describe('generateFromSchema', () => {
  const schema = parseSchema({
    variables: {
      PORT: { type: 'port', default: 3000, description: 'HTTP port' },
      JWT_SECRET: { type: 'string', secret: true, default: 'do-not-publish' },
      LOG_LEVEL: { type: 'enum', values: ['debug', 'info'], required: false },
      DATABASE_URL: { type: 'url', default: 'postgres://app:pw@localhost/app' },
      NOTES: { type: 'string', description: 'first line\nsecond line' },
    },
  });

  it('documents each variable and keeps non-secret defaults', () => {
    expect(generateFromSchema(schema)).toBe(
      [
        '# HTTP port',
        '# port, default: 3000',
        'PORT=3000',
        '',
        '# string, default: do-not-publish, secret',
        'JWT_SECRET=',
        '',
        '# enum, debug | info, optional',
        'LOG_LEVEL=',
        '',
        '# url, default: postgres://app:pw@localhost/app',
        'DATABASE_URL=',
        '',
        '# first line',
        '# second line',
        '# string, required',
        'NOTES=',
        '',
      ].join('\n'),
    );
  });

  it('never writes the default of a secret variable as a value', () => {
    const lines = generateFromSchema(schema).split('\n');
    expect(lines).toContain('JWT_SECRET=');
    expect(lines).toContain('DATABASE_URL=');
  });

  it('produces a file the parser can read back', () => {
    const parsed = parseEnv(generateFromSchema(schema));
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => entry.key)).toEqual(Object.keys(schema.variables));
  });
});

describe('generateFromEntries', () => {
  it('keeps keys and drops every value', () => {
    const { entries } = parseEnv('A=secret1\nB="multi\nline"\nC=');
    expect(generateFromEntries(entries)).toBe('A=\nB=\nC=\n');
  });

  it('returns an empty file for no entries', () => {
    expect(generateFromEntries([])).toBe('');
  });
});

describe('diffEnv', () => {
  const left = new Map([
    ['SAME', '1'],
    ['GONE', 'x'],
    ['CHANGED', 'a'],
    ['API_TOKEN', 'one'],
  ]);
  const right = new Map([
    ['SAME', '1'],
    ['NEW', 'y'],
    ['CHANGED', 'b'],
    ['API_TOKEN', 'two'],
  ]);

  it('sorts keys into removed, added, changed and unchanged', () => {
    const result = diffEnv(left, right);
    expect(result.onlyLeft.map((entry) => entry.key)).toEqual(['GONE']);
    expect(result.onlyRight.map((entry) => entry.key)).toEqual(['NEW']);
    expect(result.changed.map((entry) => entry.key)).toEqual(['API_TOKEN', 'CHANGED']);
    expect(result.unchanged).toBe(1);
  });

  it('flags secrets by name, by credential url, or by schema', () => {
    const result = diffEnv(
      new Map([
        ['DB', 'pg://u:p@h'],
        ['PLAIN', '1'],
        ['MARKED', '1'],
      ]),
      new Map([
        ['DB', 'pg://u:q@h'],
        ['PLAIN', '2'],
        ['MARKED', '2'],
      ]),
      parseSchema({ variables: { MARKED: { type: 'string', secret: true } } }),
    );
    const flags = Object.fromEntries(result.changed.map((entry) => [entry.key, entry.secret]));
    expect(flags).toEqual({ DB: true, MARKED: true, PLAIN: false });
  });

  it('reports no differences for identical environments', () => {
    const result = diffEnv(left, left);
    expect(result).toEqual({ onlyLeft: [], onlyRight: [], changed: [], unchanged: 4 });
  });
});
