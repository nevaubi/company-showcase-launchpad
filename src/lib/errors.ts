/**
 * Short, user-facing wording for a failed data load. Raw server and network messages (missing environment variables,
 * "Failed to fetch", HTTP bodies) are for logs, not for the page.
 */
export function friendlyError(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  if (!m) return "Something went wrong while loading this.";
  if (/environment variable|service_role|not configured|missing supabase|api key|fireworks/.test(m))
    return "This service isn't configured on this deployment yet.";
  if (
    /failed to fetch|networkerror|network error|load failed|timed? ?out|econn|fetch failed/.test(m)
  )
    return "Couldn't reach the data service. Check the connection and try again.";
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|jwt|session/.test(m))
    return "Your session has expired. Sign in again to load this.";
  if (/\b404\b|\b400\b|not found|no such|does not exist/.test(m))
    return "This data hasn't been published yet.";
  if (/\b429\b|rate limit|too many/.test(m))
    return "Too many requests right now. Try again in a minute.";
  if (/\b5\d\d\b|internal server/.test(m))
    return "The data service returned an error. Try again shortly.";
  return "Something went wrong while loading this.";
}
