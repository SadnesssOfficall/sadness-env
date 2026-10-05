import type { Issue } from './issues.js';

export interface EnvEntry {
  key: string;
  value: string;
  line: number;
}

export interface ParsedEnv {
  entries: EnvEntry[];
  issues: Issue[];
}

type ValueResult = { value: string; endIndex: number } | { error: string; endIndex: number };

export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ASSIGNMENT_PATTERN = /^(?:export[ \t]+)?([^=\s]+)[ \t]*=[ \t]*(.*)$/;
const ESCAPE_PATTERN = /\\([nrt"\\])/g;
const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};
const MAX_QUOTED_LINES = 256;

function stripInlineComment(text: string): string {
  let hash = text.indexOf('#');
  while (hash !== -1) {
    const before = text[hash - 1];
    if (hash === 0 || before === ' ' || before === '\t') return text.slice(0, hash).trimEnd();
    hash = text.indexOf('#', hash + 1);
  }
  return text.trimEnd();
}

function readQuoted(lines: readonly string[], start: number, first: string, quote: string) {
  let chunk = first;
  let lineIndex = start;
  let raw = '';
  for (;;) {
    for (let position = 0; position < chunk.length; position++) {
      const character = chunk.charAt(position);
      if (quote === '"' && character === '\\') {
        raw += character + chunk.charAt(position + 1);
        position++;
      } else if (character === quote) {
        return { raw, tail: chunk.slice(position + 1), endIndex: lineIndex };
      } else {
        raw += character;
      }
    }
    lineIndex++;
    const next = lines[lineIndex];
    if (next === undefined || lineIndex - start >= MAX_QUOTED_LINES) return undefined;
    raw += '\n';
    chunk = next;
  }
}

function parseValue(lines: readonly string[], index: number, rest: string): ValueResult {
  const quote = rest.charAt(0);
  if (quote !== '"' && quote !== "'") return { value: stripInlineComment(rest), endIndex: index };

  const closed = readQuoted(lines, index, rest.slice(1), quote);
  if (!closed) return { error: 'unterminated quoted value', endIndex: index };

  const tail = closed.tail.trim();
  if (tail !== '' && !tail.startsWith('#')) {
    return { error: 'unexpected characters after closing quote', endIndex: closed.endIndex };
  }
  const value =
    quote === '"'
      ? closed.raw.replace(ESCAPE_PATTERN, (_match, escaped: string) => ESCAPES[escaped] ?? '')
      : closed.raw;
  return { value, endIndex: closed.endIndex };
}

export function parseEnv(text: string): ParsedEnv {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n/);
  const entries = new Map<string, EnvEntry>();
  const issues: Issue[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const source = (lines[index] ?? '').trimStart();
    if (source === '' || source.startsWith('#')) continue;

    const match = ASSIGNMENT_PATTERN.exec(source);
    const key = match?.[1];
    if (key === undefined) {
      issues.push({ severity: 'error', code: 'syntax', line, message: 'expected KEY=value' });
      continue;
    }
    if (!KEY_PATTERN.test(key)) {
      issues.push({ severity: 'error', code: 'syntax', line, message: 'invalid variable name' });
      continue;
    }

    const parsed = parseValue(lines, index, match?.[2] ?? '');
    index = parsed.endIndex;
    if ('error' in parsed) {
      issues.push({ severity: 'error', code: 'syntax', key, line, message: parsed.error });
      continue;
    }

    const previous = entries.get(key);
    if (previous) {
      issues.push({
        severity: 'warning',
        code: 'duplicate',
        key,
        line,
        message: `defined more than once (line ${previous.line} is overridden by line ${line})`,
      });
    }
    entries.set(key, { key, value: parsed.value, line });
  }

  return { entries: [...entries.values()], issues };
}
