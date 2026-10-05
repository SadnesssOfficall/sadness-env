# sadness-env

Validate, mask and diff `.env` files from the command line or from code.

You describe your variables once in a small JSON schema. `sadness-env` then checks
real env files against it, generates a safe `.env.example`, and compares environments
without ever printing a secret. It has no runtime dependencies.

## Features

- Strict `.env` parser: quotes, `export`, inline comments, multi-line values, CRLF, BOM, duplicate detection
- Schema validation with typed values: `string`, `number`, `integer`, `port`, `boolean`, `url`, `enum`
- Required variables, defaults, length/range/pattern/protocol constraints
- Secret handling by default: secret values never appear in output, errors or JSON
- `.env.example` generation from a schema or from an existing env file (values removed)
- Key-level diff between two env files
- Layered files (`.env`, then `.env.local`, ...) and optional overlay from `process.env`
- Library API with TypeScript types inferred from the schema
- Stable exit codes and `--json` output for CI

## Installation

Requires Node.js 20 or newer.

```sh
npm install --save-dev sadness-env
npx sadness-env --help
```

Global install:

```sh
npm install --global sadness-env
```

## Usage

```text
sadness-env check    [-f <file>]... [-s <schema>] [--strict] [--process-env] [--json]
sadness-env generate [-s <schema> | --from <file>] [-o <file>] [--stdout] [--force]
sadness-env diff     <left> <right> [-s <schema>] [--reveal] [--json]
```

### check

Validates env files and reports every problem at once.

```sh
sadness-env check
sadness-env check --file .env.production
sadness-env check -f .env -f .env.local --strict
sadness-env check --process-env --json
```

| Option          | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `-f, --file`    | Env file to read. Repeatable; later files override earlier ones. Default `.env` |
| `-s, --schema`  | Schema file. Default `env.schema.json`                                          |
| `--strict`      | Treat variables that are not in the schema as errors                            |
| `--process-env` | Let `process.env` override files, for variables declared in the schema          |
| `--json`        | Machine-readable report                                                         |

Schema lookup order: `--schema`, then `./env.schema.json`, then the keys of `./.env.example`
(every key becomes a required string), then syntax-only checking.

### generate

```sh
sadness-env generate                       # schema -> .env.example (or .env -> .env.example)
sadness-env generate --from .env.production --out .env.production.example
sadness-env generate --stdout
```

From a schema, each variable is written with its description and constraints, and with its
default unless the variable is a secret. From an env file, only the keys are kept. An existing
output file is never overwritten without `--force`, and the file being read is never overwritten at all.

### diff

```sh
sadness-env diff .env.example .env
sadness-env diff .env.staging .env.production --reveal
```

Lists keys that are only on the left (`-`), only on the right (`+`) or have different values (`~`).
Values are hidden. `--reveal` shows values of non-secret variables only.

### Exit codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | No errors (warnings allowed) / no differences |
| 1    | Validation errors or differences found        |
| 2    | Usage, file or schema error                   |

## Configuration

The schema is a JSON file with a `variables` object. See [examples/env.schema.json](examples/env.schema.json).

```json
{
  "variables": {
    "PORT": { "type": "port", "default": 3000 },
    "DATABASE_URL": { "type": "url", "protocols": ["postgres"], "secret": true },
    "JWT_SECRET": { "type": "string", "minLength": 32, "secret": true },
    "LOG_LEVEL": { "type": "enum", "values": ["debug", "info", "warn"], "required": false }
  }
}
```

| Field                               | Applies to          | Meaning                                                          |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `type`                              | all                 | `string`, `number`, `integer`, `port`, `boolean`, `url`, `enum`  |
| `required`                          | all                 | Default `true`. Ignored when a `default` exists                  |
| `default`                           | all                 | Used when the variable is unset or empty. Must itself be valid   |
| `secret`                            | all                 | Force or deny masking; overrides name-based detection            |
| `description`                       | all                 | Copied into the generated `.env.example`                         |
| `minLength`, `maxLength`, `pattern` | `string`            | Length bounds and a regular expression (not anchored implicitly) |
| `min`, `max`                        | `number`, `integer` | Inclusive bounds                                                 |
| `protocols`                         | `url`               | Allowed schemes, e.g. `["https"]`                                |
| `values`                            | `enum`              | Allowed values (case-sensitive)                                  |

Rules worth knowing:

- An empty value (`KEY=`) counts as unset.
- `boolean` accepts `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off` in any case.
- `number` and `integer` accept plain decimal notation only; `0x10`, `Infinity` and padded values are rejected.
- `url` needs a scheme and `//`, so `localhost:3000` is rejected instead of being read as a scheme.
- Unknown fields in the schema are errors, so typos do not silently disable a rule.

