/** Independent child lifecycles: a waiting vendor lease must never block IR readers. */
import { spawn } from 'node:child_process';
import { sb } from './lib/supa';
let stopped=false;
const children=new Set<ReturnType<typeof spawn>>();
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>{stopped=true;for(const child of children) child.kill(signal);});
async function supervise(file:string, flags:string[]=[], executable="bun") {
  while(!stopped) {
    const child=spawn(executable,[file,...flags],{stdio:'inherit',env:process.env}); children.add(child);
    await new Promise<void>(resolve=>{child.once('error',()=>resolve());child.once('exit',()=>resolve());}); children.delete(child);
    if(!stopped) await new Promise(resolve=>setTimeout(resolve,30000));
  }
}
// Every start of the worker is one row (`worker-deploy` in job_runs): the commit it runs and the
// instance, so the Live worker page can say when the lanes were last restarted and how often.
// Never fatal: a start that cannot be recorded still starts.
const at=new Date().toISOString();
void sb.from('job_runs').insert({job:'worker-deploy',started_at:at,finished_at:at,ok:true,items:1,detail:{commit:process.env.RENDER_GIT_COMMIT??null,instance:process.env.RENDER_INSTANCE_ID??null,service:process.env.RENDER_SERVICE_NAME??null}} as never).then(r=>{ if(r.error) console.error('worker-deploy row not written:',r.error.message); },(e:unknown)=>console.error('worker-deploy row not written:',e instanceof Error?e.message:e));
await Promise.all([
  supervise('scripts/ir-deep-loop.ts',['--python=/opt/dvenv/bin/python']),
  supervise('scripts/official-source-worker.ts'),
  supervise('scripts/bank-sector-worker.py', [], 'python3'),
  supervise('scripts/transcript-worker.ts'),
  ...(process.env.FIRECRAWL_API_KEY ? [supervise('scripts/vendor-backfill.ts')] : (console.error('Vendor collector disabled: FIRECRAWL_API_KEY is missing'),[])),
]);
