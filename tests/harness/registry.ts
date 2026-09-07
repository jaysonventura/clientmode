import type { ScenarioExecutor, ScenarioObservation } from '../../contracts/interfaces.js';
const scenarios = new Map<string, ScenarioExecutor>();
export function registerScenario(id: string, execute: ScenarioExecutor): void {
  if (scenarios.has(id)) throw new Error(`DUPLICATE_SCENARIO:${id}`);
  scenarios.set(id, execute);
}
export async function exerciseScenario(id: string): Promise<ScenarioObservation> {
  const execute = scenarios.get(id);
  if (!execute) throw new Error(`UNREGISTERED_SCENARIO:${id}`);
  const result = await execute();
  if (result.scenario_id !== id) throw new Error('SCENARIO_ID_MISMATCH');
  return result;
}
