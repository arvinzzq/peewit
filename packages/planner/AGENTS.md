# Planner Agent Guide

## Responsibility

Keep goal decomposition and plan generation here. This package exposes the Planner interface, Plan and PlanStep types, and ModelBasedPlanner. Callers inject a ModelProvider; the planner calls it once with a create_plan tool to produce a structured plan. Step execution belongs to AgentRuntime, not here.

## When Files Change

Update README and AGENTS files when plan types, planner interface, or file inventory change. Update `src/index.ts` header when inputs, outputs, or system position change.

## Testing

Plan generation from tool call responses, fallback behavior (message, error, empty steps), step ID assignment, pending status on all steps, and tool/goal injection into model context all need tests.

## Boundaries

Do not execute plan steps, manage permissions, call model providers repeatedly per step, or own session state here. The planner produces a plan; AgentRuntime executes it.
