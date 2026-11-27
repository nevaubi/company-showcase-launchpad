import { describe, expect, it } from 'vitest';
import {
  ANSWER_RECHECK_MS, PASS_REST_MS, PHASE_A_FISCAL_CAPABILITIES, passRestLeft, answerKey, answerStands, answersFromLedger, checkpointIs, fileKey, parseCheckpoint, phaseASummary, phaseATodo, providerExpired, providerMiss,
  type Answer,
} from '../../scripts/vendor/core';

const NOW = Date.parse('2026-11-27T14:00:00Z');
const DAY = 86_400_000;
/** Every Phase A file of a company, as the archive listing would show them. */
function allFiles(t: string): string[] {
  return [
    fileKey('fiscal-ai', 'company/profile', t),
    ...PHASE_A_FISCAL_CAPABILITIES.map((c) => fileKey('fiscal-ai', c, t)),
    fileKey('fiscal-ai', 'events/transcript', t),
    ...['fundamentals/company', 'corporate-actions/dividends', 'corporate-actions/splits'].map((c) => fileKey('eodhd', c, t)),
    fileKey('datalegion', 'companies/enrich-premium', t),
    ...['calendar/ratings', 'calendar/consensus-ratings'].map((c) => fileKey('benzinga', c, t)),
  ];
}
const none = new Map<string, Answer>();

describe('what the vendor collector has already settled', () => {
  it('recognises the refusal that can never turn into data, and tells it from "not there"', () => {
    // the provider's own words, as stored in the ledger on 25 to 27 Nov 2026
    const expired = { error: 'This provider request already completed. Its response is no longer kept, so it cannot be returned again; a new x-request-id runs it again and is charged again.' };
    expect(providerExpired(409, expired)).toBe(true);
    expect(providerExpired(200, expired)).toBe(false);
    expect(providerExpired(409, { error: 'Conflict' })).toBe(false);
    const missing = { data: { alexandria: [{ error: { code: 'not_found', status: 404, message: 'Fiscal.ai does not have this data for this company yet.' } }] } };
    expect(providerMiss(missing)).toBe(true);
    expect(providerExpired(200, missing)).toBe(false);
  });

  it('an expired request is never asked again; "not there" is asked again after thirty days', () => {
    expect(answerStands({ kind: 'expired', at: NOW - 400 * DAY }, NOW)).toBe(true);
    expect(answerStands({ kind: 'not_found', at: NOW - 29 * DAY }, NOW)).toBe(true);
    expect(answerStands({ kind: 'not_found', at: NOW - ANSWER_RECHECK_MS }, NOW)).toBe(false);
    expect(answerStands({ kind: 'no_match', at: NOW - 31 * DAY }, NOW)).toBe(false);
    expect(answerStands(undefined, NOW)).toBe(false);
  });

  it('reads the answers back from their ledger rows; the newest row of a request wins', () => {
    const row = (minAgo: number, detail: Record<string, unknown>) => ({ started_at: new Date(NOW - minAgo * 60_000).toISOString(), detail });
    const a = answersFromLedger([
      row(50, { provider: 'fiscal-ai', capability: 'company/segments-and-kpis', name: 'UNFI', unavailable: 'expired' }),
      row(90, { provider: 'fiscal-ai', capability: 'company/segments-and-kpis', name: 'EROC', unavailable: 'not_found' }),
      row(10, { provider: 'fiscal-ai', capability: 'company/segments-and-kpis', name: 'EROC', unavailable: 'not_found' }),
      // rows that are not answers: an ordinary failure, a file, an unknown kind, a row without a name
      row(5, { provider: 'fiscal-ai', capability: 'company/profile', name: 'AAPL', error: 'HTTP 500' }),
      row(5, { provider: 'fiscal-ai', capability: 'company/profile', name: 'AAPL', file: 'vendor/x.json' }),
      row(5, { provider: 'fiscal-ai', capability: 'company/profile', name: 'AAPL', unavailable: 'maybe' }),
      row(5, { provider: 'datalegion', unavailable: 'no_match' }),
    ]);
    expect([...a.keys()].sort()).toEqual(['fiscal-ai/company/segments-and-kpis/EROC', 'fiscal-ai/company/segments-and-kpis/UNFI']);
    expect(a.get(answerKey('fiscal-ai', 'company/segments-and-kpis', 'EROC'))).toEqual({ kind: 'not_found', at: NOW - 10 * 60_000 });
  });
});

