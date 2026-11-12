// Browser side of the assistant's voice: what to say, playing it, and recording a spoken question.
import { speak, transcribe } from "@/lib/voice.functions";

/** Markdown answer → plain sentences fit to be read aloud, capped so a long answer does not drone on. */
export function plainForSpeech(markdown: string, max = 900): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd()} The rest is on screen.`;
}

let current: HTMLAudioElement | null = null;
let release: ((finished: boolean) => void) | null = null;

/** Stop whatever is being spoken. Anything waiting on it carries on at once. */
export function stopSpeaking() {
  spoken++;
  current?.pause();
  current = null;
  release?.(false);
  release = null;
}

let spoken = 0;

/** Speak text and resolve when it has finished (true), or been stopped or failed (false). Never rejects: voice is an extra. */
export async function speakText(text: string): Promise<boolean> {
  const say = text.trim().slice(0, 1600);
  if (!say) return false;
  stopSpeaking();
  const mine = ++spoken;
  try {
    const { audio, mime } = await speak({ data: { text: say } });
    // Something newer was asked for, or speech was stopped, while this was being made.
    if (mine !== spoken) return false;
    return await new Promise<boolean>((resolve) => {
      const el = new Audio(`data:${mime};base64,${audio}`);
      current = el;
      release = resolve;
      el.onended = () => resolve(true);
      el.onerror = () => resolve(false);
      el.play().catch(() => resolve(false));
    });
  } catch {
    return false;
  } finally {
    if (mine === spoken) {
      current = null;
      release = null;
    }
  }
}

export interface Recording {
  /** Stop and return the transcript ("" when nothing was heard). */
  stop: () => Promise<string>;
  cancel: () => void;
}

export interface RecordingOptions {
  /** Called once when the speaker has finished (a pause after speech) or never started. Use it to stop and send without a tap. */
  onDone?: (spoke: boolean) => void;
  /** Quiet time after speech that counts as finished, in ms. */
  pauseMs?: number;
  /** How long to wait for the first word before giving up, in ms. */
  waitMs?: number;
}

/** Watch the microphone level and report when the speaker pauses after talking, or never talks. Returns a stop function. */
function watchForPause(stream: MediaStream, opts: Required<Pick<RecordingOptions, "pauseMs" | "waitMs">> & { onDone: (spoke: boolean) => void }): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ac = new Ctx();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const started = performance.now();
  let spokeAt = 0;
  let quietSince = 0;
  let floor = 0.012;
  let done = false;
  const finish = (spoke: boolean) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    void ac.close().catch(() => {});
    opts.onDone(spoke);
  };
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.sqrt(sum / buf.length);
    const now = performance.now();
    // The room's own noise sets the bar: speech is well above it.
    if (!spokeAt) floor = Math.min(0.05, Math.max(0.008, floor * 0.9 + level * 0.1));
    const loud = level > Math.max(0.03, floor * 3);
    if (loud) {
      spokeAt ||= now;
      quietSince = 0;
    } else if (spokeAt) {
      quietSince ||= now;
      if (now - quietSince > opts.pauseMs && now - spokeAt > 500) finish(true);
    } else if (now - started > opts.waitMs) finish(false);
  }, 80);
  return () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    void ac.close().catch(() => {});
  };
}

/** Start recording from the microphone. Rejects when the browser has no microphone or permission is refused. */
export async function startRecording(options: RecordingOptions = {}): Promise<Recording> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("This browser can't record audio");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  let unwatch = () => {};
  if (options.onDone) {
    try {
      unwatch = watchForPause(stream, { onDone: options.onDone, pauseMs: options.pauseMs ?? 1300, waitMs: options.waitMs ?? 7000 });
    } catch {
      /* no level meter: the user taps to send */
    }
  }
  const end = () => {
    unwatch();
    stream.getTracks().forEach((t) => t.stop());
  };
  return {
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      end();
    },
    stop: () =>
      new Promise<string>((resolve, reject) => {
        rec.onstop = async () => {
          end();
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
            if (blob.size < 1200) return resolve("");
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let bin = "";
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            const { text } = await transcribe({ data: { audio: btoa(bin), mime: blob.type } });
            resolve(text);
          } catch (e) {
            reject(e);
          }
        };
        if (rec.state !== "inactive") rec.stop();
        else rec.onstop?.(new Event("stop"));
      }),
  };
}
