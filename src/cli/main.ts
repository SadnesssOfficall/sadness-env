import { readFileSync } from 'node:fs';
import { EnvFileError, SchemaError } from '../errors.js';
import { runCheck } from './check.js';
import { runDiff } from './diff.js';
import { runGenerate } from './generate.js';
import { UsageError, type CliIo } from './runtime.js';

const HELP = `sadness-env - validate, mask and diff .env files

Usage:
  sadness-env check    [-f <file>]... [-s <schema>] [--strict] [--process-env] [--json]
  sadness-env generate [-s <schema> | --from <file>] [-o <file>] [--stdout] [--force]
  sadness-env diff     <left> <right> [-s <schema>] [--reveal] [--json]

Commands:
  check      Validate env files against a schema (default: ./env.schema.json,
             else the keys of ./.env.example). Later --file values override earlier ones.
  generate   Write a .env.example from the schema, or from an env file with values removed.
  diff       Compare two env files by key. Secret values are never printed.

Exit codes:
  0  no problems / no differences
  1  validation errors / differences found
  2  usage, file or schema error

Options:
  -h, --help       Show this help
  -v, --version    Show the version
`;

function version(): string {
  const manifest = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

export function run(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  try {
    if (command === undefined) {
      io.stderr.write(HELP);
      return 2;
    }
    if (command === '-v' || command === '--version') {
      io.stdout.write(`${version()}\n`);
      return 0;
    }
    if (
      command === '-h' ||
      command === '--help' ||
      command === 'help' ||
      rest.includes('--help') ||
      rest.includes('-h')
    ) {
      io.stdout.write(HELP);
      return 0;
    }
    switch (command) {
      case 'check':
        return runCheck(rest, io);
      case 'generate':
        return runGenerate(rest, io);
      case 'diff':
        return runDiff(rest, io);
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (
      error instanceof UsageError ||
      error instanceof EnvFileError ||
      error instanceof SchemaError
    ) {
      io.stderr.write(`sadness-env: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