describe('phaseATodo', () => {
  it('a company with every file stored needs no call and no download', () => {
    expect(phaseATodo('AAPL', new Set(allFiles('AAPL')), none, NOW)).toEqual({ profile: false, fiscal: [], transcripts: false, eod: [], legion: false, benzinga: [], done: true });
  });
  it('a company never seen needs everything, in the collection order', () => {
    const todo = phaseATodo('AAPL', new Set(), none, NOW);
    expect(todo.done).toBe(false);
    expect(todo.profile).toBe(true);
    expect(todo.fiscal).toEqual([...PHASE_A_FISCAL_CAPABILITIES]);
    expect(todo.transcripts).toBe(true);
    expect(todo.eod).toHaveLength(3);
    expect(todo.legion).toBe(true);
    expect(todo.benzinga).toHaveLength(2);
  });
  it('one missing file is the only thing asked for', () => {
    const stored = new Set(allFiles('UNFI').filter((p) => p !== fileKey('fiscal-ai', 'company/segments-and-kpis', 'UNFI')));
    expect(phaseATodo('UNFI', stored, none, NOW)).toMatchObject({ profile: false, fiscal: ['company/segments-and-kpis'], transcripts: false, eod: [], legion: false, benzinga: [], done: false });
    // once the provider's refusal is on file, the company is settled: this is the 227-company loop
    const answers = new Map([[answerKey('fiscal-ai', 'company/segments-and-kpis', 'UNFI'), { kind: 'expired', at: NOW - 3 * DAY } as Answer]]);
    expect(phaseATodo('UNFI', stored, answers, NOW).done).toBe(true);
  });
  it('a company the provider does not know asks nothing of that provider, and the rest only once', () => {
    const answers = new Map([[answerKey('fiscal-ai', 'company/profile', 'ZZZ'), { kind: 'not_found', at: NOW - DAY } as Answer]]);
    const todo = phaseATodo('ZZZ', new Set(), answers, NOW);
    expect(todo).toMatchObject({ profile: false, fiscal: [], transcripts: false, done: false });
    expect(todo.eod).toHaveLength(3);
    // thirty days on the profile is asked for again, and with it the rest
    const later = phaseATodo('ZZZ', new Set(), answers, NOW + 31 * DAY);
    expect(later.profile).toBe(true);
    expect(later.fiscal).toHaveLength(PHASE_A_FISCAL_CAPABILITIES.length);
  });
  it('transcripts are asked for only when the IR events list exists or is still to come', () => {
    const base = allFiles('ACME').filter((p) => p !== fileKey('fiscal-ai', 'events/transcript', 'ACME'));
    expect(phaseATodo('ACME', new Set(base), none, NOW)).toMatchObject({ transcripts: true, done: false });
    // no events list and the provider said it has none: no transcripts to ask for
    const noEvents = base.filter((p) => p !== fileKey('fiscal-ai', 'events/ir-events', 'ACME'));
    const answers = new Map([[answerKey('fiscal-ai', 'events/ir-events', 'ACME'), { kind: 'not_found', at: NOW } as Answer]]);
    expect(phaseATodo('ACME', new Set(noEvents), answers, NOW)).toMatchObject({ transcripts: false, done: true });
  });
  it('a Data Legion match that could not be made is not tried again for thirty days', () => {
    const stored = new Set(allFiles('LOB').filter((p) => p !== fileKey('datalegion', 'companies/enrich-premium', 'LOB')));
    expect(phaseATodo('LOB', stored, none, NOW)).toMatchObject({ legion: true, done: false });
    const answers = new Map([[answerKey('datalegion', 'companies/enrich-premium', 'LOB'), { kind: 'no_match', at: NOW - 2 * DAY } as Answer]]);
    expect(phaseATodo('LOB', stored, answers, NOW).done).toBe(true);
  });
  it('sums the universe', () => {
    const stored = new Set([...allFiles('A'), ...allFiles('B').filter((p) => !p.includes('calendar__ratings'))]);
    expect(phaseASummary(['A', 'B'], stored, none, NOW)).toEqual({ companies: 2, done: 1, open: 1, missing: { 'benzinga/calendar/ratings': 1 } });
  });
});

describe('local checkpoints', () => {
  it('a checkpoint cut off mid-write reads as nothing instead of ending the run', () => {
    const whole = JSON.stringify({ provider: 'benzinga', capability: 'calendar/ratings', options: { page: 0 }, response: { data: { ratings: [{ id: '1' }] } } });
    expect(parseCheckpoint(whole)).toMatchObject({ provider: 'benzinga' });
    // the failure of 27 Nov 2026 08:17 UTC: "JSON Parse error: Unexpected EOF" at the clean-up's read
    expect(parseCheckpoint(whole.slice(0, whole.length - 20))).toBeNull();
    expect(parseCheckpoint('')).toBeNull();
    expect(parseCheckpoint('null')).toBeNull();
  });
  it('tells from its first bytes whether a checkpoint is a page of one capability', () => {
    const head = '{"provider":"benzinga","capability":"calendar/ratings","options":{"page":0,"pagesize":1000},"fetchedAt":"2026-11-20T';
    expect(checkpointIs(head, 'benzinga', 'calendar/ratings')).toBe(true);
    expect(checkpointIs(head, 'benzinga', 'calendar/consensus-ratings')).toBe(false);
    expect(checkpointIs('{"provider":"fiscal-ai","capability":"company/profile"', 'benzinga', 'calendar/ratings')).toBe(false);
  });
});

describe('rest after a whole pass', () => {
  it('rests a week after a whole pass, and not at all when none finished', () => {
    expect(passRestLeft(null, NOW)).toBe(0);
    expect(passRestLeft('not a date', NOW)).toBe(0);
    expect(passRestLeft(new Date(NOW - DAY).toISOString(), NOW)).toBe(PASS_REST_MS - DAY);
    expect(passRestLeft(new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(0);
    expect(passRestLeft(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe(0);
    // a clock that ran ahead never makes the collector wait for ever
    expect(passRestLeft(new Date(NOW + DAY).toISOString(), NOW)).toBe(0);
  });
});
