const LOCAL_ORIGIN = "https://glassmkr-local.invalid";

export function safeLocalRedirect(
  target: string | null | undefined,
  fallback: string = "/",
): string {
  if (!target || !target.startsWith("/")) return fallback;
  try {
    const parsed = new URL(target, LOCAL_ORIGIN);
    if (parsed.origin !== LOCAL_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
