import { existsSync } from 'node:fs';
import { EnvValidationError } from './errors.js';
import { readTextFile } from './files.js';
import type { Issue } from './issues.js';
import { parseEnv } from './parser.js';
import type { EnvSchema, EnvValue, InferEnv } from './schema.js';
import { validateEnv, type ValidationOptions } from './validate.js';

export interface CheckOptions extends ValidationOptions {
  schema?: EnvSchema;
  files?: readonly string[];
  processEnv?: Readonly<Record<string, string | undefined>>;
}

export interface CheckResult {
  ok: boolean;
  issues: Issue[];
  values: Record<string, EnvValue | undefined>;
}

export interface LoadOptions<Schema extends EnvSchema> extends CheckOptions {
  schema: Schema;
}

export function readEnvFiles(files: readonly string[]): {
  env: Map<string, string>;
  issues: Issue[];
} {
  const env = new Map<string, string>();
  const issues: Issue[] = [];
  for (const file of files) {
    const parsed = parseEnv(readTextFile(file));
    issues.push(...parsed.issues.map((issue) => ({ ...issue, file })));
    for (const entry of parsed.entries) env.set(entry.key, entry.value);
  }
  return { env, issues };
}

export function checkEnv(options: CheckOptions = {}): CheckResult {
  const files = options.files ?? (existsSync('.env') ? ['.env'] : []);
  const { env, issues } = readEnvFiles(files);
  let values: CheckResult['values'] = {};

  if (options.schema) {
    for (const key of Object.keys(options.schema.variables)) {
      const fromProcess = options.processEnv?.[key];
      if (fromProcess !== undefined) env.set(key, fromProcess);
    }
    const validation = validateEnv(env, options.schema, { strict: options.strict });
    values = validation.values;
    issues.push(...validation.issues);
  }

  return { ok: !issues.some((issue) => issue.severity === 'error'), issues, values };
}

export function loadEnv<const Schema extends EnvSchema>(
  options: LoadOptions<Schema>,
): InferEnv<Schema> {
  const result = checkEnv(options);
  if (!result.ok) throw new EnvValidationError(result.issues);
  return result.values as InferEnv<Schema>;
}
