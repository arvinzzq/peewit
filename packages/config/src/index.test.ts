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

  test("supports ANTHROPIC_API_KEY as an Anthropic provider shortcut", () => {
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-secret"
      }
    });

    expect(config.model.provider).toBe("anthropic");
    expect(config.model.model).toBe("claude-haiku-4-5-20251001");
    expect(config.secrets.apiKey).toBe("sk-ant-test-secret");
    expect(JSON.stringify(redactedConfig(config))).not.toContain("sk-ant-test-secret");
  });

  test("lets ARVINCLAW_MODEL override the Anthropic default model", () => {
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-secret",
        ARVINCLAW_MODEL: "claude-sonnet-4-6"
      }
    });

    expect(config.model.provider).toBe("anthropic");
    expect(config.model.model).toBe("claude-sonnet-4-6");
  });

  test("lets generic ARVINCLAW_API_KEY override ANTHROPIC_API_KEY shortcut", () => {
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-secret",
        ARVINCLAW_API_KEY: "sk-override-secret"
      }
    });

    expect(config.model.provider).toBe("anthropic");
    expect(config.secrets.apiKey).toBe("sk-override-secret");
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

  test("keeps long-term memory files disabled by default", () => {
    const config = loadConfig();

    expect(config.memory.longTermFiles).toBe("disabled");
    expect(config.memory.writes).toBe("disabled");
  });

  test("supports read-only long-term memory file policy", () => {
    const config = loadConfig({
      env: {
        ARVINCLAW_LONG_TERM_MEMORY: "read-only"
      }
    });

    expect(config.memory.longTermFiles).toBe("read-only");
    expect(config.memory.writes).toBe("disabled");
  });

  test("rejects invalid long-term memory policy values", () => {
    expect(() =>
      loadConfig({
        env: {
          ARVINCLAW_LONG_TERM_MEMORY: "write"
        }
      })
    ).toThrow(ConfigValidationError);
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
