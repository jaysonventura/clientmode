/** Open the controller state at a fixed instant, so several processes genuinely collide.
 *
 * Spawning processes and hoping they overlap is not a race test — startup latency staggers them
 * and the window closes. Every worker waits for the same wall-clock instant and opens then.
 */
import { ControllerDatabase } from '../../packages/state/src/database.js';

const [stateDir, atMs] = process.argv.slice(2);
const at = Number(atMs);
while (Date.now() < at) { /* barrier */ }
try {
  const db = ControllerDatabase.open(String(stateDir), { exclusive: false });
  db.get('SELECT COUNT(*) AS n FROM runs');
  db.close();
  process.exitCode = 0;
} catch (error) {
  process.stderr.write(`${String((error as Error).message)}\n`);
  process.exitCode = 1;
}
