import { describe, expect, test } from "vitest";
import { CLI_CAPABILITIES, WEB_CAPABILITIES } from "@peewit/adapters";
import { SessionGateway, type GatewaySession } from "./index.js";

function makeSession(overrides: Partial<GatewaySession> = {}): GatewaySession {
  return {
    id: "session_1",
    adapterName: "cli",
    capabilities: CLI_CAPABILITIES,
    registeredAt: "2026-05-05T10:00:00.000Z",
    lastActivityAt: "2026-05-05T10:00:00.000Z",
    ...overrides
  };
}

describe("SessionGateway", () => {
  test("register makes the session retrievable by id", () => {
    const gateway = new SessionGateway();
    const session = makeSession();

    gateway.register(session);

    expect(gateway.get("session_1")).toEqual(session);
  });

  test("unregister removes the session", () => {
    const gateway = new SessionGateway();
    const session = makeSession();

    gateway.register(session);
    gateway.unregister("session_1");

    expect(gateway.get("session_1")).toBeUndefined();
  });

  test("get returns undefined for an unknown session", () => {
    const gateway = new SessionGateway();

    expect(gateway.get("session_unknown")).toBeUndefined();
  });

  test("list returns all registered sessions", () => {
    const gateway = new SessionGateway();
    const s1 = makeSession({ id: "session_1", adapterName: "cli" });
    const s2 = makeSession({ id: "session_2", adapterName: "web", capabilities: WEB_CAPABILITIES });

    gateway.register(s1);
    gateway.register(s2);

    expect(gateway.list()).toHaveLength(2);
    expect(gateway.list().map((s) => s.id)).toEqual(expect.arrayContaining(["session_1", "session_2"]));
  });

  test("list returns empty array when no sessions are registered", () => {
    const gateway = new SessionGateway();

    expect(gateway.list()).toEqual([]);
  });

  test("listByAdapter filters sessions by adapter name", () => {
    const gateway = new SessionGateway();
    gateway.register(makeSession({ id: "cli_1", adapterName: "cli" }));
    gateway.register(makeSession({ id: "cli_2", adapterName: "cli" }));
    gateway.register(makeSession({ id: "web_1", adapterName: "web", capabilities: WEB_CAPABILITIES }));

    const cliSessions = gateway.listByAdapter("cli");
    const webSessions = gateway.listByAdapter("web");

    expect(cliSessions).toHaveLength(2);
    expect(webSessions).toHaveLength(1);
    expect(webSessions[0]?.id).toBe("web_1");
  });

  test("listByAdapter returns empty array when no sessions match the adapter", () => {
    const gateway = new SessionGateway();
    gateway.register(makeSession({ id: "cli_1", adapterName: "cli" }));

    expect(gateway.listByAdapter("web")).toEqual([]);
  });

  test("touch updates lastActivityAt for an existing session", () => {
    const gateway = new SessionGateway();
    const session = makeSession({ lastActivityAt: "2026-05-05T10:00:00.000Z" });
    gateway.register(session);

    gateway.touch("session_1");
    const updated = gateway.get("session_1");

    expect(updated?.lastActivityAt).not.toBe("2026-05-05T10:00:00.000Z");
  });

  test("touch is a no-op for an unknown session id", () => {
    const gateway = new SessionGateway();

    // Should not throw
    expect(() => gateway.touch("unknown_session")).not.toThrow();
    expect(gateway.list()).toHaveLength(0);
  });
});
