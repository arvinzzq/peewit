import { describe, expect, test } from "vitest";
import { ConfigValidationError, loadConfig, redactedConfig, resolveSessionsDirectory } from "./index.js";

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
        VOLE_MODEL: "env-model",
        VOLE_DEFAULT_MODE: "auto"
      }
    });

    expect(config.model.model).toBe("env-model");
    expect(config.runtime.defaultMode).toBe("auto");
  });

  test("keeps secrets available to consumers but redacts display output", () => {
    const config = loadConfig({
      env: {
        VOLE_API_KEY: "sk-test-secret"
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

  test("requires VOLE_MODEL when using OPENROUTER_API_KEY", () => {
    expect(() =>
      loadConfig({ env: { OPENROUTER_API_KEY: "sk-or-test-secret" } })
    ).toThrow(ConfigValidationError);
  });

  test("supports OpenRouter API key with explicit model", () => {
    const config = loadConfig({
      env: {
        OPENROUTER_API_KEY: "sk-or-test-secret",
        VOLE_MODEL: "openai/gpt-4o"
      }
    });

    expect(config.model.provider).toBe("openai-compatible");
    expect(config.model.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(config.model.model).toBe("openai/gpt-4o");
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

  test("lets VOLE_MODEL override the Anthropic default model", () => {
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-secret",
        VOLE_MODEL: "claude-sonnet-4-6"
      }
    });

    expect(config.model.provider).toBe("anthropic");
    expect(config.model.model).toBe("claude-sonnet-4-6");
  });

  test("lets generic VOLE_API_KEY override ANTHROPIC_API_KEY shortcut", () => {
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-secret",
        VOLE_API_KEY: "sk-override-secret"
      }
    });

    expect(config.model.provider).toBe("anthropic");
    expect(config.secrets.apiKey).toBe("sk-override-secret");
  });

  test("lets generic Vole model settings override OpenRouter defaults", () => {
    const config = loadConfig({
      env: {
        OPENROUTER_API_KEY: "sk-or-test-secret",
        VOLE_BASE_URL: "https://custom.example/v1",
        VOLE_MODEL: "custom/model",
        VOLE_API_KEY: "sk-custom-secret"
      }
    });

    expect(config.model.baseURL).toBe("https://custom.example/v1");
    expect(config.model.model).toBe("custom/model");
    expect(config.secrets.apiKey).toBe("sk-custom-secret");
  });

  test("supports workspace root environment override", () => {
    const config = loadConfig({
      env: {
        VOLE_WORKSPACE_ROOT: "/workspace/vole"
      }
    });

    expect(config.workspace.root).toBe("/workspace/vole");
  });

  test("keeps long-term memory files disabled by default", () => {
    const config = loadConfig();

    expect(config.memory.longTermFiles).toBe("disabled");
    expect(config.memory.writes).toBe("disabled");
  });

  test("supports read-only long-term memory file policy", () => {
    const config = loadConfig({
      env: {
        VOLE_LONG_TERM_MEMORY: "read-only"
      }
    });

    expect(config.memory.longTermFiles).toBe("read-only");
    expect(config.memory.writes).toBe("disabled");
  });

  test("rejects invalid long-term memory policy values", () => {
    expect(() =>
      loadConfig({
        env: {
          VOLE_LONG_TERM_MEMORY: "invalid-policy"
        }
      })
    ).toThrow(ConfigValidationError);
  });

  test("accepts write as a valid long-term memory policy", () => {
    const config = loadConfig({ env: { VOLE_LONG_TERM_MEMORY: "write" } });
    expect(config.memory.longTermFiles).toBe("write");
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

  test("supports VOLE_PROMPT_MODE env var", () => {
    const config = loadConfig({
      env: {
        VOLE_PROMPT_MODE: "minimal"
      }
    });

    expect(config.runtime.promptMode).toBe("minimal");
  });

  test("rejects invalid prompt mode values", () => {
    expect(() =>
      loadConfig({
        env: {
          VOLE_PROMPT_MODE: "invalid"
        }
      })
    ).toThrow(ConfigValidationError);
  });

  test("supports VOLE_EXECUTION_CONTRACT env var", () => {
    const config = loadConfig({
      env: {
        VOLE_EXECUTION_CONTRACT: "strict-agentic"
      }
    });

    expect(config.runtime.executionContract).toBe("strict-agentic");
  });

  test("rejects invalid VOLE_EXECUTION_CONTRACT values", () => {
    expect(() =>
      loadConfig({
        env: {
          VOLE_EXECUTION_CONTRACT: "turbo-mode"
        }
      })
    ).toThrow(ConfigValidationError);
  });

  test("supports VOLE_TOOL_PROFILE env var", () => {
    for (const profile of ["coding", "full", "messaging", "background"] as const) {
      const config = loadConfig({
        env: {
          VOLE_TOOL_PROFILE: profile
        }
      });
      expect(config.runtime.toolProfile).toBe(profile);
    }
  });

  test("rejects invalid tool profile value", () => {
    expect(() =>
      loadConfig({
        env: {
          VOLE_TOOL_PROFILE: "ninja"
        }
      })
    ).toThrow(ConfigValidationError);
  });

  test("VOLE_SANDBOX=true enables sandbox mode", () => {
    const config = loadConfig({
      env: {
        VOLE_SANDBOX: "true"
      }
    });

    expect(config.runtime.sandboxed).toBe(true);
  });

  test("VOLE_SANDBOX=false keeps sandbox mode disabled", () => {
    const config = loadConfig({
      env: {
        VOLE_SANDBOX: "false"
      }
    });

    expect(config.runtime.sandboxed).toBe(false);
  });

  test("supports VOLE_THINKING_BUDGET env var", () => {
    for (const budget of ["off", "minimal", "low", "medium", "high", "max", "adaptive"] as const) {
      const config = loadConfig({
        env: {
          VOLE_THINKING_BUDGET: budget
        }
      });
      expect(config.model.thinkingBudget).toBe(budget);
    }
  });

  test("rejects invalid thinking budget value", () => {
    expect(() =>
      loadConfig({
        env: {
          VOLE_THINKING_BUDGET: "extreme"
        }
      })
    ).toThrow(ConfigValidationError);
  });
});

describe("resolveSessionsDirectory", () => {
  test("returns absolute path unchanged", () => {
    const config = loadConfig();
    const result = resolveSessionsDirectory(
      { ...config, sessions: { directory: "/absolute/path/sessions" } },
      { HOME: "/home/user" }
    );

    expect(result).toBe("/absolute/path/sessions");
  });

  test("expands ~/path using HOME from provided env", () => {
    const config = loadConfig();
    const result = resolveSessionsDirectory(
      { ...config, sessions: { directory: "~/.vole/sessions" } },
      { HOME: "/home/testuser" }
    );

    expect(result).toBe("/home/testuser/.vole/sessions");
  });

  test("returns ~/ path unchanged when HOME is not in env and not in process.env", () => {
    const config = loadConfig();
    // Pass an env without HOME and ensure process.env.HOME is shadowed
    const originalHome = process.env.HOME;
    delete process.env.HOME;

    try {
      const result = resolveSessionsDirectory(
        { ...config, sessions: { directory: "~/.vole/sessions" } },
        {}
      );

      expect(result).toBe("~/.vole/sessions");
    } finally {
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      }
    }
  });

  test("uses default config sessions directory (~/. path) when called with default config", () => {
    const config = loadConfig();

    expect(config.sessions.directory).toBe("~/.vole/sessions");

    const result = resolveSessionsDirectory(config, { HOME: "/home/arvin" });

    expect(result).toBe("/home/arvin/.vole/sessions");
  });
});
