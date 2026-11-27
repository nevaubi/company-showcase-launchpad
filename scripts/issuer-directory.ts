// Replays the reviewed directory into the configured Lovable Cloud database after migration 0076.
// A later review always wins. Running again does not create duplicate entries.
import seed from "./data/issuer-directory.json";
import { sb } from "./lib/supa";

for (let i = 0; i < seed.length; i += 100) {
  const { error } = await sb.rpc("seed_issuer_directory", { entries: seed.slice(i, i + 100) });
  if (error) throw new Error(error.message);
}
console.log(`Applied ${seed.length} reviewed issuer links.`);
