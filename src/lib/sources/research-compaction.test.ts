import { describe,expect,it,vi } from "vitest";
vi.mock("@/lib/research.functions",()=>({agentStep:vi.fn()}));
vi.mock("@/lib/research/execute",()=>({runTool:vi.fn()}));
import { compact } from "@/lib/research/loop";

describe("official source history compaction",()=>{
  it("removes complete value rows and requires a pinned reread, while ordinary tool compaction stays unchanged",()=>{
    const snapshot="a".repeat(64),native="9007199254740993."+"123456789".repeat(150);
    const official=JSON.stringify({kind:"official_source",tool:"query_official_records",dataset_id:"financials/fdic",snapshot_id:snapshot,fields:[{key:"col0002",unit:"USD thousands"}],rows:[{record_id:`${snapshot}:17`,row_number:17,values:[native]}],after:16,next_cursor:17});
    const items:Record<string,unknown>[]=[{type:"function_call_output",output:official},{type:"function_call_output",output:"ordinary ".repeat(150)},...Array.from({length:6},()=>({role:"assistant",content:"recent"}))];
    compact(items,1);
    const shortened=JSON.parse(items[0].output as string);
    expect(shortened).toMatchObject({dataset_id:"financials/fdic",snapshot_id:snapshot,row_ids:[`${snapshot}:17`],field_keys:["col0002"],after:16,next_cursor:17,requires_reread:true});
    expect(shortened.rows).toBeUndefined();
    expect(items[0].output).not.toContain("9007199254740993");
    expect(items[1].output).toContain("[older output compacted]");
  });
});
