import { describe, expect, test } from "vitest";
import { DefaultPermissionPolicy, type PermissionPolicy } from "./index.js";

describe("default permission policy", () => {
  test("auto-allows low-risk actions in confirm mode", () => {
    const policy: PermissionPolicy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "confirm",
        action: {
          kind: "tool",
          name: "read_file",
          summary: "Read package.json",
          risk: "low"
        }
      })
    ).toEqual({
      decision: "allow",
      risk: "low",
      reason: "Low-risk action is allowed in confirm mode."
    });
  });

  test("asks for medium and high-risk actions in confirm mode", () => {
    const policy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "confirm",
        action: {
          kind: "tool",
          name: "write_file",
          summary: "Write README.md",
          risk: "medium"
        }
      })
    ).toMatchObject({
      decision: "ask",
      risk: "medium"
    });
    expect(
      policy.evaluate({
        mode: "confirm",
        action: {
          kind: "tool",
          name: "shell",
          summary: "Run pnpm install",
          risk: "high"
        }
      })
    ).toMatchObject({
      decision: "ask",
      risk: "high"
    });
  });

  test("asks for every non-blocked action in observe mode", () => {
    const policy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "observe",
        action: {
          kind: "tool",
          name: "read_file",
          summary: "Read package.json",
          risk: "low"
        }
      })
    ).toEqual({
      decision: "ask",
      risk: "low",
      reason: "Observe mode asks before external actions."
    });
  });

  test("auto-allows low and medium-risk actions in auto mode but asks for high-risk actions", () => {
    const policy = new DefaultPermissionPolicy();

    expect(
      policy.evaluate({
        mode: "auto",
        action: {
          kind: "tool",
          name: "write_file",
          summary: "Write generated report",
          risk: "medium"
        }
      })
    ).toMatchObject({
      decision: "allow",
      risk: "medium"
    });
    expect(
      policy.evaluate({
        mode: "auto",
        action: {
          kind: "tool",
          name: "shell",
          summary: "Run migration",
          risk: "high"
        }
      })
    ).toMatchObject({
      decision: "ask",
      risk: "high"
    });
  });

  test("denies blocked actions in every mode", () => {
    const policy = new DefaultPermissionPolicy();

    for (const mode of ["observe", "confirm", "auto"] as const) {
      expect(
        policy.evaluate({
          mode,
          action: {
            kind: "tool",
            name: "shell",
            summary: "Delete the workspace",
            risk: "blocked"
          }
        })
      ).toEqual({
        decision: "deny",
        risk: "blocked",
        reason: "Blocked actions are denied."
      });
    }
  });
});
