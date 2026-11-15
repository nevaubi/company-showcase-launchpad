import { sb, dbGate } from "./lib/supa";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const a = await sb.from("job_state").select("job").limit(1);
console.log("sb:", a.error?.message ?? `ok ${a.data?.length}`);
const b = await supabaseAdmin.from("job_state").select("job").limit(1);
console.log("admin:", b.error?.message ?? `ok ${b.data?.length}`);
const t0 = Date.now(); await dbGate("t"); console.log("gate ms", Date.now() - t0);
process.exit(0);
