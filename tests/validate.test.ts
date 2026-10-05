import { describe, expect, it } from 'vitest';
import { parseSchema, type VariableSpec } from '../src/schema.js';
import { validateEnv } from '../src/validate.js';

function check(spec: VariableSpec, raw: string | undefined) {
  const env = new Map<string, string>(raw === undefined ? [] : [['VALUE', raw]]);
  const result = validateEnv(env, { variables: { VALUE: spec } });
  return { value: result.values['VALUE'], issues: result.issues };
}

const invalid = (spec: VariableSpec, raw: string) => check(spec, raw).issues[0]?.message;

describe('validateEnv types', () => {
  describe('number and integer', () => {
    it('accepts decimal notation', () => {
      for (const raw of ['0', '-1', '+2', '1.5', '.5', '5.', '1e3', '-2.5E-2']) {
        expect(check({ type: 'number' }, raw).issues, raw).toEqual([]);
      }
      expect(check({ type: 'number' }, '1e3').value).toBe(1000);
    });

    it('rejects everything Number() would silently accept', () => {
      for (const raw of ['0x10', '0b1', ' 5', '5 ', '1,5', 'Infinity', 'NaN', '1e999', '--1']) {
        expect(invalid({ type: 'number' }, raw), raw).toBeDefined();
      }
    });

    it('rejects fractions and unsafe integers for integer', () => {
      expect(invalid({ type: 'integer' }, '1.5')).toBe('must be an integer (got "1.5")');
      expect(invalid({ type: 'integer' }, '9007199254740993')).toMatch(/out of range/);
      expect(check({ type: 'integer' }, '-12').value).toBe(-12);
    });

    it('enforces min and max inclusively', () => {
      const spec: VariableSpec = { type: 'integer', min: 1, max: 3 };
      expect(check(spec, '1').issues).toEqual([]);
      expect(check(spec, '3').issues).toEqual([]);
      expect(invalid(spec, '0')).toMatch(/must be >= 1/);
      expect(invalid(spec, '4')).toMatch(/must be <= 3/);
    });
  });

  describe('port', () => {
    it('accepts 1 through 65535', () => {
      expect(check({ type: 'port' }, '1').value).toBe(1);
      expect(check({ type: 'port' }, '65535').value).toBe(65535);
    });

    it('rejects 0, 65536, negatives, decimals and text', () => {
      for (const raw of ['0', '65536', '-1', '80.5', 'http', '3000abc']) {
        expect(invalid({ type: 'port' }, raw), raw).toMatch(/between 1 and 65535/);
      }
    });
  });

  describe('boolean', () => {
    it('accepts the documented spellings case-insensitively', () => {
      for (const raw of ['true', 'TRUE', '1', 'yes', 'On']) {
        expect(check({ type: 'boolean' }, raw).value, raw).toBe(true);
      }
      for (const raw of ['false', 'False', '0', 'no', 'OFF']) {
        expect(check({ type: 'boolean' }, raw).value, raw).toBe(false);
      }
    });

    it('rejects anything else, including truthy-looking strings', () => {
      for (const raw of ['2', 'y', 'enabled', 'null']) {
        expect(invalid({ type: 'boolean' }, raw), raw).toMatch(/must be one of/);
      }
    });
  });

  describe('url', () => {
    it('requires a scheme and authority', () => {
      expect(check({ type: 'url' }, 'https://example.com/a?b=1').issues).toEqual([]);
      expect(check({ type: 'url' }, 'redis://cache:6379').issues).toEqual([]);
    });

    it('rejects host:port pairs that URL() would parse as a scheme', () => {
      expect(invalid({ type: 'url' }, 'localhost:3000')).toMatch(/must be a URL/);
      expect(invalid({ type: 'url' }, 'example.com')).toMatch(/must be a URL/);
      expect(invalid({ type: 'url' }, 'http://')).toMatch(/must be a URL/);
    });

    it('restricts protocols when asked to', () => {
      const spec: VariableSpec = { type: 'url', protocols: ['https'] };
      expect(check(spec, 'https://a.b').issues).toEqual([]);
      expect(invalid(spec, 'http://a.b')).toBe('protocol must be one of: https');
      expect(invalid(spec, 'javascript://x')).toMatch(/protocol must be/);
    });
  });

  describe('enum', () => {
    const spec: VariableSpec = { type: 'enum', values: ['debug', 'info'] };

    it('matches exactly and case-sensitively', () => {
      expect(check(spec, 'info').value).toBe('info');
      expect(invalid(spec, 'INFO')).toMatch(/must be one of: debug, info/);
    });
  });

  describe('string', () => {
    it('enforces length and pattern', () => {
      const spec: VariableSpec = {
        type: 'string',
        minLength: 3,
        maxLength: 5,
        pattern: '^[a-z]+$',
      };
      expect(check(spec, 'abcd').issues).toEqual([]);
      expect(invalid(spec, 'ab')).toMatch(/at least 3/);
      expect(invalid(spec, 'abcdef')).toMatch(/at most 5/);
      expect(invalid(spec, 'ab1')).toMatch(/pattern/);
    });
  });
});

