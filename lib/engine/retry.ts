/**
 * Helper to retry API calls on 429 (Rate Limit Exceeded) errors with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  initialDelayMs = 2500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isRateLimit =
        err?.status === 429 ||
        err?.error?.code === "rate_limit_exceeded" ||
        String(err).includes("Rate limit");

      if (isRateLimit && attempt <= retries) {
        // Extract retry-after if present, else use exponential backoff
        const retryAfterSec = parseInt(err?.headers?.["retry-after"] ?? "0", 10);
        const wait = retryAfterSec > 0
          ? (retryAfterSec + 1) * 1000
          : initialDelayMs * Math.pow(1.8, attempt - 1);

        console.warn(
          `[retry] Rate limit 429 hit. Retrying in ${Math.round(wait)}ms... (attempt ${attempt}/${retries})`
        );
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}
