/** A stand-in provider host for capability detection tests.
 *
 * It is not a provider and never contacts one. It exists so detection can be exercised
 * against the shapes a real host produces — a supported version, an output schema the
 * detector has never seen, an expired account, a missing subcommand — without spending
 * anything or depending on the machine's login state.
 *
 * Behaviour is chosen with FAKE_HOST_MODE:
 *   supported       a recognised version and a working capability subcommand
 *   unknown-schema  a version string the detector cannot parse
 *   expired-account authentication failure on every account-bound operation
 *   no-mcp          version works, the capability subcommand does not exist
 */
const mode = process.env['FAKE_HOST_MODE'] ?? 'supported';
const argv = process.argv.slice(2);

function out(text, code = 0) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}
function fail(text, code = 1) {
  process.stderr.write(`${text}\n`);
  process.exit(code);
}

if (argv[0] === '--version') {
  if (mode === 'unknown-schema') out('{"unexpected":"the version is now an object"}');
  out('9.9.9 (Fake Provider Host)');
}

if (argv[0] === 'mcp' && argv[1] === 'list') {
  if (mode === 'no-mcp') fail('error: unknown command "mcp"', 127);
  if (mode === 'expired-account') fail('Authentication required: your session has expired.', 1);
  out('No MCP servers configured.');
}

if (argv[0] === 'whoami' || argv[0] === '--print-account') {
  if (mode === 'expired-account') fail('Authentication required: your session has expired.', 1);
  out('account: fixture-account (native subscription)');
}

fail(`error: unrecognised invocation ${JSON.stringify(argv)}`, 64);
