import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectPeers } from "@/lib/reports/peers";
import { coverageOf } from "@/lib/coverage";
const { data } = await supabaseAdmin.storage.from("datasets").download("universe.json");
const u = JSON.parse(await data!.text());
console.log(Object.keys(u), u.companies?.length, JSON.stringify(u.companies?.[0]).slice(0, 200));
console.log(coverageOf("AMZN")?.peers, selectPeers("AMZN", u.companies, coverageOf("AMZN")?.peers ?? []));
process.exit(0);
