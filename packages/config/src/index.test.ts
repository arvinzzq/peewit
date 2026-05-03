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

  test("supports OpenRouter API key as an OpenAI-compatible provider shortcut", () => {
    const config = loadConfig({
      env: {
        OPENROUTER_API_KEY: "sk-or-test-secret"
      }
    });

    expect(config.model.provider).toBe("openai-compatible");
    expect(config.model.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(config.model.model).toBe("openai/gpt-4.1-mini");
    expect(config.secrets.apiKey).toBe("sk-or-test-secret");
    expect(JSON.stringify(redactedConfig(config))).not.toContain("sk-or-test-secret");
  });

  test("lets generic ArvinClaw model settings override OpenRouter defaults", () => {
    const config = loadConfig({
      env: {
        OPENROUTER_API_KEY: "sk-or-test-secret",
        ARVINCLAW_BASE_URL: "https://custom.example/v1",
        ARVINCLAW_MODEL: "custom/model",
        ARVINCLAW_API_KEY: "sk-custom-secret"
      }
    });

    expect(config.model.baseURL).toBe("https://custom.example/v1");
    expect(config.model.model).toBe("custom/model");
    expect(config.secrets.apiKey).toBe("sk-custom-secret");
  });

  test("supports workspace root environment override", () => {
    const config = loadConfig({
      env: {
        ARVINCLAW_WORKSPACE_ROOT: "/workspace/arvinclaw"
      }
    });

    expect(config.workspace.root).toBe("/workspace/arvinclaw");
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
