import { coerce } from './coerce.js';
import type { Issue } from './issues.js';
import { displayValue, isSecret } from './secrets.js';
import type { EnvSchema, EnvValue } from './schema.js';

export interface ValidationOptions {
  strict?: boolean;
}

export interface ValidationResult {
  values: Record<string, EnvValue | undefined>;
  issues: Issue[];
}

export function validateEnv(
  env: ReadonlyMap<string, string>,
  schema: EnvSchema,
  options: ValidationOptions = {},
): ValidationResult {
  const values: [string, EnvValue | undefined][] = [];
  const issues: Issue[] = [];

  for (const [key, spec] of Object.entries(schema.variables)) {
    const raw = env.get(key);
    if (raw === undefined || raw === '') {
      if (spec.default !== undefined) {
        values.push([key, spec.default]);
      } else {
        values.push([key, undefined]);
        if (spec.required ?? true) {
          const state = raw === undefined ? 'not set' : 'empty';
          issues.push({
            severity: 'error',
            code: 'missing',
            key,
            message: `is required but ${state}`,
          });
        }
      }
      continue;
    }

    const result = coerce(spec, raw);
    if (result.ok) {
      values.push([key, result.value]);
      continue;
    }
    values.push([key, undefined]);
    const echoable = spec.type !== 'string' && spec.type !== 'url' && !isSecret(key, spec, raw);
    const received = echoable ? ` (got ${displayValue(raw)})` : '';
    issues.push({
      severity: 'error',
      code: 'invalid',
      key,
      message: `${result.reason}${received}`,
    });
  }

  for (const key of env.keys()) {
    if (Object.hasOwn(schema.variables, key)) continue;
    issues.push({
      severity: options.strict ? 'error' : 'warning',
      code: 'unknown',
      key,
      message: 'is not declared in the schema',
    });
  }

  return { values: Object.fromEntries(values), issues };
}
