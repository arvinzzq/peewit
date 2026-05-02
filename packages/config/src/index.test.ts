import { describe, expect, test } from "vitest";
import { ConfigValidationError, loadConfig, redactedConfig } from "./index.js";

describe("loadConfig", () => {
  test("loads built-in defaults", () => {
    const config = loadConfig();

    expect(config.model.provider).toBe("openai-compatible");
    expect(config.runtime.defaultMode).toBe("confirm");
    expect(config.workspace.root).toBe(".");
  });

  test("applies user config, project config, then environment overrides", () => {
    const config = loadConfig({
      userConfig: {
        model: {
          model: "user-model"
        },
        runtime: {
          defaultMode: "observe"
        }
      },
      projectConfig: {
        model: {
          model: "project-model"
        }
      },
      env: {
        ARVINCLAW_MODEL: "env-model",
        ARVINCLAW_DEFAULT_MODE: "auto"
      }
    });

    expect(config.model.model).toBe("env-model");
    expect(config.runtime.defaultMode).toBe("auto");
  });

  test("keeps secrets available to consumers but redacts display output", () => {
    const config = loadConfig({
      env: {
        ARVINCLAW_API_KEY: "sk-test-secret"
      }
    });

    expect(config.secrets.apiKey).toBe("sk-test-secret");
    expect(redactedConfig(config)).toMatchObject({
      secrets: {
        apiKey: "configured"
      }
    });
    expect(JSON.stringify(redactedConfig(config))).not.toContain("sk-test-secret");
  });

  test("rejects invalid autonomy modes", () => {
    expect(() =>
      loadConfig({
        projectConfig: {
          runtime: {
            defaultMode: "reckless"
          }
        }
      })
    ).toThrow(ConfigValidationError);
  });
});
