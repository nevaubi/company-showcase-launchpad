// One bounded pass on authenticated native Cloud storage. Workers may safely resume after interruption.
import { listingClosure } from '../src/lib/company/listing-history';
import type { PriceSeries } from '../src/lib/financials/types';
import type { BenchFile } from '../src/lib/signals/context';
import { args, dbGate, sb, selectAll } from './lib/supa';
import { receiptText, writeRunReceipt } from './lib/run-receipt';
import { InsufficientReplayHistory, replayCalendar, replayHistory, replayPassReceipt, sha256, type ReplayHold, type ReplayInputs } from './lib/setup-replay';

import { createSetupSourceStore } from './lib/setup-source-pack';
import { latestOfficialUpdate, nativeReplayBytes, replayEngineCommit, replayJson, retainReplaySources, setupSourceManifest } from './lib/setup-source-manifest';
import { runSetupPackRecovery } from './lib/setup-pack-recovery';

const limit = Number(args['max-tickers'] ?? 4);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) throw new Error('--max-tickers must be an integer between 1 and 12');
const deadline = Date.now() + 100_000;
const stop = setTimeout(() => { console.error('Replay pass reached its time limit; unfinished claims expire automatically'); process.exit(124); }, 120_000);
const signal = () => AbortSignal.timeout(Math.max(1000, Math.min(30_000, deadline - Date.now())));
const completed: string[] = [], errors: string[] = [], held: ReplayHold[] = [];
const bucket = sb.storage.from('datasets');
const sourceStore = createSetupSourceStore(bucket);
let recovery: Awaited<ReturnType<typeof runSetupPackRecovery>> | undefined;
let samples = 0, idle = false, interrupted = false;
class LostReplayClaim extends Error {}
process.on('SIGTERM', () => { interrupted = true; });
const pricePath = (ticker: string) => `prices/${ticker.replace(/\^/g, 'IDX_').replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
const dataset = async <T>(path: string) => replayJson<T>(await nativeReplayBytes(bucket, path, signal()));
const readInputs = async (ticker: string, first: string, officialFrom: string, asOf: string, requestSignal = signal()) => {
  const { data } = await sb.rpc('setup_replay_inputs_v2', { p_ticker: ticker, p_first: first, p_official_from: officialFrom,
    p_as_of: asOf }).abortSignal(requestSignal).throwOnError();
  return data as ReplayInputs;
};
async function verifyClaim(ticker: string, token: string) {
  if (Date.now() >= deadline) throw new LostReplayClaim(`Pass expired for ${ticker}`);
  const { data } = await sb.from('setup_replay_work').select('ticker').eq('ticker', ticker).eq('token', token)
    .gt('lease_until', new Date().toISOString()).abortSignal(signal()).maybeSingle().throwOnError();
  if (!data) throw new LostReplayClaim(`Expired claim for ${ticker}`);
}
async function recordHold(hold: ReplayHold, token: string, detail: Record<string, unknown>, reason: string) {
  const { data: saved } = await sb.from('setup_replay_work').update({ receipt: { ...detail, ...hold }, error: reason,
    token: null, lease_until: null, retry_at: new Date(Date.now() + 86_400_000).toISOString() })
    .eq('ticker', hold.ticker).eq('token', token).select('ticker').abortSignal(signal()).throwOnError();
  if (saved.length) held.push(hold);
}
try {
  await dbGate('setup-replay');
  const commit = replayEngineCommit();
  if (!commit) throw new Error('Cannot identify the deployed replay engine commit');
  const { data: latest } = await sb.from('setup_results').select('as_of').order('as_of', { ascending: false }).limit(1).abortSignal(signal()).single().throwOnError();
  const asOf = String(latest.as_of);
  type HoldReceipt = { sourceHash: string; observedSessions: number };
  const previousHolds = await selectAll<{ticker: string; receipt: HoldReceipt}>((a,b) => sb.from('setup_replay_work')
    .select('ticker,receipt').is('completed_at', null).eq('as_of', asOf).eq('receipt->>kind', 'insufficient-history').order('ticker').range(a,b).abortSignal(signal()));
  const cold = new Map(previousHolds.map(w => [w.ticker, w.receipt]));
  let benchmark: { calendar: ReturnType<typeof replayCalendar>; hash: string; bytes: Buffer; readAt: string; generatedAt: string } | undefined;
  const retentionOnly = args['recover-packs-only'] === 'true';
  for (let i = 0; i < limit && !retentionOnly && !interrupted && Date.now() < deadline; i++) {
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
        const { file, hash, bytes, readAt } = await dataset<BenchFile>('setups/bench.json');
        benchmark = { calendar: replayCalendar(file, asOf), hash, bytes, readAt, generatedAt: file.generatedAt };
      }
      const calendar = benchmark.calendar;
      const path = pricePath(ticker);
      const [price, data] = await Promise.all([dataset<PriceSeries>(path), readInputs(ticker, calendar.first, calendar.officialFrom, asOf)]);
      const inputsReadAt = new Date().toISOString();
      sourceHash = sha256(JSON.stringify([price.hash, benchmark.hash, (data as ReplayInputs).official]));
      const past = cold.get(ticker);
      if (past && past.sourceHash === sourceHash) throw new InsufficientReplayHistory(past.observedSessions);
      const { rows, receipt } = replayHistory(calendar, ticker, sector ?? '', price.file, data as ReplayInputs);
      const retained = await retainReplaySources(sourceStore, () => verifyClaim(ticker, token), price, benchmark,
        { bytes: Buffer.from(JSON.stringify(data)), hash: receipt.eventsAndOfficialBarsSha256, readAt: inputsReadAt });
      const sourcePack = setupSourceManifest({ ...retained, ticker, asOf, scoredAt: new Date().toISOString(), capturedBy: commit,
        originalCommit: commit, receipt, window: calendar, pricesPath: path, pricesFetchedAt: price.file.fetchedAt,
        benchGeneratedAt: benchmark.generatedAt, marketBarsUpdatedThrough: latestOfficialUpdate(data.official) });
      const { data: saved } = await sb.rpc('finish_setup_replay_v2', { p_ticker: ticker, p_token: token, p_rows: rows,
        p_receipt: { ...receipt, sourcePack, pricesSha256: price.hash, benchSha256: benchmark.hash, pricesPath: path, benchPath: 'setups/bench.json' },
      }).abortSignal(signal()).throwOnError();
      if (saved) { completed.push(ticker); samples += rows.length; }
    } catch (e) {
      if (e instanceof LostReplayClaim) continue;
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
  if ((idle || retentionOnly) && !interrupted && Date.now() + 5000 < deadline) {
    recovery = await runSetupPackRecovery({ db: sb, store: sourceStore, readDataset: (path, s) => nativeReplayBytes(bucket, path, s), readInputs,
      signal: () => AbortSignal.timeout(Math.max(1, deadline - Date.now())), mayContinue: () => !interrupted && Date.now() + 5000 < deadline,
      buildManifest: x => {
        const prices = JSON.parse(x.prices.bytes.toString('utf8')) as PriceSeries;
        const bench = JSON.parse(x.benchmark.bytes.toString('utf8')) as BenchFile;
        const input = JSON.parse(x.inputs.bytes.toString('utf8')) as ReplayInputs;
        const part = (s: typeof x.prices) => ({ object: s.object, readAt: s.readAt, readFrom: s.readFrom });
        return setupSourceManifest({ ticker: x.ticker, asOf: x.asOf, scoredAt: x.scoredAt, originalCommit: null, capturedBy: commit,
          receipt: x.receipt, window: x.window, prices: part(x.prices), pricesPath: pricePath(x.ticker),
          pricesFetchedAt: prices.fetchedAt, benchmark: part(x.benchmark), benchGeneratedAt: bench.generatedAt,
          inputs: part(x.inputs), marketBarsUpdatedThrough: latestOfficialUpdate(input.official) });
      },
    }, Math.min(limit, 6));
    errors.push(...recovery.errors);
  }

} catch (e) {
  errors.push(receiptText(e instanceof Error ? e.message : (e as { message?: string })?.message ?? e));
} finally {
  clearTimeout(stop);
  const receipt = { ...replayPassReceipt(completed, samples, held, errors, idle, interrupted), ...(recovery ? { sourcePackRecovery: recovery } : {}) };
  console.log(JSON.stringify(receipt));
  writeRunReceipt(args.receipt, receipt);
  if (errors.length && !completed.length) process.exitCode = 1;
}
