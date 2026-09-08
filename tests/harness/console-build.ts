/** The console bundler lives in the product, not the harness: a gate that bundled the console
 * its own way would be testing a build nobody ships. */
export { buildConsole } from '../../apps/cli/src/console-bundle.js';
