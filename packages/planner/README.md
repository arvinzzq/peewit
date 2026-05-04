# Planner Package

## Architecture Summary

This directory owns goal decomposition and plan generation.
It calls the model once with a `create_plan` tool to produce a structured plan before AgentRuntime executes the steps.
It exposes a Planner interface so the implementation can be swapped without changing AgentRuntime.

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the planner package and its dependency on models. |
| `tsconfig.json` | TypeScript config | Builds the planner package with a reference to models. |
| `src/index.ts` | Planner | Exports Plan, PlanStep, PlanStepStatus, Planner interface, PlannerContext, and ModelBasedPlanner with injectable ModelProvider and create_plan tool injection. |
| `src/index.test.ts` | Planner tests | Protects plan generation from tool call responses, fallback behavior, step ID assignment, pending status, and model request content. |

## Update Reminder

Update this file when the directory structure changes.
