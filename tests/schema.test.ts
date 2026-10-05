import { describe, expect, expectTypeOf, it } from 'vitest';
import { SchemaError } from '../src/errors.js';
import { defineSchema, parseSchema, schemaFromExample, type InferEnv } from '../src/schema.js';

const rejects = (input: unknown, message: RegExp) => {
  expect(() => parseSchema(input)).toThrow(SchemaError);
  expect(() => parseSchema(input)).toThrow(message);
};

describe('parseSchema', () => {
  it('accepts every variable type with its options', () => {
    const schema = parseSchema({
      $schema: './schema.json',
      variables: {
        NAME: { type: 'string', minLength: 1, maxLength: 20, pattern: '^[a-z]+$', default: 'abc' },
        RATIO: { type: 'number', min: 0, max: 1, default: 0.5 },
        RETRIES: { type: 'integer', min: 0, default: 3 },
        PORT: { type: 'port', default: 3000 },
        DEBUG: { type: 'boolean', default: false },
        API_URL: { type: 'url', protocols: ['https'], required: false },
        LOG_LEVEL: { type: 'enum', values: ['debug', 'info'], default: 'info' },
        TOKEN: { type: 'string', secret: true, description: 'API token' },
      },
    });
    expect(Object.keys(schema.variables)).toHaveLength(8);
  });

  it('rejects structurally invalid schemas', () => {
    rejects(null, /schema: must be an object/);
    rejects([], /schema: must be an object/);
    rejects({}, /variables: must be an object/);
    rejects({ variables: {}, extra: 1 }, /schema\.extra: unknown field/);
  });

  it('rejects bad variable names, types and unknown fields', () => {
    rejects({ variables: { 'BAD-NAME': { type: 'string' } } }, /invalid variable name/);
    rejects({ variables: { A: 'string' } }, /variables\.A: must be an object/);
    rejects({ variables: { A: { type: 'uuid' } } }, /variables\.A\.type: must be one of/);
    rejects({ variables: { A: { type: 'string', colour: 'red' } } }, /unknown field/);
  });

  it('rejects options that do not belong to the type', () => {
    rejects({ variables: { A: { type: 'string', min: 1 } } }, /variables\.A\.min: unknown field/);
    rejects({ variables: { A: { type: 'port', values: ['x'] } } }, /unknown field/);
  });

  it('rejects options of the wrong shape', () => {
    rejects(
      { variables: { A: { type: 'string', required: 'yes' } } },
      /required: must be a boolean/,
    );
    rejects(
      { variables: { A: { type: 'number', min: Infinity } } },
      /min: must be a finite number/,
    );
    rejects(
      { variables: { A: { type: 'number', min: 5, max: 1 } } },
      /min cannot be greater than max/,
    );
    rejects({ variables: { A: { type: 'string', minLength: -1 } } }, /non-negative integer/);
    rejects(
      { variables: { A: { type: 'string', pattern: '(' } } },
      /not a valid regular expression/,
    );
    rejects({ variables: { A: { type: 'enum', values: [] } } }, /non-empty list of unique strings/);
    rejects({ variables: { A: { type: 'enum', values: ['a', 'a'] } } }, /unique/);
    rejects({ variables: { A: { type: 'url', protocols: 'https' } } }, /list of strings/);
  });

  it('rejects defaults that the variable itself would reject', () => {
    rejects(
      { variables: { A: { type: 'port', default: 70000 } } },
      /variables\.A\.default: must be an integer between/,
    );
    rejects({ variables: { A: { type: 'port', default: '3000' } } }, /default: must be a number/);
    rejects(
      { variables: { A: { type: 'enum', values: ['a'], default: 'b' } } },
      /default: must be one of/,
    );
    rejects(
      { variables: { A: { type: 'boolean', default: 'true' } } },
      /default: must be a boolean/,
    );
  });
});

describe('schemaFromExample', () => {
  it('makes every key a required string', () => {
    const schema = schemaFromExample([{ key: 'A', value: '', line: 1 }]);
    expect(schema.variables).toEqual({ A: { type: 'string', required: true } });
  });
});

describe('defineSchema type inference', () => {
  it('infers value types from the schema', () => {
    const schema = defineSchema({
      variables: {
        PORT: { type: 'port', default: 3000 },
        HOST: { type: 'string' },
        DEBUG: { type: 'boolean', required: false },
        LEVEL: { type: 'enum', values: ['debug', 'info'] },
        TIMEOUT: { type: 'number', required: false, default: 5 },
      },
    });
    expect(Object.keys(schema.variables)).toHaveLength(5);
    expectTypeOf<InferEnv<typeof schema>>().toEqualTypeOf<{
      PORT: number;
      HOST: string;
      DEBUG: boolean | undefined;
      LEVEL: 'debug' | 'info';
      TIMEOUT: number;
    }>();
  });
});
