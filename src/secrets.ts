import type { VariableSpec } from './schema.js';

export const MASK = '********';

const MAX_DISPLAY_LENGTH = 60;
const SECRET_KEY_PATTERN =
  /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|COOKIE|SIGNING|ENCRYPTION|(?:^|_)(?:KEY|PWD|PASS|AUTH|SALT|DSN)(?:_|$)/i;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function hasEmbeddedCredentials(value: string): boolean {
  if (!SCHEME_PATTERN.test(value)) return false;
  try {
    return new URL(value).password !== '';
  } catch {
    return false;
  }
}

export function isSecret(key: string, spec?: VariableSpec, value = ''): boolean {
  return spec?.secret ?? (SECRET_KEY_PATTERN.test(key) || hasEmbeddedCredentials(value));
}

export function maskValue(value: string): string {
  return value === '' ? '(empty)' : MASK;
}

function isUnsafe(code: number): boolean {
  return UNSAFE_RANGES.some(([low, high]) => code >= low && code <= high);
}

function escapeUnsafe(text: string): string {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return isUnsafe(code) ? `\\u${code.toString(16).padStart(4, '0')}` : character;
  }).join('');
}

export function displayValue(value: string): string {
  const escaped = escapeUnsafe(JSON.stringify(value));
  return escaped.length > MAX_DISPLAY_LENGTH
    ? `${escaped.slice(0, MAX_DISPLAY_LENGTH)}…"`
    : escaped;
}