### Env file syntax

| Syntax                          | Result                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| `KEY=value`, `export KEY=value` | `value`                                                         |
| `KEY=a # note`                  | `a`. `#` starts a comment only at the start or after whitespace |
| `KEY='literal \n $HOME'`        | Taken literally                                                 |
| `KEY="a\nb \"q\""`              | Escapes `\n \r \t \" \\` are processed                          |
| `KEY="line1` ⏎ `line2"`         | Multi-line, up to 256 lines                                     |

There is no variable interpolation and no command substitution; `$HOME` and `$(cmd)` stay as written.
If a key appears twice, the last one wins and a warning is reported.

## Examples

```console
$ sadness-env check
.env against env.schema.json
  error   PORT: must be an integer between 1 and 65535 (got "99999")
  error   JWT_SECRET: must be at least 32 characters
  warning FOO: is not declared in the schema
2 errors, 1 warning
```

Library:

```ts
import { defineSchema, loadEnv } from 'sadness-env';

const schema = defineSchema({
  variables: {
    PORT: { type: 'port', default: 3000 },
    DATABASE_URL: { type: 'url', secret: true },
    LOG_LEVEL: { type: 'enum', values: ['debug', 'info', 'warn'], default: 'info' },
    SENTRY_DSN: { type: 'url', required: false },
  },
});

export const env = loadEnv({ schema, files: ['.env'], processEnv: process.env });
// env.PORT: number, env.LOG_LEVEL: 'debug' | 'info' | 'warn', env.SENTRY_DSN: string | undefined
```

`loadEnv` throws `EnvValidationError` listing every problem. `checkEnv` takes the same options and
returns `{ ok, issues, values }` instead of throwing. `parseEnv`, `validateEnv`, `diffEnv`,
`generateFromSchema`, `isSecret` and `maskValue` are exported for lower-level use. When `files` is
omitted, `./.env` is read if it exists; files you list explicitly must exist.

## Architecture

```text
src/
  parser.ts     text -> entries + syntax issues
  schema.ts     schema types, schema file validation, type inference
  coerce.ts     one raw string -> typed value, per variable type
  validate.ts   env map + schema -> typed values + issues
  secrets.ts    secret detection, masking, terminal-safe display
  load.ts       file reading, layering, process.env overlay, checkEnv/loadEnv
  generate.ts   .env.example output
  diff.ts       key-level comparison
  cli/          argument handling and output formatting
```

The CLI is a thin layer over the same functions the library exports.

## Security

- **Secrets are never printed.** A variable is secret if the schema says so, if its name looks like
  one (`SECRET`, `TOKEN`, `PASSWORD`, `API_KEY`, `PRIVATE`, `DSN`, ...), or if its value is a URL with
  an embedded password. Set `"secret": false` to override the name heuristic.
- **Values are not echoed in errors** for secrets, and never for `string` and `url` variables, since a
  mistyped token is still a token. Only short, non-secret values of other types are shown, escaped.
- **Terminal escape injection.** Anything shown from a file is passed through JSON escaping and has
  control, bidirectional and zero-width characters turned into `\uXXXX`, so a hostile `.env` cannot
  rewrite your terminal.
- **Parser errors never quote the offending line.**
- **No code execution or expansion.** The parser does not evaluate `$()` or `${}`. Variable names
  are restricted to `[A-Za-z_][A-Za-z0-9_]*`, and `__proto__` is handled as plain data.
- **Bounded input.** Files over 1 MiB, directories and non-regular files are refused, quoted values
  span at most 256 lines, and long lines are parsed without catastrophic backtracking.
- **Safe writes.** `generate` refuses to overwrite files unless `--force`, never writes to the file
  it reads from, and never writes secret defaults.
- `pattern` in a schema is compiled as a regular expression. Only use schema files you trust; a
  pathological pattern can be slow.

`diff --reveal` and the library's `parseEnv`/`checkEnv` results do contain real values, since that is
the point of those calls. Do not log them.

## Development

```sh
git clone https://github.com/SadnesssOfficall/sadness-env.git
cd sadness-env
npm install
npm run build
```

| Script                 | Purpose             |
| ---------------------- | ------------------- |
| `npm run build`        | Compile to `dist/`  |
| `npm run lint`         | ESLint (type-aware) |
| `npm run format:check` | Prettier            |
| `npm run typecheck`    | `tsc --noEmit`      |

## Testing

```sh
npm test
```

Tests cover the parser (quoting, CRLF, BOM, duplicates, malformed input), every variable type and its
edge cases, secret detection, file layering, the CLI end to end including exit codes, and attack
scenarios: secrets leaking into output, terminal escapes, prototype keys, oversized and hostile files,
and overwriting the source file.

## License

[MIT](LICENSE)
