# App email rules

- App emails: every send goes through `queueEmail` (`src/lib/email/outbox.server.ts`), which records `email_log` first (idempotency key = template, recipient, row state), honours the daily cap in `email_settings` and is retried by the `emails` job; rules are pure in `src/lib/email/core.ts`.
