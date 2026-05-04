import { describe, expect, test } from "vitest";
import { FakeModelProvider } from "@arvinclaw/models";
import { ModelBasedPlanner, type PlannerContext } from "./index.js";

const context: PlannerContext = {
  systemInstruction: "You are ArvinClaw.",
  availableTools: ["read_file", "write_file", "run_shell"]
};

describe("ModelBasedPlanner", () => {
  test("creates a plan from a create_plan tool call", async () => {
    const planner = new ModelBasedPlanner({
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [
            {
              id: "call_plan",
              name: "create_plan",
              input: {
                steps: [
                  "List all markdown files in the project",
                  "Read each file",
                  "Write a summary document"
                ]
              }
            }
          ]
        }
      ]),
      createPlanId: () => "plan_test",
      now: () => "2026-05-04T10:00:00.000Z"
    });

    const plan = await planner.createPlan("Summarize markdown files", context);

    expect(plan.id).toBe("plan_test");
    expect(plan.goal).toBe("Summarize markdown files");
    expect(plan.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]).toEqual({ id: "step_1", description: "List all markdown files in the project", status: "pending" });
    expect(plan.steps[1]).toEqual({ id: "step_2", description: "Read each file", status: "pending" });
    expect(plan.steps[2]).toEqual({ id: "step_3", description: "Write a summary document", status: "pending" });
  });

  test("all steps start as pending", async () => {
    const planner = new ModelBasedPlanner({
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "call_plan", name: "create_plan", input: { steps: ["Step A", "Step B"] } }]
        }
      ])
    });

    const plan = await planner.createPlan("Do something", context);

    expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
  });

  test("falls back to a single-step plan when model returns a message", async () => {
    const planner = new ModelBasedPlanner({
      modelProvider: new FakeModelProvider([{ type: "message", content: "Execute the task directly." }]),
      createPlanId: () => "plan_fallback"
    });

    const plan = await planner.createPlan("Simple task", context);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.description).toBe("Execute the task directly.");
    expect(plan.steps[0]?.status).toBe("pending");
  });

  test("falls back gracefully when model returns an error", async () => {
    const planner = new ModelBasedPlanner({
      modelProvider: new FakeModelProvider([
        { type: "error", category: "network", message: "Network failed.", recoverable: true }
      ])
    });

    const plan = await planner.createPlan("Any goal", context);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.status).toBe("pending");
  });

  test("sends goal and available tools to the model", async () => {
    const provider = new FakeModelProvider([
      {
        type: "tool_calls",
        calls: [{ id: "c", name: "create_plan", input: { steps: ["Do it"] } }]
      }
    ]);
    const planner = new ModelBasedPlanner({ modelProvider: provider });

    await planner.createPlan("Write a report", {
      systemInstruction: "You are ArvinClaw.",
      availableTools: ["read_file", "write_file"]
    });

    const request = provider.requests[0];
    expect(request?.messages.at(-1)?.content).toContain("Write a report");
    expect(request?.messages[0]?.content).toContain("read_file");
    expect(request?.tools).toMatchObject([{ type: "function", function: { name: "create_plan" } }]);
  });

  test("skips empty strings in the steps array", async () => {
    const planner = new ModelBasedPlanner({
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "c", name: "create_plan", input: { steps: ["Step 1", "", "  ", "Step 2"] } }]
        }
      ])
    });

    const plan = await planner.createPlan("Goal", context);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.description).toBe("Step 1");
    expect(plan.steps[1]?.description).toBe("Step 2");
  });

  test("handles empty steps array with fallback", async () => {
    const planner = new ModelBasedPlanner({
      modelProvider: new FakeModelProvider([
        {
          type: "tool_calls",
          calls: [{ id: "c", name: "create_plan", input: { steps: [] } }]
        }
      ])
    });

    const plan = await planner.createPlan("Empty plan goal", context);

    // Empty steps from create_plan → no valid steps → fallback to goal-as-step
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.description).toBe("Empty plan goal");
  });
});
