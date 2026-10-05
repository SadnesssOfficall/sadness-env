import { resolve } from 'node:path';
import { diffEnv, type DiffEntry } from '../diff.js';
import { readEnvFiles } from '../load.js';
import { formatIssue } from '../issues.js';
import { displayValue, maskValue } from '../secrets.js';
import { paint, parseOptions, resolveSchema, UsageError, type CliIo } from './runtime.js';

function shown(entry: DiffEntry, value: string | undefined, reveal: boolean): string | undefined {
  if (value === undefined) return undefined;
  return reveal && !entry.secret ? displayValue(value) : maskValue(value);
}

function describeChange(entry: DiffEntry, reveal: boolean): string {
  if (!reveal) return entry.secret ? `${entry.key} (secret)` : entry.key;
  return `${entry.key}  ${shown(entry, entry.left, true)} -> ${shown(entry, entry.right, true)}`;
}

export function runDiff(args: string[], io: CliIo): number {
  const { values, positionals } = parseOptions(args, {
    schema: { type: 'string', short: 's' },
    json: { type: 'boolean' },
    reveal: { type: 'boolean' },
  });
  const [leftFile, rightFile, ...extra] = positionals;
  if (leftFile === undefined || rightFile === undefined || extra.length > 0) {
    throw new UsageError('diff needs exactly two files: sadness-env diff <left> <right>');
  }

  const left = readEnvFiles([resolve(io.cwd, leftFile)]);
  const right = readEnvFiles([resolve(io.cwd, rightFile)]);
  const schema = resolveSchema(io, values.schema, [])?.schema;
  const result = diffEnv(left.env, right.env, schema);
  const different = result.onlyLeft.length + result.onlyRight.length + result.changed.length > 0;

  for (const issue of [...left.issues, ...right.issues].filter((i) => i.severity === 'error')) {
    io.stderr.write(`${formatIssue(issue)}\n`);
  }

  if (values.json) {
    const keys = (entries: DiffEntry[]) => entries.map((entry) => entry.key);
    io.stdout.write(
      `${JSON.stringify({ left: leftFile, right: rightFile, onlyLeft: keys(result.onlyLeft), onlyRight: keys(result.onlyRight), changed: keys(result.changed), unchanged: result.unchanged }, null, 2)}\n`,
    );
    return different ? 1 : 0;
  }

  const color = paint(io);
  io.stdout.write(`${color.dim(`--- ${leftFile}`)}\n${color.dim(`+++ ${rightFile}`)}\n`);
  for (const entry of result.onlyLeft) io.stdout.write(`${color.red(`- ${entry.key}`)}\n`);
  for (const entry of result.onlyRight) io.stdout.write(`${color.green(`+ ${entry.key}`)}\n`);
  for (const entry of result.changed) {
    io.stdout.write(`${color.yellow(`~ ${describeChange(entry, values.reveal === true)}`)}\n`);
  }
  io.stdout.write(
    `${result.onlyLeft.length} removed, ${result.onlyRight.length} added, ${result.changed.length} changed, ${result.unchanged} unchanged\n`,
  );
  return different ? 1 : 0;
}
