import type { EnvEntry } from './parser.js';
import { isSecret } from './secrets.js';
import type { EnvSchema, VariableSpec } from './schema.js';

function describe(spec: VariableSpec): string {
  const traits: string[] = [spec.type];
  if (spec.type === 'enum') traits.push(spec.values.join(' | '));
  if (spec.default !== undefined) traits.push(`default: ${String(spec.default)}`);
  else traits.push(spec.required === false ? 'optional' : 'required');
  if (spec.secret) traits.push('secret');
  return traits.join(', ');
}

function commentLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => `# ${line}`.trimEnd());
}

export function generateFromSchema(schema: EnvSchema): string {
  const blocks = Object.entries(schema.variables).map(([key, spec]) => {
    const lines = spec.description ? commentLines(spec.description) : [];
    lines.push(`# ${describe(spec)}`);
    const exposeDefault = spec.default !== undefined && !isSecret(key, spec, String(spec.default));
    lines.push(`${key}=${exposeDefault ? String(spec.default) : ''}`);
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n`;
}

export function generateFromEntries(entries: readonly EnvEntry[]): string {
  return entries.length === 0 ? '' : `${entries.map((entry) => `${entry.key}=`).join('\n')}\n`;
}
