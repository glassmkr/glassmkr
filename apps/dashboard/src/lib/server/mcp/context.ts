import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestEvent } from "@sveltejs/kit";
import type { OAuthPrincipal } from "$lib/server/auth/principal.js";

export interface McpRequestContext {
  event: RequestEvent;
  principal: OAuthPrincipal;
  sessionHash: string | null;
}

const storage = new AsyncLocalStorage<McpRequestContext>();

export function runWithMcpRequestContext<T>(
  context: McpRequestContext,
  callback: () => Promise<T>,
): Promise<T> {
  return storage.run(context, callback);
}

export function getMcpRequestContext(): McpRequestContext {
  const context = storage.getStore();
  if (!context) throw new Error("MCP request context is unavailable");
  return context;
}
