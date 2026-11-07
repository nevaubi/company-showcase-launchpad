"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FilePen, FileSearch, Files, FlaskConical, Globe, ListChecks, NotebookPen, Scale, Search, SquareTerminal } from "lucide-react";
import { ClaudeMark, GeminiMark } from "./agent-status-marks";
import type { AgentActivity, AgentIcon, AgentInfo, AgentRunStatus, AgentStep, AgentStepStatus } from "./agent-status-types";

/** One scripted step. `ms` is the working time; pauses, failures and approvals stretch the wall clock, not the step. */
interface ScriptStep {
  id: string;
  icon: AgentIcon;
  active: string;
  done: string;
  ms: number;
  /** Ticks "1 of n" to "n of n" across the step. */
  count?: number;
  /** Holds the step for approval before it runs. */
  approval?: { request: string; waiting: string; denied: string };
  /** Fails once at this fraction of the step; Retry continues from there. */
  failOnce?: { at: number; summary: string; step: string };
}

export interface AgentScenario {
  id: string;
  name: string;
  agent: AgentInfo;
  steps: ScriptStep[];
  detail: string;
  deniedDetail?: string;
}

/** Sample runs. File paths, counts and timings are illustrative. */
export const agentScenarios = {
  coding: {
    id: "coding",
    name: "Coding agent",
    agent: { name: "Claude Sonnet 5.5", mark: <ClaudeMark style={{ color: "#D97757" }} /> },
    steps: [
      { id: "read", icon: FileSearch, active: "Reading 12 files", done: "Read 12 files", ms: 1900 },
      { id: "search", icon: Search, active: "Searching for prorateInvoice", done: "Found 4 call sites", ms: 1500 },
      { id: "edit", icon: FilePen, active: "Editing src/billing/invoice.ts", done: "Edited src/billing/invoice.ts", ms: 2500 },
      { id: "tests-edit", icon: Files, active: "Updating 5 test files", done: "Updated 5 test files", ms: 1900 },
      { id: "tests", icon: FlaskConical, active: "Running tests", done: "Passed 12 of 12 tests", ms: 3300, count: 12 },
      { id: "push", icon: SquareTerminal, active: "Pushing fix/proration-rounding", done: "Pushed fix/proration-rounding", ms: 1400, approval: { request: "Needs your approval to run git push", waiting: "Waiting for approval to run git push", denied: "Skipped git push" } },
    ],
    detail: "6 files changed",
    deniedDetail: "6 files changed, not pushed",
  },
  research: {
    id: "research",
    name: "Research agent",
    agent: { name: "Gemini 4 Argon", mark: <GeminiMark /> },
    steps: [
      { id: "plan", icon: ListChecks, active: "Planning 4 research questions", done: "Planned 4 questions", ms: 1400 },
      { id: "search", icon: Globe, active: "Searching the web", done: "Found 18 results", ms: 1900 },
      { id: "read", icon: BookOpen, active: "Reading sources", done: "Read 9 sources", ms: 3200, count: 9, failOnce: { at: .56, summary: "Fetch failed · 2 sources timed out", step: "2 sources timed out" } },
      { id: "compare", icon: Scale, active: "Comparing pricing across 5 vendors", done: "Compared 5 vendors", ms: 2200 },
      { id: "write", icon: NotebookPen, active: "Writing the brief", done: "Wrote a 640 word brief", ms: 2300 },
    ],
    detail: "9 sources cited",
  },
} satisfies Record<string, AgentScenario>;

export type AgentScenarioId = keyof typeof agentScenarios;

interface StepResult { status: AgentStepStatus; label: string; startedAt?: number; durationMs?: number }
interface SimState {
  scenario: AgentScenario;
  status: AgentRunStatus;
  index: number;
  progress: number;
  results: StepResult[];
  startedAt?: number;
  endedAt?: number;
  detail?: string;
  /** A one-off message for the live region, cleared by the next change. */
  notice?: string;
}

const fresh = (scenario: AgentScenario): SimState => ({ scenario, status: "idle", index: 0, progress: 0, results: scenario.steps.map(step => ({ status: "pending", label: step.active })) });

