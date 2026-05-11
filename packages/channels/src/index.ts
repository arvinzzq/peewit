/**
 * INPUT: Channel constructor options (credentials, agent binding), inbound platform-specific messages (Telegram updates, IMAP fetch results, …), outbound message payloads from the gateway.
 * OUTPUT: Channel interface, ChannelRegistry, InboundMessage / OutboundMessage / ChannelAddress / InboundHandler types, FakeChannel for tests. Backends (Telegram, email) land in Phase 15b.
 * POS: Channels layer; the inbound surface that routes external messages into GatewayCore. Each channel binds to one agentId; the gateway translates inbound messages into RunRequests and the channel emits the assistant's reply back to its platform.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
export const channelsPackageName = "@vole/channels";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface InboundMessage {
  /** Identifier of the originating channel. Matches Channel.id. */
  channelId: string;
  /** Platform-specific user identifier (Telegram user id, email From: address, …). */
  externalUserId: string;
  /** Platform-specific thread / chat id. When present, the gateway derives the session key as `channel:<channelId>:<threadKey>`. */
  threadKey?: string;
  /** Plain-text message body. Rich content (HTML, markdown, attachments) is delivered separately when supported. */
  body: string;
  /** ISO timestamp of arrival, set by the channel. */
  receivedAt: string;
  /** Reserved for Phase 16+ attachments (images, files, audio). */
  attachments?: Array<{ kind: string; ref: string }>;
}

export interface OutboundMessage {
  body: string;
  /** Optional original message id for threaded replies. */
  inReplyTo?: string;
}

export interface ChannelAddress {
  externalUserId: string;
  threadKey?: string;
}

export interface InboundHandler {
  onMessage(msg: InboundMessage): Promise<void>;
}

export interface Channel {
  readonly id: string;
  readonly agentId: string;
  readonly kind: string;  // "telegram" | "email" | "fake" | future
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(to: ChannelAddress, message: OutboundMessage): Promise<void>;
}

// ----------------------------------------------------------------------------
// ChannelRegistry
// ----------------------------------------------------------------------------

/**
 * In-process registry holding every Channel the adapter has started.
 * The CLI / Web adapter constructs one ChannelRegistry per process, registers
 * channels with `add()`, calls `startAll(handler)` once at boot, and `stopAll()`
 * on shutdown. The same handler — typically wrapping GatewayCore.submit — is
 * shared across every channel so all inbound traffic flows through the same
 * lane chain.
 */
export class ChannelRegistry {
  readonly #channels = new Map<string, Channel>();
  readonly #started = new Set<string>();

  add(channel: Channel): void {
    if (this.#channels.has(channel.id)) {
      throw new ChannelRegistryError(
        "duplicate_channel_id",
        `Channel id "${channel.id}" is already registered.`
      );
    }
    this.#channels.set(channel.id, channel);
  }

  get(channelId: string): Channel | undefined {
    return this.#channels.get(channelId);
  }

  list(filter?: { agentId?: string; kind?: string }): Channel[] {
    const all = Array.from(this.#channels.values());
    if (filter === undefined) return all;
    return all.filter((c) =>
      (filter.agentId === undefined || c.agentId === filter.agentId) &&
      (filter.kind === undefined || c.kind === filter.kind)
    );
  }

  async startAll(handler: InboundHandler): Promise<void> {
    for (const channel of this.#channels.values()) {
      if (this.#started.has(channel.id)) continue;
      await channel.start(handler);
      this.#started.add(channel.id);
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.#channels.values()) {
      if (!this.#started.has(channel.id)) continue;
      try {
        await channel.stop();
      } finally {
        this.#started.delete(channel.id);
      }
    }
  }

  /** Remove a single channel; stops it if running. */
  async remove(channelId: string): Promise<boolean> {
    const channel = this.#channels.get(channelId);
    if (channel === undefined) return false;
    if (this.#started.has(channelId)) {
      try {
        await channel.stop();
      } finally {
        this.#started.delete(channelId);
      }
    }
    this.#channels.delete(channelId);
    return true;
  }
}

export class ChannelRegistryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ChannelRegistryError";
    this.code = code;
  }
}

// ----------------------------------------------------------------------------
// FakeChannel — reference implementation for tests
// ----------------------------------------------------------------------------

export interface FakeChannelOptions {
  id: string;
  agentId: string;
}

/**
 * FakeChannel is a deterministic in-memory channel for tests. Inbound messages
 * are delivered via `injectInbound()`; outbound calls are recorded in `sent`
 * for assertion. Phase 15b's Telegram and email backends will implement the
 * same `Channel` interface so they slot into the same ChannelRegistry path.
 */
export class FakeChannel implements Channel {
  readonly id: string;
  readonly agentId: string;
  readonly kind = "fake";
  #handler: InboundHandler | undefined;
  #running = false;
  readonly sent: Array<{ to: ChannelAddress; message: OutboundMessage }> = [];

