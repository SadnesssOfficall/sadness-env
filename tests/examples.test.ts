import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSchema } from '../src/schema.js';
import { cli, workspace } from './helpers.js';

const schemaText = readFileSync(new URL('../examples/env.schema.json', import.meta.url), 'utf8');

describe('examples/env.schema.json', () => {
  it('is a valid schema', () => {
    expect(Object.keys(parseSchema(JSON.parse(schemaText)).variables)).toHaveLength(7);
  });

  it('accepts a realistic environment and rejects a broken one', () => {
    const good = workspace({
      'env.schema.json': schemaText,
      '.env': [
        'NODE_ENV=production',
        'DATABASE_URL=postgres://app:pw@db:5432/app',
        `JWT_SECRET=${'k'.repeat(32)}`,
      ].join('\n'),
    });
    expect(cli(['check', '--strict'], good).code).toBe(0);

    const bad = workspace({
      'env.schema.json': schemaText,
      '.env': 'NODE_ENV=staging\nDATABASE_URL=mysql://h/db\nJWT_SECRET=short',
    });
    expect(cli(['check'], bad).stdout).toContain('3 errors');
  });
});