/** A small run engine outside React: it owns the timers and hands out immutable snapshots. */
function createEngine(emit: (state: SimState) => void) {
  let state = fresh(agentScenarios.coding);
  let worked = 0, segmentStart = 0, ticker = 0, starter = 0;
  const failed = new Set<string>(), approved = new Set<string>();
  let denied = false;

  const set = (next: Partial<SimState>) => {
    state = { ...state, notice: undefined, ...next };
    window.clearInterval(ticker);
    if (state.status === "working") ticker = window.setInterval(tick, 60);
    emit(state);
  };
  const withResult = (index: number, result: StepResult) => state.results.map((item, i) => i === index ? result : item);

  function begin(index: number, now: number) {
    const step = state.scenario.steps[index];
    if (!step) {
      set({ status: "done", index, endedAt: now, detail: denied ? state.scenario.deniedDetail ?? state.scenario.detail : state.scenario.detail });
      return;
    }
    if (step.approval && !approved.has(step.id)) {
      set({ status: "needs-input", index, progress: 0, results: withResult(index, { status: "waiting", label: step.approval.waiting, startedAt: now }) });
      return;
    }
    worked = 0;
    segmentStart = now;
    set({ status: "working", index, progress: step.count ? 1 : 0, results: withResult(index, { status: "active", label: step.active, startedAt: now }) });
  }

  function tick() {
    if (state.status !== "working") return;
    const step = state.scenario.steps[state.index];
    if (!step) return;
    const now = Date.now();
    const total = worked + now - segmentStart;
    if (step.failOnce && !failed.has(step.id) && total >= step.failOnce.at * step.ms) {
      failed.add(step.id);
      worked = total;
      const current = state.results[state.index];
      set({ status: "failed", results: withResult(state.index, { status: "failed", label: step.failOnce.step, startedAt: current?.startedAt }) });
      return;
    }
    if (total >= step.ms) {
      state = { ...state, results: withResult(state.index, { status: "done", label: step.done, durationMs: Math.round(total) }) };
      begin(state.index + 1, now);
      return;
    }
    if (step.count) {
      const value = Math.min(step.count, Math.floor(total / step.ms * step.count) + 1);
      if (value !== state.progress) set({ progress: value });
    }
  }

  return {
    load(scenario: AgentScenario, delay: number) {
      window.clearTimeout(starter);
      failed.clear();
      approved.clear();
      denied = false;
      state = fresh(scenario);
      set({});
      starter = window.setTimeout(() => { set({ startedAt: Date.now() }); begin(0, Date.now()); }, delay);
    },
    pause() {
      if (state.status !== "working") return;
      worked += Date.now() - segmentStart;
      set({ status: "paused", notice: "Paused. The simulated run waits where it stopped." });
    },
    resume() {
      if (state.status !== "paused") return;
      segmentStart = Date.now();
      set({ status: "working", notice: "Resumed." });
    },
    stop() {
      if (!["working", "paused", "needs-input"].includes(state.status)) return;
      const current = state.results[state.index];
      set({ status: "stopped", endedAt: Date.now(), results: withResult(state.index, { status: "skipped", label: "Stopped by you", startedAt: current?.startedAt }), notice: "Run stopped. Nothing else runs in this simulation." });
    },
    approve() {
      const step = state.scenario.steps[state.index];
      if (state.status !== "needs-input" || !step) return;
      approved.add(step.id);
      begin(state.index, Date.now());
      state = { ...state, notice: "Approved. The push is simulated in this preview." };
      emit(state);
    },
    deny() {
      const step = state.scenario.steps[state.index];
      if (state.status !== "needs-input" || !step?.approval) return;
      denied = true;
      state = { ...state, results: withResult(state.index, { status: "skipped", label: step.approval.denied, durationMs: 0 }) };
      begin(state.index + 1, Date.now());
      state = { ...state, notice: "Denied. Nothing was pushed." };
      emit(state);
    },
    retry() {
      const step = state.scenario.steps[state.index];
      if (state.status !== "failed" || !step) return;
      segmentStart = Date.now();
      const current = state.results[state.index];
      set({ status: "working", results: withResult(state.index, { status: "active", label: step.active, startedAt: current?.startedAt }), notice: "Retrying the sources that timed out." });
    },
    note(notice: string) { state = { ...state, notice }; emit(state); },
    dispose() { window.clearInterval(ticker); window.clearTimeout(starter); },
  };
}

type Engine = ReturnType<typeof createEngine>;

export interface AgentRunSimulation {
  status: AgentRunStatus;
  activity?: AgentActivity;
  steps: AgentStep[];
  startedAt?: number;
  endedAt?: number;
  agent: AgentInfo;
  notice?: string;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onRetry: () => void;
  onOpenRun: () => void;
  /** Starts the scenario again from Ready. */
  replay: () => void;
}

/** Plays a scripted run so the component can be seen without a backend. Every action is local and says so through `notice`. */
export function useAgentRunSimulation(scenarioId: AgentScenarioId = "coding", startDelay = 900): AgentRunSimulation {
  const [state, setState] = useState<SimState>(() => fresh(agentScenarios[scenarioId]));
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    const created = createEngine(setState);
    engine.current = created;
    return () => { created.dispose(); engine.current = null; };
  }, []);

  useEffect(() => { engine.current?.load(agentScenarios[scenarioId], startDelay); }, [scenarioId, startDelay]);

  const replay = useCallback(() => { engine.current?.load(agentScenarios[scenarioId], 500); }, [scenarioId]);
  const onPause = useCallback(() => engine.current?.pause(), []);
  const onResume = useCallback(() => engine.current?.resume(), []);
  const onStop = useCallback(() => engine.current?.stop(), []);
  const onApprove = useCallback(() => engine.current?.approve(), []);
  const onDeny = useCallback(() => engine.current?.deny(), []);
  const onRetry = useCallback(() => engine.current?.retry(), []);
  const onOpenRun = useCallback(() => engine.current?.note("Opening the run log is simulated in this preview."), []);

  const { scenario, status, index, progress, results } = state;
  const step = scenario.steps[index];
  let activity: AgentActivity | undefined;
  if (step && (status === "working" || status === "paused")) activity = { label: step.active, icon: step.icon, progress: step.count ? { value: progress, total: step.count } : undefined };
  else if (step && status === "needs-input" && step.approval) activity = { label: step.approval.request, icon: step.icon };
  else if (step && status === "failed" && step.failOnce) activity = { label: step.failOnce.summary, icon: step.icon };
  else if (status === "done") activity = { label: state.detail ?? scenario.detail };

  const steps: AgentStep[] = scenario.steps.map((item, i) => ({ id: item.id, icon: item.icon, ...results[i] ?? { status: "pending", label: item.active } }));

  return { status, activity, steps, startedAt: state.startedAt, endedAt: state.endedAt, agent: scenario.agent, notice: state.notice, onPause, onResume, onStop, onApprove, onDeny, onRetry, onOpenRun, replay };
}
