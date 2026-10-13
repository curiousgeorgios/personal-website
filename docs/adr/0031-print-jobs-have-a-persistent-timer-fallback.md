# ADR-0031: Print jobs have a persistent timer fallback

Status: Accepted
Date: 2026-10-13

The production Worker exports `scheduled`, its five-minute Cron Trigger is registered and the exact production build completes the jobs locally. Production has recorded no cron dispatches or daily-job results. Equivalent schedule re-registration and deployment did not repair it. A minimal new Worker in the same account also failed to activate within Cloudflare's documented window, while older schedules continued to run. This points to activation of new registrations, rather than the print-job implementation. Cloudflare's similar 12 October incident is marked resolved; it does not establish the cause of this later failure.

Keep the existing cron and add one private SQLite-backed `PrintScheduler` Durable Object. A successful, authenticated production `/admin` response arms its first alarm. The alarm schedules the next pass before attempting any work, then runs the existing print jobs unless a cron completion is less than five minutes old. Order leases and the existing at-least-once handling remain in force. The timer continues without visitors and preserves a pending alarm across repeated admin visits, eviction and deployments. An unexpected failure leaves the next attempt scheduled.

The object uses the same Worker's bindings and secrets. It exposes no public endpoint, accepts no job payload and stores only timer state. D1 records `alarm_last_checked_at`, `alarm_next_at`, `alarm_last_run_at` and `cron_last_run_at`. These record an attempted pass, not proof that each provider succeeded; the existing daily timestamps and validated rate remain the acceptance evidence.

Automatic arming is compiled out of fixture builds because browser tests drive scheduled events explicitly. The production build must export the object and retain its binding; the build guard checks both. Before opening sales, visit the authenticated admin once, observe a real automatic alarm, verify all daily timestamps and a fresh stored USD/AUD rate, then observe a subsequent five-minute pass. No rate is inserted manually to satisfy this gate.

Source and investigation receipts: `reports/cron-fix-2026-10-13/`. This is a backend repair. Sales opening, catalogue publication and a physical sample order remain separate owner decisions.
