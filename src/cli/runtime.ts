import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { readTextFile } from '../files.js';
import { parseEnv } from '../parser.js';
import { parseSchema, schemaFromExample, type EnvSchema } from '../schema.js';

export const DEFAULT_ENV_FILE = '.env';
export const DEFAULT_EXAMPLE_FILE = '.env.example';
export const DEFAULT_SCHEMA_FILE = 'env.schema.json';

export interface CliIo {
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

export class UsageError extends Error {
  override name = 'UsageError';
}

export interface LoadedSchema {
  schema: EnvSchema;
  source: string;
}

export function parseOptions<const Options extends NonNullable<ParseArgsConfig['options']>>(
  args: string[],
  options: Options,
) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code.startsWith('ERR_PARSE_ARGS')) throw new UsageError((error as Error).message);
    throw error;
  }
}

export function loadSchemaFile(path: string): EnvSchema {
  let json: unknown;
  try {
    json = JSON.parse(readTextFile(path));
  } catch (error) {
    if (error instanceof SyntaxError) throw new UsageError(`${path} is not valid JSON`);
    throw error;
  }
  return parseSchema(json);
}

export function resolveSchema(
  io: CliIo,
  explicit: string | undefined,
  skipExampleFor: readonly string[] = [],
): LoadedSchema | undefined {
  if (explicit !== undefined) {
    return { schema: loadSchemaFile(resolve(io.cwd, explicit)), source: explicit };
  }
  if (existsSync(resolve(io.cwd, DEFAULT_SCHEMA_FILE))) {
    return {
      schema: loadSchemaFile(resolve(io.cwd, DEFAULT_SCHEMA_FILE)),
      source: DEFAULT_SCHEMA_FILE,
    };
  }
  const example = resolve(io.cwd, DEFAULT_EXAMPLE_FILE);
  if (existsSync(example) && !skipExampleFor.includes(example)) {
    const entries = parseEnv(readTextFile(example)).entries;
    return { schema: schemaFromExample(entries), source: DEFAULT_EXAMPLE_FILE };
  }
  return undefined;
}

export function paint(io: CliIo) {
  const enabled = io.stdout.isTTY === true && io.env['NO_COLOR'] === undefined;
  const wrap = (code: number) => (text: string) =>
    enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
  return { red: wrap(31), yellow: wrap(33), green: wrap(32), dim: wrap(2), bold: wrap(1) };
}
