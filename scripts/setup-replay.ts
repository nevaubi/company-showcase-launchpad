// One bounded pass on authenticated native Cloud storage. Workers may safely resume after interruption.
import type { PriceSeries } from '../src/lib/financials/types';
import type { BenchFile } from '../src/lib/signals/context';
import { args, dbGate, sb } from './lib/supa';
import { receiptText, writeRunReceipt } from './lib/run-receipt';
import { replayCalendar, replayHistory, sha256, type ReplayInputs } from './lib/setup-replay';

const limit = Number(args['max-tickers'] ?? 4);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) throw new Error('--max-tickers must be an integer between 1 and 12');
const deadline = Date.now() + 100_000;
const stop = setTimeout(() => { console.error('Replay pass reached its time limit; unfinished claims expire automatically'); process.exit(124); }, 120_000);
const signal = () => AbortSignal.timeout(Math.max(1000, Math.min(30_000, deadline - Date.now())));
const completed: string[] = [], errors: string[] = [];
let samples = 0, idle = false, interrupted = false;
process.on('SIGTERM', () => { interrupted = true; });
async function dataset<T>(path: string) {
  const { data, error } = await sb.storage.from('datasets').download(path);
  if (error || !data) throw new Error(`${path}: ${error?.message ?? 'missing object'}`);
  const raw = await data.text();
  return { file: JSON.parse(raw) as T, hash: sha256(raw) };
}
try {
  await dbGate('setup-replay');
  const { data: latest } = await sb.from('setup_results').select('as_of').order('as_of', { ascending: false }).limit(1).abortSignal(signal()).single().throwOnError();
  const asOf = String(latest.as_of);
  let benchmark: { calendar: ReturnType<typeof replayCalendar>; hash: string } | undefined;
  for (let i = 0; i < limit && !interrupted && Date.now() < deadline; i++) {
    const { data: claimed } = await sb.rpc('claim_setup_replay_after_filing_v2', { p_as_of: asOf }).abortSignal(signal()).throwOnError();
    const claim = (claimed as { ticker: string; sector: string | null; token: string }[])?.[0];
    if (!claim) { idle = true; break; }
    const { ticker, sector, token } = claim;
    try {
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
      const { rows, receipt } = replayHistory(calendar, ticker, sector ?? '', price.file, data as ReplayInputs);
      const { data: saved } = await sb.rpc('finish_setup_replay_v2', { p_ticker: ticker, p_token: token, p_rows: rows,
        p_receipt: { ...receipt, pricesSha256: price.hash, benchSha256: benchmark.hash, pricesPath: path, benchPath: 'setups/bench.json' },
      }).abortSignal(signal()).throwOnError();
      if (saved) { completed.push(ticker); samples += rows.length; }
    } catch (e) {
      const reason = receiptText(e instanceof Error ? e.message : (e as { message?: string })?.message ?? e);
      errors.push(`${ticker}: ${reason}`);
      await sb.rpc('fail_setup_replay_v2', { p_ticker: ticker, p_token: token, p_error: reason }).abortSignal(signal()).throwOnError();
      if (!benchmark) break;
    }
  }
} catch (e) {
  errors.push(receiptText(e instanceof Error ? e.message : (e as { message?: string })?.message ?? e));
} finally {
  clearTimeout(stop);
  const receipt = { ok: !errors.length, items: completed.length, completed, samples, idle, interrupted, errors, ...(errors.length ? { error: errors[0] } : {}) };
  console.log(JSON.stringify(receipt));
  writeRunReceipt(args.receipt, receipt);
  if (errors.length && !completed.length) process.exitCode = 1;
}
