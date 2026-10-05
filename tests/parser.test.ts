import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/parser.js';

function values(text: string): Record<string, string> {
  return Object.fromEntries(parseEnv(text).entries.map((entry) => [entry.key, entry.value]));
}

describe('parseEnv', () => {
  it('reads plain assignments, export prefixes and spaces around the equals sign', () => {
    expect(values('A=1\nexport B=two\nC = three\n  D=four')).toEqual({
      A: '1',
      B: 'two',
      C: 'three',
      D: 'four',
    });
  });

  it('keeps everything after the first equals sign', () => {
    expect(values('URL=postgres://u:p@h/db?x=1&y=2')).toEqual({
      URL: 'postgres://u:p@h/db?x=1&y=2',
    });
  });

  it('treats empty values as empty strings', () => {
    expect(values('A=\nB=""\nC= # comment')).toEqual({ A: '', B: '', C: '' });
  });

  describe('comments', () => {
    it('skips full-line comments and blank lines', () => {
      expect(values('# header\n\n   # indented\nA=1')).toEqual({ A: '1' });
    });

    it('strips inline comments only when # follows whitespace', () => {
      expect(values('A=value # note\nB=pa#ss\nC=#oops')).toEqual({ A: 'value', B: 'pa#ss', C: '' });
    });

    it('keeps # inside quotes', () => {
      expect(values('A="x # y"\nB=\'x # y\' # real comment')).toEqual({ A: 'x # y', B: 'x # y' });
    });
  });

  describe('quoting', () => {
    it('does not process escapes in single quotes', () => {
      expect(values("A='line\\nbreak $HOME'")).toEqual({ A: 'line\\nbreak $HOME' });
    });

    it('processes the documented escapes in double quotes and keeps unknown ones', () => {
      expect(values('A="a\\nb\\tc\\"d\\\\e\\qf"')).toEqual({ A: 'a\nb\tc"d\\e\\qf' });
    });

    it('does not expand variables or run command substitution', () => {
      expect(values('A=$HOME\nB="${HOME}"\nC=$(whoami)')).toEqual({
        A: '$HOME',
        B: '${HOME}',
        C: '$(whoami)',
      });
    });

    it('reads multi-line double-quoted values such as PEM keys', () => {
      const parsed = parseEnv('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1');
      expect(parsed.issues).toEqual([]);
      expect(parsed.entries.map((entry) => [entry.key, entry.value, entry.line])).toEqual([
        ['KEY', '-----BEGIN-----\nabc\n-----END-----', 1],
        ['NEXT', '1', 4],
      ]);
    });

    it('reads multi-line single-quoted values', () => {
      expect(values("A='one\ntwo'")).toEqual({ A: 'one\ntwo' });
    });

    it('does not end a double-quoted value on an escaped quote', () => {
      expect(values('A="say \\"hi\\"" # c')).toEqual({ A: 'say "hi"' });
    });
  });

  describe('file formats', () => {
    it('handles CRLF line endings without leaking carriage returns', () => {
      expect(values('A=1\r\nB="two"\r\nC=three\r\n')).toEqual({ A: '1', B: 'two', C: 'three' });
    });

    it('ignores a UTF-8 byte order mark', () => {
      expect(values('﻿A=1')).toEqual({ A: '1' });
    });

    it('returns nothing for empty input', () => {
      expect(parseEnv('')).toEqual({ entries: [], issues: [] });
    });
  });

  describe('problems', () => {
    it('lets the last duplicate win and warns', () => {
      const parsed = parseEnv('A=1\nB=2\nA=3');
      expect(parsed.entries.map((entry) => [entry.key, entry.value])).toEqual([
        ['A', '3'],
        ['B', '2'],
      ]);
      expect(parsed.issues).toEqual([
        expect.objectContaining({ severity: 'warning', code: 'duplicate', key: 'A', line: 3 }),
      ]);
    });

    it('reports an unterminated quote and keeps parsing the next line', () => {
      const parsed = parseEnv('A="never closed\nB=2');
      expect(parsed.issues).toEqual([
        expect.objectContaining({ severity: 'error', key: 'A', line: 1 }),
      ]);
      expect(parsed.entries).toEqual([{ key: 'B', value: '2', line: 2 }]);
    });

    it('reports text after a closing quote', () => {
      const parsed = parseEnv('A="x" y\nB=1');
      expect(parsed.issues[0]).toMatchObject({ severity: 'error', key: 'A', line: 1 });
      expect(parsed.entries.map((entry) => entry.key)).toEqual(['B']);
    });

    it('rejects lines without an assignment', () => {
      const parsed = parseEnv('just some words\nA=1');
      expect(parsed.issues).toEqual([expect.objectContaining({ code: 'syntax', line: 1 })]);
      expect(parsed.entries).toHaveLength(1);
    });

    it('rejects invalid variable names', () => {
      const parsed = parseEnv('1ABC=x\nMY-VAR=y\nOK=z');
      expect(parsed.issues.map((issue) => issue.line)).toEqual([1, 2]);
      expect(parsed.entries.map((entry) => entry.key)).toEqual(['OK']);
    });

    it('never echoes line content or values in messages', () => {
      const secret = 'sk_live_5f8a9c2e';
      const parsed = parseEnv(
        `${secret}\nbad-key=${secret}\nA="${secret}" ${secret}\nB="${secret}`,
      );
      expect(parsed.issues.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(parsed.issues)).not.toContain(secret);
    });
  });

  describe('hostile input', () => {
    it('stores __proto__ as data without touching the prototype', () => {
      const parsed = parseEnv('__proto__=polluted');
      const object = Object.fromEntries(parsed.entries.map((entry) => [entry.key, entry.value]));
      expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(Object.hasOwn(object, '__proto__')).toBe(true);
    });

    it('parses a very long whitespace run in linear time', () => {
      const parsed = parseEnv(`A=x${' '.repeat(500_000)}y`);
      expect(parsed.entries[0]?.value).toBe(`x${' '.repeat(500_000)}y`);
    });

    it('gives up on a quote that stays open for too many lines instead of swallowing the file', () => {
      const parsed = parseEnv(`A="open\n${'B=1\n'.repeat(1000)}`);
      expect(parsed.issues[0]).toMatchObject({ severity: 'error', key: 'A', line: 1 });
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]).toMatchObject({ key: 'B', line: 1001 });
    });
  });
});
