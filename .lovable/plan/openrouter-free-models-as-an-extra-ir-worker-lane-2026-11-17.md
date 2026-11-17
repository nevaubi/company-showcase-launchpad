# OpenRouter free models as an extra IR worker lane

## Short answer
Yes, as an extra reader. Not as a way around limits, and not as the main source.

- **Limits:** free models allow about 20 requests a minute. Accounts with no credits get about 50 requests a day. Buying $10 of credits once raises that to about 1,000 a day. That helps, but it is small next to the backfill (~1,500 companies, hundreds of thousands of files).
- **Rotating many accounts or keys to get past those limits breaks OpenRouter's terms** and can get them banned. The plan uses one account and stays within its limits.
- **Quality:** free models (DeepSeek, Llama, Qwen, Gemma and others) vary, sometimes fail or are slow, and can be taken away without notice. Some providers log what you send. That's fine for public filings, but never for user files or chats.

## What to build
1. **A free-model lane** next to the OpenAI lane. It uses one key (`OPENROUTER_API_KEY`) and keeps a daily and per-minute budget in the database, the same way the OpenAI allowance does. It never retries a request right away. When it gets "too many requests" it waits, and it stops for the day when the budget is used up.
2. **Model rotation:** a short list of free models that are good at reading tables and following instructions. The lane goes through the list in order and skips a model for an hour after it fails twice.
3. **Role: third opinion only.** It runs when the two current readers disagree or one of them fails, and it can confirm a figure but never save one by itself. The rules match the second reader: same date = confirmed, different dates = dropped.
4. **Public documents only:** IR releases, filings and slides. Never user files.
5. **Progress view:** a "Free models" tile on the worker page showing requests used today, confirmations and failures.
6. **Tests:** one test for the daily cap, one for skipping a failing model, and one that a figure only the free model found is not saved.

## Needs from you
- An OpenRouter key. A one-time $10 in credits is optional but makes the daily limit 20 times higher.