  constructor(options: FakeChannelOptions) {
    this.id = options.id;
    this.agentId = options.agentId;
  }

  async start(handler: InboundHandler): Promise<void> {
    this.#handler = handler;
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#handler = undefined;
  }

  async send(to: ChannelAddress, message: OutboundMessage): Promise<void> {
    if (!this.#running) {
      throw new Error(`FakeChannel "${this.id}" is not running.`);
    }
    this.sent.push({ to, message });
  }

  /** Test helper: simulate an inbound message arrival. */
  async injectInbound(input: { externalUserId: string; threadKey?: string; body: string; receivedAt?: string }): Promise<void> {
    if (this.#handler === undefined) {
      throw new Error(`FakeChannel "${this.id}" has no handler; call start() first.`);
    }
    const msg: InboundMessage = {
      channelId: this.id,
      externalUserId: input.externalUserId,
      ...(input.threadKey !== undefined ? { threadKey: input.threadKey } : {}),
      body: input.body,
      receivedAt: input.receivedAt ?? new Date().toISOString()
    };
    await this.#handler.onMessage(msg);
  }

  get running(): boolean {
    return this.#running;
  }
}

// ----------------------------------------------------------------------------
// SessionKey helper
// ----------------------------------------------------------------------------

/**
 * Compose the session key the gateway uses for a channel-originated run.
 * Format: `channel:<channelId>:<threadKey-or-externalUserId>`. The "channel:"
 * prefix makes channel sessions trivially distinguishable from CLI / Web ones
 * in `vole sessions list`.
 */
export function sessionKeyForInbound(msg: InboundMessage): string {
  const tail = msg.threadKey ?? msg.externalUserId;
  return `channel:${msg.channelId}:${tail}`;
}

// ----------------------------------------------------------------------------
// Phase 15b Step 7: channel ↔ gateway bridge
// ----------------------------------------------------------------------------

export interface ChannelInboundDispatch {
  sessionKey: string;
  agentId: string;
  body: string;
  channelMetadata: {
    channelId: string;
    externalUserId: string;
    threadKey?: string;
    receivedAt: string;
  };
}

export type ChannelInboundSubmitter = (dispatch: ChannelInboundDispatch) => Promise<void>;

/**
 * Build the InboundHandler the channel passes to `start(handler)`. The handler
 * derives a gateway-compatible session key from the message, then forwards the
 * body + agentId + channel metadata to a generic submitter. Channels and the
 * gateway stay decoupled — adapters supply the submitter that bridges them.
 */
export function createGatewayInboundHandler(
  channel: Pick<Channel, "id" | "agentId">,
  submit: ChannelInboundSubmitter
): InboundHandler {
  return {
    async onMessage(msg: InboundMessage): Promise<void> {
      const sessionKey = sessionKeyForInbound(msg);
      const channelMetadata: ChannelInboundDispatch["channelMetadata"] = {
        channelId: msg.channelId,
        externalUserId: msg.externalUserId,
        receivedAt: msg.receivedAt,
        ...(msg.threadKey !== undefined ? { threadKey: msg.threadKey } : {})
      };
      await submit({
        sessionKey,
        agentId: channel.agentId,
        body: msg.body,
        channelMetadata
      });
    }
  };
}

/**
 * Convenience: start every registered channel with an inbound handler that
 * routes through `submit`. Returns the registry for chaining.
 */
export async function bridgeRegistryToSubmitter(
  registry: ChannelRegistry,
  submit: ChannelInboundSubmitter
): Promise<ChannelRegistry> {
  const handler: InboundHandler = {
    async onMessage(msg: InboundMessage): Promise<void> {
      const sessionKey = sessionKeyForInbound(msg);
      const channelMetadata: ChannelInboundDispatch["channelMetadata"] = {
        channelId: msg.channelId,
        externalUserId: msg.externalUserId,
        receivedAt: msg.receivedAt,
        ...(msg.threadKey !== undefined ? { threadKey: msg.threadKey } : {})
      };
      // Look up the channel to read its agentId.
      const channel = registry.get(msg.channelId);
      const agentId = channel === undefined ? "default" : channel.agentId;
      await submit({ sessionKey, agentId, body: msg.body, channelMetadata });
    }
  };
  await registry.startAll(handler);
  return registry;
}
