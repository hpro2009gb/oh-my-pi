/** Settings the plan-gate reads. */
export interface PlanGateSettingsReader {
	get(path: "plan.enabled" | "plan.gate.enabled"): boolean;
}

/**
 * True when the opt-in plan-gate is on and plan mode itself is available.
 * Default is off: callers must set `plan.gate.enabled` (or pass `--plan-gate`).
 */
export function isPlanGateEnabled(settings: PlanGateSettingsReader): boolean {
	return settings.get("plan.enabled") === true && settings.get("plan.gate.enabled") === true;
}

/** Shown when a gated session tries to leave plan mode before the user accepts the plan. */
export const PLAN_GATE_LEAVE_BLOCKED_MESSAGE = "Plan gate is on: accept the plan before leaving plan mode.";
