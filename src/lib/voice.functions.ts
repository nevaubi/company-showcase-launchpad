// Voice for the assistant: text to speech and speech to text through the Lovable AI Gateway.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAccess } from "@/lib/app-access-middleware";

const SPEECH_MODEL = "openai/gpt-4o-mini-tts" as const;
const TRANSCRIBE_MODEL = "openai/gpt-4o-mini-transcribe" as const;

/** Speak a short passage. Returns MP3 audio as base64. */
export const speak = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ text: z.string().min(1).max(1600) }).parse(d))
  .handler(async ({ data }) => {
    const { generateSpeech } = await import("@lovable.dev/ai-gateway");
    const { friendlyAiError } = await import("@/lib/ai.server");
    try {
      const audio = await generateSpeech({
        model: SPEECH_MODEL,
        input: data.text,
        voice: "nova",
        response_format: "mp3",
        instructions: "You are an equity research analyst talking a colleague through a company. Speak clearly and evenly, at a natural pace, without salesmanship. Read dollar amounts and percentages the way a person would say them.",
      });
      const bytes = new Uint8Array(await (await audio.blob()).arrayBuffer());
      return { mime: "audio/mpeg", audio: Buffer.from(bytes).toString("base64") };
    } catch (e) {
      throw friendlyAiError(e);
    }
  });

/** Turn a short recording into text. Audio arrives as base64; about 6 MB at most. */
export const transcribe = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ audio: z.string().min(16).max(8_500_000), mime: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { transcribeAudio } = await import("@lovable.dev/ai-gateway");
    const { friendlyAiError } = await import("@/lib/ai.server");
    try {
      const mime = /^audio\/[\w.+-]+/.test(data.mime) ? data.mime.split(";")[0] : "audio/webm";
      const file = new File([Buffer.from(data.audio, "base64")], `question.${mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm"}`, { type: mime });
      const res = await transcribeAudio({ model: TRANSCRIBE_MODEL, file, language: "en", prompt: "A question about a public company: tickers, financial metrics, SEC filings." });
      return { text: String((res as { text?: string }).text ?? "").trim() };
    } catch (e) {
      throw friendlyAiError(e);
    }
  });
