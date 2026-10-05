import { coerce } from './coerce.js';
import { SchemaError } from './errors.js';
import { KEY_PATTERN, type EnvEntry } from './parser.js';

interface BaseSpec {
  required?: boolean;
  secret?: boolean;
  description?: string;
}

export type VariableSpec =
  | (BaseSpec & {
      type: 'string';
      default?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    })
  | (BaseSpec & { type: 'number' | 'integer'; default?: number; min?: number; max?: number })
  | (BaseSpec & { type: 'port'; default?: number })
  | (BaseSpec & { type: 'boolean'; default?: boolean })
  | (BaseSpec & { type: 'url'; default?: string; protocols?: readonly string[] })
  | (BaseSpec & { type: 'enum'; default?: string; values: readonly string[] });

export type VariableType = VariableSpec['type'];
export type EnvValue = string | number | boolean;

export interface EnvSchema {
  variables: Readonly<Record<string, VariableSpec>>;
}

type ResolveType<Spec> = Spec extends { type: 'string' | 'url' }
  ? string
  : Spec extends { type: 'number' | 'integer' | 'port' }
    ? number
    : Spec extends { type: 'boolean' }
      ? boolean
      : Spec extends { type: 'enum'; values: readonly (infer Member)[] }
        ? Member
        : never;

type IsOptional<Spec> = Spec extends { default: unknown }
  ? false
  : Spec extends { required: false }
    ? true
    : false;

export type InferEnv<Schema extends EnvSchema> = {
  -readonly [Key in keyof Schema['variables']]: IsOptional<Schema['variables'][Key]> extends true
    ? ResolveType<Schema['variables'][Key]> | undefined
    : ResolveType<Schema['variables'][Key]>;
};

export function defineSchema<const Schema extends EnvSchema>(schema: Schema): Schema {
  return schema;
}

const VARIABLE_TYPES: readonly string[] = [
  'string',
  'number',
  'integer',
  'port',
  'boolean',
  'url',
  'enum',
];
const COMMON_FIELDS = ['type', 'required', 'secret', 'description', 'default'];
const TYPE_FIELDS: Readonly<Record<VariableType, readonly string[]>> = {
  string: ['minLength', 'maxLength', 'pattern'],
  number: ['min', 'max'],
  integer: ['min', 'max'],
  port: [],
  boolean: [],
  url: ['protocols'],
  enum: ['values'],
};
const DEFAULT_TYPE: Readonly<Record<VariableType, 'string' | 'number' | 'boolean'>> = {
  string: 'string',
  url: 'string',
  enum: 'string',
  number: 'number',
  integer: 'number',
  port: 'number',
  boolean: 'boolean',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expect(condition: boolean, path: string, message: string): asserts condition {
  if (!condition) throw new SchemaError(`${path}: ${message}`);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');
}

function checkOptionalField(
  spec: Record<string, unknown>,
  path: string,
  field: string,
  isValid: (value: unknown) => boolean,
  expected: string,
): void {
  expect(spec[field] === undefined || isValid(spec[field]), `${path}.${field}`, expected);
}

function checkOrdered(
  spec: Record<string, unknown>,
  path: string,
  low: string,
  high: string,
): void {
  const lower = spec[low];
  const upper = spec[high];
  expect(
    typeof lower !== 'number' || typeof upper !== 'number' || lower <= upper,
    path,
    `${low} cannot be greater than ${high}`,
  );
}

function checkPattern(spec: Record<string, unknown>, path: string): void {
  const { pattern } = spec;
  if (pattern === undefined) return;
  expect(typeof pattern === 'string', `${path}.pattern`, 'must be a string');
  try {
    new RegExp(pattern);
  } catch {
    throw new SchemaError(`${path}.pattern: not a valid regular expression`);
  }
}

function checkFields(spec: Record<string, unknown>, path: string): void {
  const isBoolean = (value: unknown): boolean => typeof value === 'boolean';
  checkOptionalField(spec, path, 'required', isBoolean, 'must be a boolean');
  checkOptionalField(spec, path, 'secret', isBoolean, 'must be a boolean');
  checkOptionalField(spec, path, 'description', (v) => typeof v === 'string', 'must be a string');
  checkOptionalField(spec, path, 'min', isFiniteNumber, 'must be a finite number');
  checkOptionalField(spec, path, 'max', isFiniteNumber, 'must be a finite number');
  checkOptionalField(spec, path, 'minLength', isCount, 'must be a non-negative integer');
  checkOptionalField(spec, path, 'maxLength', isCount, 'must be a non-negative integer');
  checkOptionalField(spec, path, 'protocols', isStringList, 'must be a list of strings');
  checkOrdered(spec, path, 'min', 'max');
  checkOrdered(spec, path, 'minLength', 'maxLength');
  checkPattern(spec, path);
}

function parseVariable(name: string, input: unknown): VariableSpec {
  const path = `variables.${name}`;
  expect(KEY_PATTERN.test(name), path, 'invalid variable name');
  expect(isRecord(input), path, 'must be an object');

  const type = input['type'];
  expect(
    typeof type === 'string' && VARIABLE_TYPES.includes(type),
    `${path}.type`,
    `must be one of: ${VARIABLE_TYPES.join(', ')}`,
  );
  const variableType = type as VariableType;
  const allowed = [...COMMON_FIELDS, ...TYPE_FIELDS[variableType]];
  for (const field of Object.keys(input)) {
    expect(allowed.includes(field), `${path}.${field}`, `unknown field for type "${type}"`);
  }

  checkFields(input, path);
  if (variableType === 'enum') {
    const values = input['values'];
    expect(
      isStringList(values) && values.length > 0 && new Set(values).size === values.length,
      `${path}.values`,
      'must be a non-empty list of unique strings',
    );
  }

  const spec = input as unknown as VariableSpec;
  if (spec.default !== undefined) {
    const expected = DEFAULT_TYPE[variableType];
    expect(typeof spec.default === expected, `${path}.default`, `must be a ${expected}`);
    const result = coerce(spec, String(spec.default));
    expect(result.ok, `${path}.default`, result.ok ? '' : result.reason);
  }
  return spec;
}

export function parseSchema(input: unknown): EnvSchema {
  expect(isRecord(input), 'schema', 'must be an object');
  for (const field of Object.keys(input)) {
    expect(field === 'variables' || field === '$schema', `schema.${field}`, 'unknown field');
  }
  const variables = input['variables'];
  expect(isRecord(variables), 'variables', 'must be an object');
  return {
    variables: Object.fromEntries(
      Object.entries(variables).map(([name, spec]) => [name, parseVariable(name, spec)]),
    ),
  };
}

export function schemaFromExample(entries: readonly EnvEntry[]): EnvSchema {
  return {
    variables: Object.fromEntries(
      entries.map((entry) => [entry.key, { type: 'string', required: true } as const]),
    ),
  };
}
