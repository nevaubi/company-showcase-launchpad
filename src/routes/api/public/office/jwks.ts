// Public keys (no secrets) the office engine uses to verify FiledUnder tokens.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/office/jwks")({
  server: {
    handlers: {
      GET: async () => {
        const { engineJwks } = await import("@/lib/office/engine-token.server");
        return Response.json(await engineJwks(), { headers: { "Cache-Control": "public, max-age=300" } });
      },
    },
  },
});
