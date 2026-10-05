import { resolve } from 'node:path';
import { checkEnv } from '../load.js';
import { formatIssue, type Issue } from '../issues.js';
import {
  DEFAULT_ENV_FILE,
  paint,
  parseOptions,
  resolveSchema,
  UsageError,
  type CliIo,
} from './runtime.js';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function summarize(io: CliIo, issues: readonly Issue[], variableCount: number | undefined): string {
  const color = paint(io);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  if (errors > 0) {
    return color.red(`${plural(errors, 'error')}, ${plural(warnings, 'warning')}`);
  }
  const checked =
    variableCount === undefined ? '' : ` (${plural(variableCount, 'variable')} checked)`;
  const suffix = warnings > 0 ? `, ${plural(warnings, 'warning')}` : '';
  return color.green(`ok${checked}${suffix}`);
}

export function runCheck(args: string[], io: CliIo): number {
  const { values, positionals } = parseOptions(args, {
    file: { type: 'string', short: 'f', multiple: true },
    schema: { type: 'string', short: 's' },
    strict: { type: 'boolean' },
    json: { type: 'boolean' },
    'process-env': { type: 'boolean' },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);

  const files = values.file?.length ? values.file : [DEFAULT_ENV_FILE];
  const resolved = files.map((file) => resolve(io.cwd, file));
  const loaded = resolveSchema(io, values.schema, resolved);
  const result = checkEnv({
    files: resolved,
    schema: loaded?.schema,
    strict: values.strict,
    processEnv: values['process-env'] ? io.env : undefined,
  });
  const issues = result.issues.map((issue) =>
    issue.file === undefined ? issue : { ...issue, file: files[resolved.indexOf(issue.file)] },
  );

  if (values.json) {
    io.stdout.write(
      `${JSON.stringify({ ok: result.ok, files, schema: loaded?.source ?? null, issues }, null, 2)}\n`,
    );
    return result.ok ? 0 : 1;
  }

  const color = paint(io);
  io.stdout.write(
    `${color.bold(files.join(', '))} ${color.dim(loaded ? `against ${loaded.source}` : 'syntax only (no schema found)')}\n`,
  );
  for (const issue of issues) {
    const label = issue.severity === 'error' ? color.red('error  ') : color.yellow('warning');
    io.stdout.write(`  ${label} ${formatIssue(issue)}\n`);
  }
  const variableCount = loaded ? Object.keys(loaded.schema.variables).length : undefined;
  io.stdout.write(`${summarize(io, issues, variableCount)}\n`);
  return result.ok ? 0 : 1;
}
