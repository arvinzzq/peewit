import { describe, expect, test } from "vitest";
import {
  ChannelRegistry,
  ChannelRegistryError,
  FakeChannel,
  sessionKeyForInbound,
  type InboundMessage
} from "./index.js";

describe("FakeChannel", () => {
  test("send before start throws", async () => {
    const ch = new FakeChannel({ id: "f1", agentId: "default" });
    await expect(ch.send({ externalUserId: "u1" }, { body: "hi" })).rejects.toThrow(/not running/);
  });

  test("inbound injection routes through the handler", async () => {
    const received: InboundMessage[] = [];
    const ch = new FakeChannel({ id: "f2", agentId: "default" });
    await ch.start({
      async onMessage(msg) {
        received.push(msg);
      }
    });
    await ch.injectInbound({ externalUserId: "u1", threadKey: "t1", body: "hello" });
    expect(received).toHaveLength(1);
    expect(received[0]?.body).toBe("hello");
    expect(received[0]?.channelId).toBe("f2");
    expect(received[0]?.threadKey).toBe("t1");
  });

  test("send after start records the outbound payload", async () => {
    const ch = new FakeChannel({ id: "f3", agentId: "work" });
    await ch.start({ async onMessage() {} });
    await ch.send({ externalUserId: "u9" }, { body: "reply" });
    expect(ch.sent).toEqual([
      { to: { externalUserId: "u9" }, message: { body: "reply" } }
    ]);
    await ch.stop();
  });

  test("stop drops the handler and toggles running", async () => {
    const ch = new FakeChannel({ id: "f4", agentId: "default" });
    await ch.start({ async onMessage() {} });
    expect(ch.running).toBe(true);
    await ch.stop();
    expect(ch.running).toBe(false);
    await expect(ch.injectInbound({ externalUserId: "x", body: "x" })).rejects.toThrow(/no handler/);
  });
});

describe("ChannelRegistry", () => {
  test("rejects duplicate channel ids", () => {
    const reg = new ChannelRegistry();
    reg.add(new FakeChannel({ id: "dup", agentId: "default" }));
    expect(() => reg.add(new FakeChannel({ id: "dup", agentId: "default" }))).toThrow(ChannelRegistryError);
  });

  test("startAll starts every registered channel and stopAll stops them", async () => {
    const reg = new ChannelRegistry();
    const a = new FakeChannel({ id: "a", agentId: "default" });
    const b = new FakeChannel({ id: "b", agentId: "default" });
    reg.add(a);
    reg.add(b);
    await reg.startAll({ async onMessage() {} });
    expect(a.running).toBe(true);
    expect(b.running).toBe(true);
    await reg.stopAll();
    expect(a.running).toBe(false);
    expect(b.running).toBe(false);
  });

  test("list filters by agentId and kind", () => {
    const reg = new ChannelRegistry();
    reg.add(new FakeChannel({ id: "w1", agentId: "work" }));
    reg.add(new FakeChannel({ id: "w2", agentId: "work" }));
    reg.add(new FakeChannel({ id: "p1", agentId: "personal" }));
    expect(reg.list({ agentId: "work" }).map((c) => c.id).sort()).toEqual(["w1", "w2"]);
    expect(reg.list({ kind: "fake" })).toHaveLength(3);
    expect(reg.list()).toHaveLength(3);
  });

  test("remove stops and unregisters the channel", async () => {
    const reg = new ChannelRegistry();
    const ch = new FakeChannel({ id: "r1", agentId: "default" });
    reg.add(ch);
    await reg.startAll({ async onMessage() {} });
    expect(ch.running).toBe(true);
    expect(await reg.remove("r1")).toBe(true);
    expect(ch.running).toBe(false);
    expect(reg.get("r1")).toBeUndefined();
    expect(await reg.remove("r1")).toBe(false);
  });

  test("shares the handler across channels — inbound from any channel flows to the same handler", async () => {
    const reg = new ChannelRegistry();
    const a = new FakeChannel({ id: "a", agentId: "default" });
    const b = new FakeChannel({ id: "b", agentId: "default" });
    reg.add(a);
    reg.add(b);
    const messages: InboundMessage[] = [];
    await reg.startAll({
      async onMessage(msg) {
        messages.push(msg);
      }
    });
    await a.injectInbound({ externalUserId: "u1", body: "from a" });
    await b.injectInbound({ externalUserId: "u2", body: "from b" });
    expect(messages.map((m) => m.body)).toEqual(["from a", "from b"]);
  });
});

describe("sessionKeyForInbound", () => {
  test("uses threadKey when present", () => {
    const msg: InboundMessage = {
      channelId: "tg-bot",
      externalUserId: "u1",
      threadKey: "chat-42",
      body: "hi",
      receivedAt: "2026-05-12T00:00:00.000Z"
    };
    expect(sessionKeyForInbound(msg)).toBe("channel:tg-bot:chat-42");
  });

  test("falls back to externalUserId when threadKey is absent", () => {
    const msg: InboundMessage = {
      channelId: "email",
      externalUserId: "alice@example.com",
      body: "hi",
      receivedAt: "2026-05-12T00:00:00.000Z"
    };
    expect(sessionKeyForInbound(msg)).toBe("channel:email:alice@example.com");
  });
});
