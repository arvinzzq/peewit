/**
 * INPUT: User goal string, planner context (system instruction, available tool names), and an injectable ModelProvider.
 * OUTPUT: Plan with ordered PlanStep list via ModelBasedPlanner; Planner interface for dependency injection; plan type contracts.
 * POS: Planning layer; sits above AgentRuntime and decomposes goals into steps before execution.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { ModelProvider, ModelToolDefinition } from "@arvinclaw/models";

export const plannerPackageName = "@arvinclaw/planner";

export type PlanStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
  result?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface PlannerContext {
  systemInstruction: string;
  availableTools: string[];
}

export interface Planner {
  createPlan(goal: string, context: PlannerContext): Promise<Plan>;
}

const CREATE_PLAN_TOOL: ModelToolDefinition = {
  type: "function",
  function: {
    name: "create_plan",
    description: "Produce an ordered step-by-step plan to accomplish the user goal. Each step should be a concrete, actionable description.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of step descriptions. Each step should be specific enough to execute independently."
        }
      },
      required: ["steps"]
    }
  }
};

const PLANNING_SYSTEM_INSTRUCTION =
  "You are a task planner. Given a goal and available tools, produce a concise step-by-step plan. " +
  "Keep steps short and specific. Only include steps that require actual work — skip trivial setup. " +
  "Return the plan immediately using the create_plan tool.";

export interface ModelBasedPlannerConfig {
  modelProvider: ModelProvider;
  createPlanId?: () => string;
  now?: () => string;
}

export class ModelBasedPlanner implements Planner {
  readonly #modelProvider: ModelProvider;
  readonly #createPlanId: () => string;
  readonly #now: () => string;

  constructor(config: ModelBasedPlannerConfig) {
    this.#modelProvider = config.modelProvider;
    this.#createPlanId = config.createPlanId ?? (() => `plan_${crypto.randomUUID()}`);
    this.#now = config.now ?? (() => new Date().toISOString());
  }

  async createPlan(goal: string, context: PlannerContext): Promise<Plan> {
    const toolList =
      context.availableTools.length > 0
        ? `\n\nAvailable tools: ${context.availableTools.join(", ")}`
        : "";

    const output = await this.#modelProvider.generate({
      messages: [
        {
          role: "system",
          content: `${PLANNING_SYSTEM_INSTRUCTION}\n\n${context.systemInstruction}${toolList}`
        },
        {
          role: "user",
          content: `Create a plan to accomplish the following goal:\n\n${goal}`
        }
      ],
      tools: [CREATE_PLAN_TOOL]
    });

    if (output.type === "tool_calls") {
      const planCall = output.calls.find((c) => c.name === "create_plan");
      if (planCall !== undefined) {
        const steps = parsePlanSteps(planCall.input);
        if (steps.length > 0) {
          return { id: this.#createPlanId(), goal, steps, createdAt: this.#now() };
        }
        // Empty steps list — fall through to single-step fallback.
      }
    }

    // Fallback: message response, error, unrecognised tool call, or empty plan.
    const content = output.type === "message" ? output.content : "";
    return {
      id: this.#createPlanId(),
      goal,
      steps: [{ id: "step_1", description: content || goal, status: "pending" }],
      createdAt: this.#now()
    };
  }
}

function parsePlanSteps(input: unknown): PlanStep[] {
  if (
    typeof input === "object" &&
    input !== null &&
    "steps" in input &&
    Array.isArray((input as { steps: unknown }).steps)
  ) {
    const rawSteps = (input as { steps: unknown[] }).steps;
    return rawSteps
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((description, index) => ({
        id: `step_${index + 1}`,
        description: description.trim(),
        status: "pending" as const
      }));
  }
  return [];
}
