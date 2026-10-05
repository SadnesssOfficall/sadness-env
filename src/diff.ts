import { isSecret } from './secrets.js';
import type { EnvSchema } from './schema.js';

export interface DiffEntry {
  key: string;
  secret: boolean;
  left?: string;
  right?: string;
}

export interface DiffResult {
  onlyLeft: DiffEntry[];
  onlyRight: DiffEntry[];
  changed: DiffEntry[];
  unchanged: number;
}

export function diffEnv(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
  schema?: EnvSchema,
): DiffResult {
  const result: DiffResult = { onlyLeft: [], onlyRight: [], changed: [], unchanged: 0 };
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();

  for (const key of keys) {
    const leftValue = left.get(key);
    const rightValue = right.get(key);
    const secret = [leftValue, rightValue].some((value) =>
      isSecret(key, schema?.variables[key], value),
    );
    const entry: DiffEntry = { key, secret, left: leftValue, right: rightValue };

    if (rightValue === undefined) result.onlyLeft.push(entry);
    else if (leftValue === undefined) result.onlyRight.push(entry);
    else if (leftValue === rightValue) result.unchanged++;
    else result.changed.push(entry);
  }
  return result;
}
