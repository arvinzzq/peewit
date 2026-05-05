import { describe, expect, test } from "vitest";
import {
  adaptersPackageName,
  BACKGROUND_CAPABILITIES,
  CLI_CAPABILITIES,
  WEB_CAPABILITIES,
  type AdapterCapabilities,
  type AdapterStorageType
} from "./index.js";

describe("adaptersPackageName", () => {
  test("has expected package name", () => {
    expect(adaptersPackageName).toBe("@arvinclaw/adapters");
  });
});

describe("AdapterCapabilities", () => {
  test("CLI_CAPABILITIES has streaming and approvalPrompts, not background", () => {
    expect(CLI_CAPABILITIES.streaming).toBe(true);
    expect(CLI_CAPABILITIES.approvalPrompts).toBe(true);
    expect(CLI_CAPABILITIES.background).toBe(false);
  });

  test("WEB_CAPABILITIES has streaming and approvalPrompts, not background", () => {
    expect(WEB_CAPABILITIES.streaming).toBe(true);
    expect(WEB_CAPABILITIES.approvalPrompts).toBe(true);
    expect(WEB_CAPABILITIES.background).toBe(false);
  });

  test("BACKGROUND_CAPABILITIES has background only, no streaming or approvalPrompts", () => {
    expect(BACKGROUND_CAPABILITIES.streaming).toBe(false);
    expect(BACKGROUND_CAPABILITIES.approvalPrompts).toBe(false);
    expect(BACKGROUND_CAPABILITIES.background).toBe(true);
  });

  test("constants satisfy AdapterCapabilities interface", () => {
    const checkInterface = (caps: AdapterCapabilities) => {
      expect(typeof caps.streaming).toBe("boolean");
      expect(typeof caps.approvalPrompts).toBe("boolean");
      expect(typeof caps.background).toBe("boolean");
    };

    checkInterface(CLI_CAPABILITIES);
    checkInterface(WEB_CAPABILITIES);
    checkInterface(BACKGROUND_CAPABILITIES);
  });

  test("a background-capable adapter cannot approve interactively", () => {
    // background adapters must not have approvalPrompts — they run unattended
    const backgroundAdapters = [BACKGROUND_CAPABILITIES];
    for (const caps of backgroundAdapters) {
      if (caps.background) {
        expect(caps.approvalPrompts).toBe(false);
      }
    }
  });
});

describe("AdapterStorageType", () => {
  test("valid storage types can be assigned", () => {
    const types: AdapterStorageType[] = ["in-memory", "jsonl", "sqlite"];
    expect(types).toHaveLength(3);
  });
});
