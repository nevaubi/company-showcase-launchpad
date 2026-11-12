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
let release: (() => void) | null = null;

/** Stop whatever is being spoken. Anything waiting on it carries on at once. */
export function stopSpeaking() {
  current?.pause();
  current = null;
  release?.();
  release = null;
}

/** Speak text and resolve when it has finished, been stopped, or failed. Never rejects: voice is an extra. */
export async function speakText(text: string): Promise<void> {
  const say = text.trim().slice(0, 1600);
  if (!say) return;
  stopSpeaking();
  try {
    const { audio, mime } = await speak({ data: { text: say } });
    await new Promise<void>((resolve) => {
      const el = new Audio(`data:${mime};base64,${audio}`);
      current = el;
      release = resolve;
      el.onended = () => resolve();
      el.onerror = () => resolve();
      el.play().catch(() => resolve());
    });
  } catch {
    /* no voice this time */
  } finally {
    current = null;
    release = null;
  }
}

export interface Recording {
  /** Stop and return the transcript ("" when nothing was heard). */
  stop: () => Promise<string>;
  cancel: () => void;
}

/** Start recording from the microphone. Rejects when the browser has no microphone or permission is refused. */
export async function startRecording(): Promise<Recording> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("This browser can't record audio");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const end = () => stream.getTracks().forEach((t) => t.stop());
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
