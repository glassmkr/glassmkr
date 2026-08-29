import { hashOAuthValueHex, timingSafeStringEqual } from "$lib/server/oauth/crypto.js";
import { McpOperationError } from "./errors.js";

export interface FleetCursor {
  createdAt: Date;
  serverId: string;
}

export function encodeFleetCursor(
  customerId: string,
  cursor: FleetCursor,
): string {
  const payload = Buffer
    .from(`${cursor.createdAt.getTime()}:${cursor.serverId}`, "utf8")
    .toString("base64url");
  const signature = hashOAuthValueHex("mcp-fleet-cursor", `${customerId}:${payload}`);
  return `v1.${payload}.${signature}`;
}

export function decodeFleetCursor(customerId: string, cursor: string): FleetCursor {
  if (cursor.length > 512) {
    throw new McpOperationError("INVALID_ARGUMENT", "The pagination cursor is invalid.");
  }
  const match = /^v1\.([A-Za-z0-9_-]{1,256})\.([a-f0-9]{64})$/.exec(cursor);
  if (!match) {
    throw new McpOperationError("INVALID_ARGUMENT", "The pagination cursor is invalid.");
  }
  const [, payload, suppliedSignature] = match;
  const expectedSignature = hashOAuthValueHex(
    "mcp-fleet-cursor",
    `${customerId}:${payload}`,
  );
  if (!timingSafeStringEqual(suppliedSignature, expectedSignature)) {
    throw new McpOperationError("INVALID_ARGUMENT", "The pagination cursor is invalid.");
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const decodedMatch = /^(\d{1,16}):([A-Za-z0-9._:-]{1,128})$/.exec(decoded);
  if (!decodedMatch) {
    throw new McpOperationError("INVALID_ARGUMENT", "The pagination cursor is invalid.");
  }
  const milliseconds = Number(decodedMatch[1]);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new McpOperationError("INVALID_ARGUMENT", "The pagination cursor is invalid.");
  }
  return { createdAt: new Date(milliseconds), serverId: decodedMatch[2] };
}
