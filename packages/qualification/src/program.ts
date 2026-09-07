/** The candidate under qualification, in four languages.
 *
 * Every implementation obeys the same contract, so a result on one stack is never inferred
 * from a result on another: each one is built with its own toolchain and observed by running
 * it. The contract is deliberately small, because what is being qualified is the toolkit's
 * behaviour across stacks, not the difficulty of the program.
 *
 *   argv[1] = "rice:2,soap:1"  ->  prints the total in centavos
 *   any quantity below 1, or an unknown product  ->  prints ERR
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DefectClass, TargetStack } from './holdout.js';

export const PRICES: Record<string, number> = { rice: 4500, soap: 2500 };

/** The lower bound each defect class leaves behind. `boundary` is the one every check in the
 * protected policy still passes. */
function bound(defect: DefectClass): { guard: string; multiplier: string } {
  return {
    guard: defect === 'semantic' ? 'none' : defect === 'boundary' ? 'lt_zero' : 'lt_one',
    multiplier: defect === 'unit' ? '100' : '1',
  };
}

const SOURCES: Record<TargetStack, (guard: string, multiplier: string) => { file: string; source: string }> = {
  typescript: (guard, multiplier) => ({
    file: 'total.mjs',
    source: `const PRICES = ${JSON.stringify(PRICES)};
const parts = (process.argv[2] ?? '').split(',').filter(Boolean);
let sum = 0;
for (const part of parts) {
  const [product, raw] = part.split(':');
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity)) { console.log('ERR'); process.exit(0); }
  ${guard === 'none' ? '' : guard === 'lt_zero' ? "if (quantity < 0) { console.log('ERR'); process.exit(0); }" : "if (quantity < 1) { console.log('ERR'); process.exit(0); }"}
  const price = PRICES[product];
  if (price === undefined) { console.log('ERR'); process.exit(0); }
  sum += price * quantity;
}
console.log(String(sum * ${multiplier}));
`,
  }),
  python: (guard, multiplier) => ({
    file: 'total.py',
    source: `import sys
PRICES = ${JSON.stringify(PRICES)}
parts = [p for p in (sys.argv[1] if len(sys.argv) > 1 else '').split(',') if p]
total = 0
for part in parts:
    product, _, raw = part.partition(':')
    try:
        quantity = int(raw)
    except ValueError:
        print('ERR'); sys.exit(0)
    ${guard === 'none' ? 'pass' : guard === 'lt_zero' ? "\n    if quantity < 0:\n        print('ERR'); sys.exit(0)" : "\n    if quantity < 1:\n        print('ERR'); sys.exit(0)"}
    if product not in PRICES:
        print('ERR'); sys.exit(0)
    total += PRICES[product] * quantity
print(total * ${multiplier})
`,
  }),
  swift: (guard, multiplier) => ({
    file: 'total.swift',
    source: `import Foundation
let prices: [String: Int] = ["rice": 4500, "soap": 2500]
let argument = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
var total = 0
for part in argument.split(separator: ",") {
    let fields = part.split(separator: ":")
    guard fields.count == 2, let quantity = Int(fields[1]) else { print("ERR"); exit(0) }
    ${guard === 'none' ? '' : guard === 'lt_zero' ? 'if quantity < 0 { print("ERR"); exit(0) }' : 'if quantity < 1 { print("ERR"); exit(0) }'}
    guard let price = prices[String(fields[0])] else { print("ERR"); exit(0) }
    total += price * quantity
}
print(total * ${multiplier})
`,
  }),
  rust: (guard, multiplier) => ({
    file: 'total.rs',
    source: `use std::env;
fn price(product: &str) -> Option<i64> {
    match product { "rice" => Some(4500), "soap" => Some(2500), _ => None }
}
fn main() {
    let argument = env::args().nth(1).unwrap_or_default();
    let mut total: i64 = 0;
    for part in argument.split(',').filter(|p| !p.is_empty()) {
        let mut fields = part.split(':');
        let product = fields.next().unwrap_or("");
        let quantity: i64 = match fields.next().unwrap_or("").parse() { Ok(value) => value, Err(_) => { println!("ERR"); return; } };
        ${guard === 'none' ? '' : guard === 'lt_zero' ? 'if quantity < 0 { println!("ERR"); return; }' : 'if quantity < 1 { println!("ERR"); return; }'}
        match price(product) { Some(value) => total += value * quantity, None => { println!("ERR"); return; } }
    }
    println!("{}", total * ${multiplier});
}
`,
  }),
};

export type BuiltProgram =
  | { built: true; stack: TargetStack; run: (argument: string) => string; source_file: string }
  | { built: false; stack: TargetStack; reason: string };

export function toolchainFor(stack: TargetStack): string {
  return { typescript: 'node', python: 'python3', swift: 'swiftc', rust: 'rustc' }[stack];
}

export function toolchainAvailable(stack: TargetStack): boolean {
  try { execFileSync('/usr/bin/which', [toolchainFor(stack)], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Writes the candidate for a stack and builds it with that stack's own toolchain. */
export function buildProgram(input: { stack: TargetStack; defect: DefectClass; workspace: string }): BuiltProgram {
  const { guard, multiplier } = bound(input.defect);
  const { file, source } = SOURCES[input.stack](guard, multiplier);
  mkdirSync(input.workspace, { recursive: true });
  const sourcePath = path.join(input.workspace, file);
  writeFileSync(sourcePath, source);
  const run = (executable: string, argv: string[]) => (argument: string): string => {
    try {
      return String(execFileSync(executable, [...argv, argument], { cwd: input.workspace, encoding: 'utf8', timeout: 30_000 })).trim();
    } catch (error) {
      return `EXEC_FAILED:${String((error as Error).message).slice(0, 120)}`;
    }
  };
  try {
    if (input.stack === 'typescript') return { built: true, stack: input.stack, run: run(process.execPath, [sourcePath]), source_file: sourcePath };
    if (input.stack === 'python') return { built: true, stack: input.stack, run: run('/usr/bin/env', ['python3', sourcePath]), source_file: sourcePath };
    const binary = path.join(input.workspace, 'total');
    const compiler = input.stack === 'swift' ? 'swiftc' : 'rustc';
    execFileSync('/usr/bin/env', [compiler, '-O', '-o', binary, sourcePath], { cwd: input.workspace, stdio: 'pipe', timeout: 180_000 });
    if (!existsSync(binary)) return { built: false, stack: input.stack, reason: 'COMPILER_PRODUCED_NO_BINARY' };
    return { built: true, stack: input.stack, run: run(binary, []), source_file: sourcePath };
  } catch (error) {
    return { built: false, stack: input.stack, reason: `BUILD_FAILED:${String((error as Error).message).slice(0, 160)}` };
  }
}

/** The checks in the protected policy. The boundary case is deliberately not among them. */
export const POLICY_CASES = [
  { check_id: 'unit', argument: 'rice:2,soap:1', expected: '11500' },
  { check_id: 'semantic', argument: 'rice:-1', expected: 'ERR' },
] as const;

/** The independent post-hoc audit, which is not in the policy and not visible to the worker. */
export const AUDIT_CASES = [
  { case_id: 'zero_quantity', argument: 'rice:0', expected: 'ERR', severity: 'high' as const },
  { case_id: 'unknown_product', argument: 'tuyo:1', expected: 'ERR', severity: 'high' as const },
] as const;
