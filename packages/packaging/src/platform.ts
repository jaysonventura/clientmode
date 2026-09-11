/** The three places macOS, Linux and Windows differ for an install.
 *
 * Finding an executable: Windows looks for `name` + each PATHEXT extension; a bare file is not
 * runnable there. Launchers: a POSIX shell script everywhere, plus a `.cmd` on Windows, where
 * PowerShell and cmd.exe cannot run the script. Spawning: npm installs Windows commands as `.cmd`
 * shims, which Node refuses to spawn without a shell, and a shell re-parses every argument — so the
 * command line is built with each argument quoted and cmd.exe's metacharacters escaped (twice,
 * because the shim is a batch file that cmd.exe parses again).
 */
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function findExecutable(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | null {
  const windows = platform === 'win32';
  const delimiter = windows ? ';' : ':';
  const directories = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(entry => entry !== '');
  const extensions = windows ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      for (const candidate of windows ? [extension, extension.toLowerCase()] : [extension]) {
        const file = path.join(directory, `${name}${candidate}`);
        try {
          if (statSync(file).isFile()) return file;
        } catch { /* not here */ }
      }
    }
  }
  return null;
}

/** Quote one argument for a Windows command line, then escape cmd.exe metacharacters. */
function escapeForCmd(argument: string, doubleEscape: boolean): string {
  let quoted = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  quoted = `"${quoted}"`;
  const meta = /([()\][%!^"`<>&|;, *?])/g;
  quoted = quoted.replace(meta, '^$1');
  return doubleEscape ? quoted.replace(meta, '^$1') : quoted;
}

export type SpawnPlan = { command: string; args: string[]; verbatim: boolean };

export function spawnPlan(executable: string, args: readonly string[], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): SpawnPlan {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable)) return { command: executable, args: [...args], verbatim: false };
  const line = [escapeForCmd(executable, false), ...args.map(argument => escapeForCmd(argument, true))].join(' ');
  // By full path: a bare `cmd.exe` can be resolved from the current directory — a project folder.
  const shell = env['ComSpec'] ?? path.win32.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe');
  return { command: shell, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

/** Write the `cm` launcher(s) into `bin_dir`. Each one names the toolkit it belongs to and the
 * node it was installed with, so it never depends on where the source was or what is on PATH. */
export function writeLauncher(input: { bin_dir: string; toolkit_root: string; node: string; platform?: NodeJS.Platform }): string[] {
  const platform = input.platform ?? process.platform;
  mkdirSync(input.bin_dir, { recursive: true });
  const written: string[] = [];
  if (platform === 'win32') {
    const cmd = path.join(input.bin_dir, 'cm.cmd');
    writeFileSync(cmd, [
      '@echo off',
      'rem Client Mode. Installed by `cm install`; remove it with `cm uninstall`.',
      `if not defined CM_TOOLKIT_ROOT set "CM_TOOLKIT_ROOT=${input.toolkit_root}"`,
      `"${input.node}" --disable-warning=ExperimentalWarning "%CM_TOOLKIT_ROOT%\\cm.js" %*`,
      '',
    ].join('\r\n'));
    written.push(cmd);
  }
  const script = path.join(input.bin_dir, 'cm');
  // Git Bash on Windows runs this one; there the paths are converted by the shell itself.
  writeFileSync(script, `#!/bin/sh
# Client Mode. Installed by \`cm install\`; remove it with \`cm uninstall\`.
CM_TOOLKIT_ROOT="\${CM_TOOLKIT_ROOT:-${input.toolkit_root}}"
export CM_TOOLKIT_ROOT
exec "${input.node}" --disable-warning=ExperimentalWarning "$CM_TOOLKIT_ROOT/cm.js" "$@"
`);
  // A `mode` on writeFileSync only applies when the file is created; chmod always applies.
  chmodSync(script, 0o755);
  written.push(script);
  return written;
}

/** The toolkit a launcher names, from either launcher form. */
export function launcherToolkitRoot(text: string): string | null {
  const posix = /CM_TOOLKIT_ROOT:-([^}"]+)\}/.exec(text)?.[1];
  if (posix !== undefined) return posix;
  const windows = /set "CM_TOOLKIT_ROOT=([^"]+)"/.exec(text)?.[1];
  return windows ?? null;
}

export function isExecutableLauncher(file: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!existsSync(file)) return false;
  // Windows has no execute bit; a .cmd is runnable by its extension.
  if (platform === 'win32') return true;
  // eslint-disable-next-line no-bitwise
  return (statSync(file).mode & 0o111) !== 0;
}
