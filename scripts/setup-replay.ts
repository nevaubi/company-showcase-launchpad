// One bounded pass on authenticated native Cloud storage. Workers may safely resume after interruption.
import { listingClosure } from '../src/lib/company/listing-history';
import type { PriceSeries } from '../src/lib/financials/types';
import type { BenchFile } from '../src/lib/signals/context';
import { args, dbGate, sb, selectAll } from './lib/supa';
import { receiptText, writeRunReceipt } from './lib/run-receipt';
import { InsufficientReplayHistory, replayCalendar, replayHistory, replayPassReceipt, sha256, type ReplayHold, type ReplayInputs } from './lib/setup-replay';

const limit = Number(args['max-tickers'] ?? 4);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) throw new Error('--max-tickers must be an integer between 1 and 12');
const deadline = Date.now() + 100_000;
const stop = setTimeout(() => { console.error('Replay pass reached its time limit; unfinished claims expire automatically'); process.exit(124); }, 120_000);
const signal = () => AbortSignal.timeout(Math.max(1000, Math.min(30_000, deadline - Date.now())));
const completed: string[] = [], errors: string[] = [], held: ReplayHold[] = [];
let samples = 0, idle = false, interrupted = false;
process.on('SIGTERM', () => { interrupted = true; });
async function dataset<T>(path: string) {
  const { data, error } = await sb.storage.from('datasets').download(path);
  if (error || !data) throw new Error(`${path}: ${error?.message ?? 'missing object'}`);
  const raw = await data.text();
  return { file: JSON.parse(raw) as T, hash: sha256(raw) };
}
async function recordHold(hold: ReplayHold, token: string, detail: Record<string, unknown>, reason: string) {
  const { data: saved } = await sb.from('setup_replay_work').update({ receipt: { ...detail, ...hold }, error: reason,
    token: null, lease_until: null, retry_at: new Date(Date.now() + 86_400_000).toISOString() })
    .eq('ticker', hold.ticker).eq('token', token).select('ticker').abortSignal(signal()).throwOnError();
  if (saved.length) held.push(hold);
}
try {
  await dbGate('setup-replay');
  const { data: latest } = await sb.from('setup_results').select('as_of').order('as_of', { ascending: false }).limit(1).abortSignal(signal()).single().throwOnError();
  const asOf = String(latest.as_of);
  type HoldReceipt = { sourceHash: string; observedSessions: number };
  const previousHolds = await selectAll<{ticker: string; receipt: HoldReceipt}>((a,b) => sb.from('setup_replay_work')
    .select('ticker,receipt').is('completed_at', null).eq('as_of', asOf).eq('receipt->>kind', 'insufficient-history').order('ticker').range(a,b).abortSignal(signal()));
  const cold = new Map(previousHolds.map(w => [w.ticker, w.receipt]));
  let benchmark: { calendar: ReturnType<typeof replayCalendar>; hash: string } | undefined;
  for (let i = 0; i < limit && !interrupted && Date.now() < deadline; i++) {
    const { data: claimed } = await sb.rpc('claim_setup_replay_adjusted_v2', { p_as_of: asOf }).abortSignal(signal()).throwOnError();
    const claim = (claimed as { ticker: string; sector: string | null; token: string }[])?.[0];
    if (!claim) { idle = true; break; }
    const { ticker, sector, token } = claim;
    let sourceHash: string | undefined;
    try {
      const retired = listingClosure(ticker, asOf);
      if (retired) {
        await recordHold({ kind: 'retired-listing', ticker, effective: retired.effective }, token,
          { asOf, cik: retired.cik, source: retired.source }, `Listing closed ${retired.effective}: ${retired.description}`);
        continue;
      }
      if (!benchmark) {
        const { file, hash } = await dataset<BenchFile>('setups/bench.json');
        benchmark = { calendar: replayCalendar(file, asOf), hash };
      }
      const calendar = benchmark.calendar;
      const path = `prices/${ticker.replace(/\^/g, 'IDX_').replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
      const [price, { data }] = await Promise.all([
        dataset<PriceSeries>(path), sb.rpc('setup_replay_inputs_v2', { p_ticker: ticker, p_first: calendar.first,
          p_official_from: calendar.officialFrom, p_as_of: asOf }).abortSignal(signal()).throwOnError(),
      ]);
      sourceHash = sha256(JSON.stringify([price.hash, benchmark.hash, (data as ReplayInputs).official]));
      const past = cold.get(ticker);
      if (past && past.sourceHash === sourceHash) throw new InsufficientReplayHistory(past.observedSessions);
      const { rows, receipt } = replayHistory(calendar, ticker, sector ?? '', price.file, data as ReplayInputs);
      const { data: saved } = await sb.rpc('finish_setup_replay_v2', { p_ticker: ticker, p_token: token, p_rows: rows,
        p_receipt: { ...receipt, pricesSha256: price.hash, benchSha256: benchmark.hash, pricesPath: path, benchPath: 'setups/bench.json' },
      }).abortSignal(signal()).throwOnError();
      if (saved) { completed.push(ticker); samples += rows.length; }
    } catch (e) {
      const reason = receiptText(e instanceof Error ? e.message : (e as { message?: string })?.message ?? e);
      if (e instanceof InsufficientReplayHistory && sourceHash) {
        // The same price and official-bar vintage cannot create additional observed sessions. Keep
        // the hold separate from real errors and revisit the inputs on the next daily refresh.
        await recordHold({ kind: 'insufficient-history', ticker, observedSessions: e.observedSessions }, token, { sourceHash, asOf }, reason);
        continue;
      }
      errors.push(`${ticker}: ${reason}`);
      await sb.rpc('fail_setup_replay_v2', { p_ticker: ticker, p_token: token, p_error: reason }).abortSignal(signal()).throwOnError();
      if (!benchmark) break;
    }
  }
} catch (e) {
  errors.push(receiptText(e instanceof Error ? e.message : (e as { message?: string })?.message ?? e));
} finally {
  clearTimeout(stop);
  const receipt = replayPassReceipt(completed, samples, held, errors, idle, interrupted);
  console.log(JSON.stringify(receipt));
  writeRunReceipt(args.receipt, receipt);
  if (errors.length && !completed.length) process.exitCode = 1;
}
