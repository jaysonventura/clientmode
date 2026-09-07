/** Total-tree budget accounting. Reservations are taken before dispatch and include child,
 * review and retry work plus a verification reserve, so verification cannot be starved by
 * the implementation phase. An unknown provider counter reserves conservatively; it is
 * never read as zero, and "spend less" in a prompt is not a limit.
 */
import { randomUUID } from 'node:crypto';
import type { ControllerDatabase } from '../../state/src/database.js';

export class BudgetError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'BudgetError';
  }
}

export type BudgetPolicy = {
  project_id: string;
  cap_microusd: number;
  verification_reserve_microusd: number;
  unknown_usage_reserve_microusd: number;
  billing_mode: 'native_account' | 'approved_api';
};

export type BudgetState = {
  cap_microusd: number;
  reserved_microusd: number;
  settled_microusd: number;
  unknown_usage_events: number;
  verification_reserve_microusd: number;
  available_microusd: number;
  stopped: boolean;
};

export class BudgetLedger {
  readonly #db: ControllerDatabase;
  readonly #now: () => string;

  constructor(db: ControllerDatabase, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#now = options.clock ?? (() => new Date().toISOString());
  }

  /** Written by the maintainer/release owner, not by a model or a repository file. */
  setPolicy(policy: BudgetPolicy, set_by: 'maintainer' | 'release'): void {
    this.#db.run(`INSERT INTO budget_policies (project_id, cap_microusd, verification_reserve_microusd,
      unknown_usage_reserve_microusd, billing_mode, set_by, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET cap_microusd = excluded.cap_microusd,
        verification_reserve_microusd = excluded.verification_reserve_microusd,
        unknown_usage_reserve_microusd = excluded.unknown_usage_reserve_microusd,
        billing_mode = excluded.billing_mode, set_by = excluded.set_by, updated_at = excluded.updated_at`,
      policy.project_id, policy.cap_microusd, policy.verification_reserve_microusd,
      policy.unknown_usage_reserve_microusd, policy.billing_mode, set_by, this.#now());
  }

  policy(project_id: string): BudgetPolicy {
    const row = this.#db.get('SELECT * FROM budget_policies WHERE project_id = ?', project_id);
    if (!row) throw new BudgetError('NO_BUDGET_POLICY', project_id);
    return {
      project_id,
      cap_microusd: Number(row['cap_microusd']),
      verification_reserve_microusd: Number(row['verification_reserve_microusd']),
      unknown_usage_reserve_microusd: Number(row['unknown_usage_reserve_microusd']),
      billing_mode: String(row['billing_mode']) as BudgetPolicy['billing_mode'],
    };
  }

  /** Settled spend counts recorded usage; an incomplete counter reserves its upper bound. */
  state(project_id: string, run_id: string): BudgetState {
    const policy = this.policy(project_id);
    const reserved = Number(this.#db.get(
      "SELECT COALESCE(SUM(reserved_microusd), 0) AS total FROM budget_reservations WHERE run_id = ? AND status = 'RESERVED'",
      run_id)?.['total'] ?? 0);
    const known = Number(this.#db.get(
      'SELECT COALESCE(SUM(cost_microusd), 0) AS total FROM usage_events WHERE run_id = ? AND usage_complete = 1',
      run_id)?.['total'] ?? 0);
    const unknown = Number(this.#db.get(
      'SELECT COUNT(*) AS n FROM usage_events WHERE run_id = ? AND usage_complete = 0', run_id)?.['n'] ?? 0);
    const settled = known + unknown * policy.unknown_usage_reserve_microusd;
    const available = policy.cap_microusd - policy.verification_reserve_microusd - reserved - settled;
    return {
      cap_microusd: policy.cap_microusd, reserved_microusd: reserved, settled_microusd: settled,
      unknown_usage_events: unknown, verification_reserve_microusd: policy.verification_reserve_microusd,
      available_microusd: available, stopped: available <= 0,
    };
  }

  /** Reserve before dispatch. A reservation that would cross the cap is refused outright:
   * stopping before the call is the only enforcement the provider cannot overshoot. */
  reserve(input: {
    project_id: string; run_id: string; attempt_id: string; microusd: number; verification_reserve?: boolean;
  }): { reservation_id: string; state: BudgetState } {
    return this.#db.transaction(() => {
      const before = this.state(input.project_id, input.run_id);
      if (before.stopped || input.microusd > before.available_microusd) {
        throw new BudgetError('BUDGET_EXHAUSTED',
          `available ${before.available_microusd} microusd, requested ${input.microusd}`);
      }
      const reservation_id = `res_${randomUUID()}`;
      this.#db.run(`INSERT INTO budget_reservations (reservation_id, run_id, attempt_id, reserved_microusd,
        reserved_tokens, verification_reserve, status, created_at) VALUES (?,?,?,?,NULL,?,?,?)`,
        reservation_id, input.run_id, input.attempt_id, input.microusd,
        input.verification_reserve === true ? 1 : 0, 'RESERVED', this.#now());
      return { reservation_id, state: this.state(input.project_id, input.run_id) };
    });
  }

  settle(reservation_id: string, status: 'SETTLED' | 'RELEASED' | 'UNKNOWN' = 'SETTLED'): void {
    this.#db.run('UPDATE budget_reservations SET status = ? WHERE reservation_id = ?', status, reservation_id);
  }

  /** Cap enforcement granularity: reservations gate new work, but a request already in
   * flight can still overshoot its estimate. Report that rather than promising a hard cap. */
  enforcement(): { granularity: 'pre_dispatch_reservation'; in_flight_overrun_possible: true } {
    return { granularity: 'pre_dispatch_reservation', in_flight_overrun_possible: true };
  }
}
