/** Independent child lifecycles: a waiting vendor lease must never block IR readers. */
import { spawn } from 'node:child_process';
let stopped=false;
const children=new Set<ReturnType<typeof spawn>>();
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>{stopped=true;for(const child of children) child.kill(signal);});
async function supervise(file:string, flags:string[]=[]) {
  while(!stopped) {
    const child=spawn('bun',[file,...flags],{stdio:'inherit',env:process.env}); children.add(child);
    await new Promise<void>(resolve=>{child.once('error',()=>resolve());child.once('exit',()=>resolve());}); children.delete(child);
    if(!stopped) await new Promise(resolve=>setTimeout(resolve,30000));
  }
}
await Promise.all([
  supervise('scripts/ir-deep-loop.ts',['--python=/opt/dvenv/bin/python']),
  ...(process.env.FIRECRAWL_API_KEY ? [supervise('scripts/vendor-backfill.ts')] : (console.error('Vendor collector disabled: FIRECRAWL_API_KEY is missing'),[])),
]);