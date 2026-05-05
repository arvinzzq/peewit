# Gateway Package

## Architecture Summary

This directory owns the session gateway registry for ArvinClaw.
It tracks active sessions across adapters so that multi-entry coordination is possible.
It holds no agent logic — it is a registry that records which sessions exist and which adapter owns them.

Simplified Chinese version: [README.zh-CN.md](./README.zh-CN.md)

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | Declares the gateway package and its dependency on `@arvinclaw/adapters`. |
| `tsconfig.json` | TypeScript config | Builds the gateway package with a reference to `packages/adapters`. |
| `src/index.ts` | Session gateway | Exports `GatewaySession` record type, `SessionGateway` class with register/unregister/touch/get/list/listByAdapter, and the `gatewayPackageName` constant. |
| `src/index.test.ts` | Gateway tests | Protects register, unregister, touch, list, listByAdapter, and get behavior including edge cases (unknown session, empty list, no-op touch). |

## Update Reminder

Update this file when the directory structure changes.
