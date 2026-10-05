import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTextFile } from '../files.js';
import { formatIssue } from '../issues.js';
import { generateFromEntries, generateFromSchema } from '../generate.js';
import { parseEnv } from '../parser.js';
import {
  DEFAULT_ENV_FILE,
  DEFAULT_EXAMPLE_FILE,
  DEFAULT_SCHEMA_FILE,
  loadSchemaFile,
  parseOptions,
  UsageError,
  type CliIo,
} from './runtime.js';

function fromEnvFile(io: CliIo, source: string): { content: string; ok: boolean } {
  const parsed = parseEnv(readTextFile(resolve(io.cwd, source)));
  const errors = parsed.issues.filter((issue) => issue.severity === 'error');
  for (const issue of errors) io.stderr.write(`${source}: ${formatIssue(issue)}\n`);
  return { content: generateFromEntries(parsed.entries), ok: errors.length === 0 };
}

export function runGenerate(args: string[], io: CliIo): number {
  const { values, positionals } = parseOptions(args, {
    schema: { type: 'string', short: 's' },
    from: { type: 'string' },
    out: { type: 'string', short: 'o' },
    stdout: { type: 'boolean' },
    force: { type: 'boolean' },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  if (values.schema !== undefined && values.from !== undefined) {
    throw new UsageError('--schema and --from cannot be used together');
  }

  const schemaPath =
    values.schema ??
    (values.from === undefined && existsSync(resolve(io.cwd, DEFAULT_SCHEMA_FILE))
      ? DEFAULT_SCHEMA_FILE
      : undefined);
  const source = values.from ?? DEFAULT_ENV_FILE;
  const outPath = resolve(io.cwd, values.out ?? DEFAULT_EXAMPLE_FILE);
  if (schemaPath === undefined && outPath === resolve(io.cwd, source)) {
    throw new UsageError('refusing to overwrite the source file; choose a different --out');
  }

  let content: string;
  if (schemaPath === undefined) {
    const generated = fromEnvFile(io, source);
    if (!generated.ok) return 1;
    content = generated.content;
  } else {
    content = generateFromSchema(loadSchemaFile(resolve(io.cwd, schemaPath)));
  }

  if (values.stdout) {
    io.stdout.write(content);
    return 0;
  }
  try {
    writeFileSync(outPath, content, { flag: values.force ? 'w' : 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UsageError(
        `${values.out ?? DEFAULT_EXAMPLE_FILE} already exists (use --force to overwrite)`,
      );
    }
    throw error;
  }
  io.stdout.write(`wrote ${values.out ?? DEFAULT_EXAMPLE_FILE}\n`);
  return 0;
}
