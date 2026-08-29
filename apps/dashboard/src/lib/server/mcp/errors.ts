export type McpErrorCode =
  | "INVALID_ARGUMENT"
  | "INSUFFICIENT_SCOPE"
  | "ACCOUNT_UNAVAILABLE"
  | "NOT_FOUND"
  | "NO_TELEMETRY"
  | "RATE_LIMITED"
  | "OUTPUT_TOO_LARGE"
  | "INTERNAL_ERROR";

export class McpOperationError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "McpOperationError";
  }
}
