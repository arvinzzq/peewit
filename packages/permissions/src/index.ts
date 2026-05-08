/**
 * INPUT: Tool actions, autonomy mode, and risk metadata.
 * OUTPUT: Permission decisions with trace-safe reasons, DefaultPermissionPolicy (risk × mode matrix), and AlwaysAllowPolicy as the null/pass-through implementation.
 * POS: Permission layer; decides allow, ask, or deny without executing tools or rendering prompts.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
export const permissionsPackageName = "@vole/permissions";

export type AutonomyMode = "observe" | "confirm" | "auto";
export type PermissionRiskLevel = "low" | "medium" | "high" | "blocked";
export type PermissionDecisionType = "allow" | "ask" | "deny";

export interface PermissionAction {
  kind: "tool";
  name: string;
  summary: string;
  risk: PermissionRiskLevel;
}

export interface PermissionEvaluationInput {
  mode: AutonomyMode;
  action: PermissionAction;
}

export interface PermissionDecision {
  decision: PermissionDecisionType;
  risk: PermissionRiskLevel;
  reason: string;
}

export interface PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision {
    const risk = input.action.risk;

    if (risk === "blocked") {
      return {
        decision: "deny",
        risk,
        reason: "Blocked actions are denied."
      };
    }

    if (input.mode === "observe") {
      return {
        decision: "ask",
        risk,
        reason: "Observe mode asks before external actions."
      };
    }

    if (input.mode === "auto") {
      return risk === "high"
        ? {
            decision: "ask",
            risk,
            reason: "High-risk action requires approval in auto mode."
          }
        : {
            decision: "allow",
            risk,
            reason: "Low and medium-risk actions are allowed in auto mode."
          };
    }

    return risk === "low"
      ? {
          decision: "allow",
          risk,
          reason: "Low-risk action is allowed in confirm mode."
        }
      : {
          decision: "ask",
          risk,
          reason: "Medium and high-risk actions require approval in confirm mode."
        };
  }
}

export class AlwaysAllowPolicy implements PermissionPolicy {
  evaluate(input: PermissionEvaluationInput): PermissionDecision {
    const risk = input.action.risk;
    if (risk === "blocked") {
      return { decision: "deny", risk, reason: "Blocked actions are always denied." };
    }
    return { decision: "allow", risk, reason: "AlwaysAllowPolicy permits all non-blocked actions." };
  }
}
