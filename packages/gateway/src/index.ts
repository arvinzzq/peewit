/**
 * INPUT: Session registrations from adapters (id, adapterName, capabilities).
 * OUTPUT: SessionGateway registry, GatewaySession records, list/get/register/unregister.
 * POS: Gateway layer; tracks active sessions across adapters for multi-entry coordination.
 *
 * Update this header and the parent directory docs when responsibilities change.
 */
import type { AdapterCapabilities } from "@vole/adapters";

export const gatewayPackageName = "@vole/gateway";

export interface GatewaySession {
  id: string;
  adapterName: string;
  capabilities: AdapterCapabilities;
  registeredAt: string;
  lastActivityAt: string;
}

export class SessionGateway {
  readonly #sessions = new Map<string, GatewaySession>();

  register(session: GatewaySession): void {
    this.#sessions.set(session.id, session);
  }

  unregister(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  touch(sessionId: string): void {
    const s = this.#sessions.get(sessionId);
    if (s !== undefined) {
      this.#sessions.set(sessionId, { ...s, lastActivityAt: new Date().toISOString() });
    }
  }

  get(sessionId: string): GatewaySession | undefined {
    return this.#sessions.get(sessionId);
  }

  list(): GatewaySession[] {
    return Array.from(this.#sessions.values());
  }

  listByAdapter(adapterName: string): GatewaySession[] {
    return this.list().filter((s) => s.adapterName === adapterName);
  }
}
