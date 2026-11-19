# AI credit usage check (no changes needed)

## Findings
- Since 13:00 UTC yesterday there were 224 built-in AI requests, all from the IR worker's figure extraction (model gpt-6.1-sol).
- The latest 50 ran 00:45–00:49 UTC and cost about 18.4 credits together (~0.2–0.46 each).
- The last request was at 00:49 UTC, right before the worker was paused. Nothing has used AI credits in the 34 minutes since.

## Optional next steps (only if wanted)
1. Before resuming the worker, switch its built-in AI reader to a cheaper model or to the free OpenAI/OpenRouter lanes first, with built-in AI only as fallback.
2. Add a daily credit cap for the worker's built-in AI calls, with a tile on the worker page.
