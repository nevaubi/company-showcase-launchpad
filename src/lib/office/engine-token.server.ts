// Office engine tokens (server-only): short-lived RS256 JWTs scoped to one user
// and one document. The FiledUnder office engine verifies them against
// /api/public/office/jwks (issuer, audience, tenant, scope).
import { exportJWK, importPKCS8, SignJWT, type JWK } from "jose";

const SCOPE = "office:write";
const TTL = 15 * 60;
type Signer = { key: CryptoKey | Uint8Array; kid: string; publicJwk: JWK };
let cache: Promise<Signer> | undefined;

export const engineConfig = () => ({
  issuer: process.env["OFFICE_ENGINE_JWT_ISSUER"] || "https://filedunder.ai",
  audience: process.env["OFFICE_ENGINE_JWT_AUDIENCE"] || "filedunder-office-engine",
  tenant: process.env["OFFICE_ENGINE_TENANT"] || "filedunder",
  url: process.env["OFFICE_ENGINE_URL"] || "https://filedunder-office-engine.onrender.com",
});

function signer(): Promise<Signer> {
  if (!cache) {
    cache = (async () => {
      const pem = process.env["OFFICE_ENGINE_JWT_PRIVATE_KEY"];
      if (!pem) throw new Error("Office engine signing key is not configured");
      const kid = process.env["OFFICE_ENGINE_JWT_KID"] || "filedunder-office-1";
      const key = await importPKCS8(pem.replace(/\\n/g, "\n"), "RS256", { extractable: true });
      const { d, p, q, dp, dq, qi, ...pub } = (await exportJWK(key)) as JWK & Record<string, unknown>;
      void d; void p; void q; void dp; void dq; void qi;
      return { key, kid, publicJwk: { ...pub, kid, use: "sig", alg: "RS256" } as JWK };
    })();
    cache.catch(() => { cache = undefined; });
  }
  return cache;
}

export async function engineJwks() {
  return { keys: [(await signer()).publicJwk] };
}

export async function mintEngineToken(userId: string, name: string, docId: string) {
  const s = await signer();
  const c = engineConfig();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ scope: SCOPE, tenant: c.tenant, name, doc: docId, token_use: "access" })
    .setProtectedHeader({ alg: "RS256", kid: s.kid })
    .setIssuer(c.issuer).setAudience(c.audience).setSubject(userId)
    .setIssuedAt(now).setExpirationTime(now + TTL).setJti(crypto.randomUUID())
    .sign(s.key);
  return { token, expiresAt: (now + TTL) * 1000, engineUrl: c.url };
}