describe('validateEnv presence rules', () => {
  const schema = parseSchema({
    variables: {
      REQUIRED: { type: 'string' },
      OPTIONAL: { type: 'string', required: false },
      DEFAULTED: { type: 'port', default: 8080 },
    },
  });

  it('reports missing required variables and applies defaults', () => {
    const result = validateEnv(new Map(), schema);
    expect(result.issues).toEqual([
      { severity: 'error', code: 'missing', key: 'REQUIRED', message: 'is required but not set' },
    ]);
    expect(result.values).toEqual({ REQUIRED: undefined, OPTIONAL: undefined, DEFAULTED: 8080 });
  });

  it('treats an empty value as unset', () => {
    const result = validateEnv(
      new Map([
        ['REQUIRED', ''],
        ['DEFAULTED', ''],
      ]),
      schema,
    );
    expect(result.issues[0]?.message).toBe('is required but empty');
    expect(result.values['DEFAULTED']).toBe(8080);
  });

  it('warns about undeclared variables, or fails in strict mode', () => {
    const env = new Map([
      ['REQUIRED', 'x'],
      ['EXTRA', '1'],
    ]);
    expect(validateEnv(env, schema).issues).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'unknown', key: 'EXTRA' }),
    ]);
    expect(validateEnv(env, schema, { strict: true }).issues[0]?.severity).toBe('error');
  });

  it('does not treat inherited object properties as declared variables', () => {
    const issues = validateEnv(new Map([['toString', 'x']]), schema).issues;
    expect(issues.some((issue) => issue.key === 'toString' && issue.code === 'unknown')).toBe(true);
  });
});

describe('validateEnv value hygiene', () => {
  it('echoes harmless rejected values, escaped', () => {
    expect(invalid({ type: 'port' }, '99999')).toBe(
      'must be an integer between 1 and 65535 (got "99999")',
    );
  });

  it('escapes terminal control sequences in echoed values', () => {
    const message = invalid({ type: 'integer' }, '\u001b[2J\u001b]0;pwned\u0007');
    expect(message).not.toContain('\u001b');
    expect(message).not.toContain('\u0007');
  });

  it('never echoes values of strings, urls or secret variables', () => {
    const secret = 'hunter2-hunter2';
    const cases: VariableSpec[] = [
      { type: 'string', pattern: '^x$' },
      { type: 'url' },
      { type: 'integer', secret: true },
    ];
    for (const spec of cases) {
      expect(invalid(spec, secret), spec.type).not.toContain(secret);
    }
    const byName = validateEnv(new Map([['API_TOKEN', secret]]), {
      variables: { API_TOKEN: { type: 'integer' } },
    });
    expect(JSON.stringify(byName.issues)).not.toContain(secret);
  });
});
