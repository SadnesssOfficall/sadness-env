import type { EnvValue, VariableSpec } from './schema.js';

export type CoerceResult = { ok: true; value: EnvValue } | { ok: false; reason: string };

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER_PATTERN = /^[+-]?\d+$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const BOOLEANS: Readonly<Record<string, boolean>> = {
  true: true,
  false: false,
  '1': true,
  '0': false,
  yes: true,
  no: false,
  on: true,
  off: false,
};

const ok = (value: EnvValue): CoerceResult => ({ ok: true, value });
const fail = (reason: string): CoerceResult => ({ ok: false, reason });

function checkRange(value: number, min?: number, max?: number): CoerceResult {
  if (min !== undefined && value < min) return fail(`must be >= ${min}`);
  if (max !== undefined && value > max) return fail(`must be <= ${max}`);
  return ok(value);
}

function coerceNumber(raw: string, integer: boolean, min?: number, max?: number): CoerceResult {
  if (!(integer ? INTEGER_PATTERN : NUMBER_PATTERN).test(raw)) {
    return fail(integer ? 'must be an integer' : 'must be a number');
  }
  const value = Number(raw);
  if (integer ? !Number.isSafeInteger(value) : !Number.isFinite(value)) {
    return fail('number is out of range');
  }
  return checkRange(value, min, max);
}

function coercePort(raw: string): CoerceResult {
  const result = coerceNumber(raw, true, MIN_PORT, MAX_PORT);
  return result.ok ? result : fail(`must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
}

function coerceUrl(raw: string, protocols?: readonly string[]): CoerceResult {
  let url: URL;
  try {
    if (!SCHEME_PATTERN.test(raw)) throw new TypeError('missing scheme');
    url = new URL(raw);
  } catch {
    return fail('must be a URL with a scheme, e.g. https://example.com');
  }
  const scheme = url.protocol.slice(0, -1);
  if (protocols && !protocols.includes(scheme)) {
    return fail(`protocol must be one of: ${protocols.join(', ')}`);
  }
  return ok(raw);
}

function coerceString(raw: string, spec: Extract<VariableSpec, { type: 'string' }>): CoerceResult {
  if (spec.minLength !== undefined && raw.length < spec.minLength) {
    return fail(`must be at least ${spec.minLength} characters`);
  }
  if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
    return fail(`must be at most ${spec.maxLength} characters`);
  }
  if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(raw)) {
    return fail('does not match the required pattern');
  }
  return ok(raw);
}

export function coerce(spec: VariableSpec, raw: string): CoerceResult {
  switch (spec.type) {
    case 'string':
      return coerceString(raw, spec);
    case 'number':
      return coerceNumber(raw, false, spec.min, spec.max);
    case 'integer':
      return coerceNumber(raw, true, spec.min, spec.max);
    case 'port':
      return coercePort(raw);
    case 'boolean': {
      const value = BOOLEANS[raw.toLowerCase()];
      return value === undefined
        ? fail('must be one of: true, false, 1, 0, yes, no, on, off')
        : ok(value);
    }
    case 'url':
      return coerceUrl(raw, spec.protocols);
    case 'enum':
      return spec.values.includes(raw)
        ? ok(raw)
        : fail(`must be one of: ${spec.values.join(', ')}`);
  }
}
