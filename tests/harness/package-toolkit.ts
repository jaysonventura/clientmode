/** The packager lives in the product: a gate that built its own bundle would be testing a
 * package nobody ships. */
export { buildPortableToolkit as packageToolkit, CARRIED_DIRECTORIES } from '../../packages/packaging/src/portable.js';
