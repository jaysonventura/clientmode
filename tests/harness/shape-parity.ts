/** Build-time contract check: the public TypeScript entity shapes in
 * contracts/interfaces.ts must still mirror contracts/domain.schema.json.
 * Development-only — it reads source with the compiler API and ships in no package.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const INTERFACES = path.join(ROOT, 'contracts/interfaces.ts');
const SCHEMA = path.join(ROOT, 'contracts/domain.schema.json');

export type ShapeParity = { matched: boolean; checked: number; mismatches: string[] };

type Shape = { alias: string; required: Set<string>; optional: Set<string> };

/** Collect `type X = { kind: "..."; ... }` aliases keyed by their kind literal. */
function interfaceShapes(): Map<string, Shape> {
  const source = ts.createSourceFile(INTERFACES, readFileSync(INTERFACES, 'utf8'), ts.ScriptTarget.ES2022, true);
  const shapes = new Map<string, Shape>();
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || !ts.isTypeLiteralNode(statement.type)) continue;
    const shape: Shape = { alias: statement.name.text, required: new Set(), optional: new Set() };
    let kind: string | undefined;
    for (const member of statement.type.members) {
      if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
      const name = member.name.text;
      (member.questionToken ? shape.optional : shape.required).add(name);
      if (name === 'kind' && member.type && ts.isLiteralTypeNode(member.type) && ts.isStringLiteral(member.type.literal)) {
        kind = member.type.literal.text;
      }
    }
    if (kind !== undefined) shapes.set(kind, shape);
  }
  return shapes;
}

export function compareInterfaceShapes(): ShapeParity {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { $defs: Record<string, Record<string, unknown>> };
  const shapes = interfaceShapes();
  const mismatches: string[] = [];
  let checked = 0;

  for (const [name, definition] of Object.entries(schema.$defs)) {
    const properties = definition['properties'] as Record<string, unknown> | undefined;
    const kindConst = (properties?.['kind'] as Record<string, unknown> | undefined)?.['const'];
    if (typeof kindConst !== 'string') continue;
    const shape = shapes.get(kindConst);
    if (!shape) { mismatches.push(`${name}: no TypeScript type declares kind "${kindConst}"`); continue; }
    checked += 1;
    const required = new Set((definition['required'] as string[] | undefined) ?? []);
    const declared = new Set(Object.keys(properties ?? {}));
    const typed = new Set([...shape.required, ...shape.optional]);
    for (const property of declared) if (!typed.has(property)) mismatches.push(`${shape.alias}: missing property "${property}"`);
    for (const property of typed) if (!declared.has(property)) mismatches.push(`${shape.alias}: extra property "${property}" not in schema`);
    for (const property of required) if (!shape.required.has(property)) mismatches.push(`${shape.alias}: "${property}" is required by schema but optional in TypeScript`);
    for (const property of shape.required) if (declared.has(property) && !required.has(property)) mismatches.push(`${shape.alias}: "${property}" is optional in schema but required in TypeScript`);
  }
  return { matched: mismatches.length === 0, checked, mismatches };
}
