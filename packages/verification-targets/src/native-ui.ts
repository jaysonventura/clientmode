/** Native target execution with the platform's own toolchain.
 *
 * The binary is compiled by swiftc and then actually run and interacted with. Nothing here
 * renders HTML, and a passing web journey is never accepted in place of one of these results.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type NativeBuild =
  | { built: true; binary: string; compiler: string; target_triple: string; build_log: string }
  | { built: false; reason: 'TOOLCHAIN_UNAVAILABLE' | 'COMPILE_FAILED'; detail: string };

export type NativeInteraction = {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  responses: string[];
};

function compilerVersion(): { compiler: string; target_triple: string } | null {
  try {
    const raw = execFileSync('swiftc', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const target = /Target:\s*(\S+)/.exec(raw)?.[1] ?? 'unknown';
    return { compiler: raw.split('\n')[0]?.trim() ?? 'swiftc', target_triple: target };
  } catch {
    return null;
  }
}

/** Compile a Swift source file for the host platform. */
export function buildSwiftBinary(input: { source: string; workspace: string; name: string }): NativeBuild {
  const version = compilerVersion();
  if (version === null) return { built: false, reason: 'TOOLCHAIN_UNAVAILABLE', detail: 'swiftc is not available on this host' };
  mkdirSync(input.workspace, { recursive: true });
  const sourceFile = path.join(input.workspace, `${input.name}.swift`);
  const binary = path.join(input.workspace, input.name);
  writeFileSync(sourceFile, input.source);
  const compile = spawnSync('swiftc', ['-O', '-o', binary, sourceFile], { encoding: 'utf8' });
  if (compile.status !== 0) {
    return { built: false, reason: 'COMPILE_FAILED', detail: `${compile.stdout ?? ''}${compile.stderr ?? ''}`.slice(0, 2000) };
  }
  return { built: true, binary, compiler: version.compiler, target_triple: version.target_triple, build_log: (compile.stderr ?? '').slice(0, 2000) };
}

/** Drive the built binary through a real request/response exchange on stdin and stdout. */
export function interactWithNativeBinary(binary: string, requests: string[], timeoutMs = 20_000): NativeInteraction {
  const run = spawnSync(binary, [], { input: requests.join('\n') + '\n', encoding: 'utf8', timeout: timeoutMs });
  const stdout = run.stdout ?? '';
  return {
    exit_code: run.status,
    stdout: stdout.slice(0, 20_000),
    stderr: (run.stderr ?? '').slice(0, 4000),
    responses: stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0),
  };
}

/** The correct native pricing rule: integer centavos, no lossy division. */
export const SWIFT_PRICING_SOURCE = `import Foundation

let prices: [String: Int] = ["rice": 5500, "soap": 2500]

while let line = readLine() {
    let parts = line.split(separator: " ").map(String.init)
    guard parts.count % 2 == 0 else { print("ERROR bad_request"); continue }
    var total = 0
    var valid = true
    var index = 0
    while index < parts.count {
        guard let price = prices[parts[index]], let quantity = Int(parts[index + 1]), quantity >= 1, quantity <= 99 else {
            valid = false
            break
        }
        total += price * quantity
        index += 2
    }
    print(valid ? "TOTAL \\(total)" : "ERROR invalid_item")
}
`;

/** A platform defect: integer division loses the centavos. It must be rejected, not rounded
 * away by a tolerant assertion. */
export const SWIFT_PRICING_DEFECT_SOURCE = SWIFT_PRICING_SOURCE
  .replace('total += price * quantity', 'total += (price / 100) * quantity');
