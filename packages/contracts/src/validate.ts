/** Runtime boundary validation for Client Mode domain entities.
 * The schema is the authority; TypeScript types alone do not validate untrusted input.
 * Importing this module fails closed: without its validator dependency nothing loads,
 * so an absent validator can never degrade into a permissive "valid" answer.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

export type ValidationResult = { valid: boolean; errors: string[] };

const SCHEMA_PATH = path.resolve(fileURLToPath(import.meta.url), '../../../../contracts/domain.schema.json');

type SchemaObject = Record<string, unknown>;
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as SchemaObject & { $defs: Record<string, SchemaObject> };

const ajv = new Ajv2020({ allErrors: true, coerceTypes: false, strict: true, strictTypes: false, useDefaults: false });
// ajv-formats ships CommonJS; the interop default is the plugin itself.
const addFormats = ajvFormats.default ?? ajvFormats;
addFormats(ajv);

const entity = ajv.compile(schema);

/** kind -> the single $defs entry that declares it, for precise field-path errors. */
const byKind = new Map<string, ValidateFunction>();
for (const [name, definition] of Object.entries(schema.$defs)) {
  const properties = definition['properties'] as SchemaObject | undefined;
  const kind = (properties?.['kind'] as SchemaObject | undefined)?.['const'];
  if (typeof kind !== 'string') continue;
  if (byKind.has(kind)) throw new Error(`AMBIGUOUS_ENTITY_KIND:${kind}`);
  const { oneOf: _union, ...shared } = schema;
  byKind.set(kind, ajv.compile({
    ...shared,
    $id: `https://client-mode.example/schemas/domain.v1/kind/${name}.json`,
    $ref: `#/$defs/${name}`,
  }));
}

/** Field path plus schema-derived reason only. Never echo the submitted value. */
function describe(error: ErrorObject): string {
  const at = error.instancePath === '' ? '/' : error.instancePath;
  const params = error.params as Record<string, unknown>;
  const detail = typeof params['additionalProperty'] === 'string' ? ` (${params['additionalProperty']})`
    : Array.isArray(params['allowedValues']) ? ` (allowed: ${params['allowedValues'].join(', ')})`
    : typeof params['missingProperty'] === 'string' ? ` (${params['missingProperty']})`
    : '';
  return `${at} ${error.message ?? 'is invalid'}${detail}`;
}

function report(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(describe);
}

export function validateEntity(value: unknown): ValidationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['/ must be a domain entity object'] };
  }
  const kind = (value as SchemaObject)['kind'];
  const specific = typeof kind === 'string' ? byKind.get(kind) : undefined;
  if (!specific) return { valid: false, errors: ['/kind is not a known domain entity kind'] };
  if (!specific(value)) return { valid: false, errors: report(specific) };
  // The union must still admit exactly one entity; a kind-level pass is not sufficient.
  if (!entity(value)) return { valid: false, errors: report(entity) };
  return { valid: true, errors: [] };
}

export function entityKinds(): string[] {
  return [...byKind.keys()].sort();
}
