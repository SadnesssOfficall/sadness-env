import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EnvFileError, EnvValidationError } from '../src/errors.js';
import { MAX_FILE_BYTES } from '../src/files.js';
import { checkEnv, loadEnv } from '../src/load.js';
import { defineSchema } from '../src/schema.js';
import { workspace } from './helpers.js';

const schema = defineSchema({
  variables: {
    PORT: { type: 'port', default: 3000 },
    HOST: { type: 'string' },
    DEBUG: { type: 'boolean', required: false },
    API_TOKEN: { type: 'string', minLength: 20 },
  },
});

describe('checkEnv', () => {
  it('layers files so that later ones override earlier ones', () => {
    const dir = workspace({
      '.env': 'HOST=base\nPORT=1000\nAPI_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaa',
      '.env.local': 'PORT=2000',
    });
    const result = checkEnv({ schema, files: [join(dir, '.env'), join(dir, '.env.local')] });
    expect(result.ok).toBe(true);
    expect(result.values).toMatchObject({ HOST: 'base', PORT: 2000 });
  });

  it('prefers process variables over files, but only for declared keys', () => {
    const dir = workspace({ '.env': 'HOST=file\nAPI_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaa' });
    const result = checkEnv({
      schema,
      files: [join(dir, '.env')],
      processEnv: { HOST: 'process', PATH: '/usr/bin', UNRELATED: 'x' },
    });
    expect(result.values['HOST']).toBe('process');
    expect(result.issues).toEqual([]);
  });

  it('includes syntax problems from files, tagged with the file name', () => {
    const dir = workspace({ '.env': 'HOST=x\nbroken line' });
    const file = join(dir, '.env');
    const result = checkEnv({ files: [file] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ file, line: 2, code: 'syntax' });
  });

  it('passes without a schema when the file is well-formed', () => {
    const dir = workspace({ '.env': 'A=1' });
    expect(checkEnv({ files: [join(dir, '.env')] })).toEqual({ ok: true, issues: [], values: {} });
  });

  it('treats duplicate keys as warnings, not failures', () => {
    const dir = workspace({ '.env': 'A=1\nA=2' });
    const result = checkEnv({ files: [join(dir, '.env')] });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(1);
  });
});

describe('file handling', () => {
  it('fails clearly when a file does not exist', () => {
    const dir = workspace();
    expect(() => checkEnv({ files: [join(dir, '.env')] })).toThrow(EnvFileError);
    expect(() => checkEnv({ files: [join(dir, '.env')] })).toThrow(/file not found/);
  });

  it('refuses directories', () => {
    const dir = workspace({ 'folder/placeholder': '' });
    expect(() => checkEnv({ files: [join(dir, 'folder')] })).toThrow(/not a regular file/);
  });

  it('refuses files larger than the limit', () => {
    const dir = workspace({ '.env': `A=${'x'.repeat(MAX_FILE_BYTES)}` });
    expect(() => checkEnv({ files: [join(dir, '.env')] })).toThrow(/larger than/);
  });
});

describe('loadEnv', () => {
  it('returns typed values', () => {
    const dir = workspace({
      '.env': 'HOST=localhost\nDEBUG=yes\nAPI_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const env = loadEnv({ schema, files: [join(dir, '.env')] });
    expect(env).toEqual({
      PORT: 3000,
      HOST: 'localhost',
      DEBUG: true,
      API_TOKEN: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expectTypeOf(env).toEqualTypeOf<{
      PORT: number;
      HOST: string;
      DEBUG: boolean | undefined;
      API_TOKEN: string;
    }>();
  });

  it('throws one error listing every problem without leaking values', () => {
    const secretLooking = 'tooshort-but-secret';
    const dir = workspace({ '.env': `PORT=abc\nAPI_TOKEN=${secretLooking}` });
    let error: unknown;
    try {
      loadEnv({ schema, files: [join(dir, '.env')] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const message = (error as EnvValidationError).message;
    expect(message).toContain('HOST: is required but not set');
    expect(message).toContain('PORT: must be an integer between 1 and 65535 (got "abc")');
    expect(message).toContain('API_TOKEN: must be at least 20 characters');
    expect(message).not.toContain(secretLooking);
  });

  it('works without any file when the process environment is supplied', () => {
    const env = loadEnv({
      schema,
      files: [],
      processEnv: { HOST: 'h', API_TOKEN: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    });
    expect(env.HOST).toBe('h');
  });
});
