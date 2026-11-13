# Phase 6A workflow scheduler

The scheduler is a one-shot, database-backed HTTP worker over the existing workflow rules and execution records. It does not start an in-process timer or accept event snapshots from callers.

## Supported scheduled triggers

A configured external scheduler should `POST /api/internal/automation/scheduler` over HTTPS every 15 minutes (or more frequently if needed). The route requires `Authorization: Bearer $WORKFLOW_SCHEDULER_SECRET`; the application rejects an unset/short secret and compares supplied credentials in constant time. The secret must be a random value of at least 32 characters, stored only in the application and scheduler secret managers. The route accepts no user-controlled body.

Each enabled workflow rule must have been created by an active internal organization member. That creator must still have `workflow.execute` and the relevant record read permission. Existing rules with no creator (created before Phase 6A) are skipped rather than assigned an implicit privileged actor. Actions are executed using the rule creator's current permissions and the existing allow-listed workflow action executor.

- `task.overdue`: tasks with a due date before the current UTC day, not done, under a non-deleted active project.
- `project.overdue`: active, non-deleted projects with an end date before the current UTC day.
- `invoice.overdue`: non-deleted sent/overdue invoices with a due date before the current UTC day. A due sent invoice transitions to `overdue` via a tenant-scoped compare-and-set and an audit record; subtotal, tax, total, payments, and due date are not changed. The enabled rule creator must retain `invoice.read`, `invoice.update`, and `workflow.execute`.

The form exposes these three triggers. Existing declarative conditions and supported actions still apply. Notification targets are evaluated by the existing organization-scoped notification executor and preference checks.

## Idempotency, concurrency and frequency

The event version is the UTC run day plus the record's due date. The existing unique `WorkflowExecution(ruleId, recordType, recordId, dedupeKey)` constraint claims a scheduled event before actions run; a concurrent scheduler invocation loses the insert race and does not execute actions. Notification actions also use their existing unique dedupe key. Scheduled events can run at most once per rule, record and UTC day; an edited due date forms a distinct event version. Execution outcomes are persisted in workflow history and an audit log entry is written for each claimed scheduled execution.

Disabled rules are excluded from enumeration and rechecked by the event dispatcher. Deletion is soft: deleted rules are hidden and disabled while retained execution history remains available in organization-wide history. A rule disabled/deleted after a workflow execution has already claimed its event is considered in flight and may finish. The overdue scan only changes a sent invoice's status from `sent` to `overdue`; payment rows and invoice amounts, totals, currency, and due date are read-only.

## HTTP outcomes and monitoring

The scheduler endpoint is an operational signal as well as a worker:

- **HTTP 200**, `status: "completed"`: the scan completed with `failed: 0`.
- **HTTP 500**, `status: "completed_with_failures"`: the scan finished, but one or more rule/event operations failed. The response retains only safe run timestamps/day and aggregate counts (`eligibleRules`, `skippedRules`, `scannedRecords`, `matched`, `executed`, `skipped`, `failed`); it contains no tenant/rule/record identifiers, action details, or exception data.
- **HTTP 500**, `status: "failed"`: the scheduler could not complete the scan. The response contains only a generic error; internal exception details and stack traces are not returned.

Alert on every non-2xx response and use the response `status` to distinguish partial from fatal failure. An already-claimed failed execution remains reported as a failure if the same event is encountered again that UTC day, but its actions are not replayed. Do not configure immediate HTTP retries as a failed-execution recovery mechanism: the database claim prevents replay of the same rule/record/day event, and Phase 6A does not reclaim failed or stale-running executions. The normal next-day scheduled event has its own idempotency window.

## Deployment

No paid service or production configuration is activated by this repository change. Deploy the additive Prisma migration using the usual migration release process, set `WORKFLOW_SCHEDULER_SECRET` in the application secret store, then configure the platform's scheduled-job facility (Kubernetes CronJob, Cloud Scheduler, ECS scheduled task, or equivalent) to call the route. Example:

```sh
curl --fail-with-body --silent --show-error \
  -X POST "$APP_URL/api/internal/automation/scheduler" \
  -H "Authorization: Bearer $WORKFLOW_SCHEDULER_SECRET"
```

Do not put the secret in a URL, command-line history, or logs. Remove the platform schedule and unset the secret to disable scheduled processing; no data is changed by doing so.

## Phase 6B boundary

This remains polling execution, not a durable queue/outbox. Phase 6B adds bounded stale-claim recovery and retry/backoff through this same protected scheduler, plus aggregate monitoring. It does not add dashboards, alert delivery, high-volume partitioning, or a general-purpose dead-letter processing interface. External scheduler invocations should still alert on non-2xx responses.

## Phase 6B recovery and monitoring

The protected scheduler remains the only scheduler entry point. Recovery is bounded to 100 rows per invocation and does not add a queue or separate automation engine.

- A random claim token fences each attempt. Checkpoints and finalization compare both tenant and token, preventing a stale worker from finalizing after another worker has taken over.
- Failed executions retry with exponential backoff beginning at one minute, doubling to a one-hour cap. Five total attempts (initial plus four recovery attempts) are allowed; after that the state becomes `terminal_failed`.
- `running` executions whose last attempt is at least 15 minutes old are eligible for recovery.
- The worker uses the saved action and event snapshot, not a mutable current rule definition. It requires the same-tenant rule to still exist, remain enabled and owned by the original creator; that creator must remain an active internal member with current workflow and record-read permissions.
- Only schema-valid `log`, deduplicated notification, and existing compare-and-set record mutation actions are automatically retryable. Unknown or invalid action types are quarantined. Potentially partial unsafe actions are never automatically replayed and require manual reconciliation.
- Successful action outcomes remain in the audit snapshot and are skipped on subsequent attempts. Notification dedupe keys and record mutation guards remain safeguards against duplicate effects.
- Persisted errors use stable non-sensitive categories, never exception text. Scheduler responses now include aggregate retry/quarantine/terminal totals and non-sensitive pending/running/failed/terminal counts.

Migration `0027_workflow_execution_recovery` adds retry scheduling, terminal timestamps, sanitized error categories, claim fencing tokens, and status-oriented indexes. Existing failed executions are made eligible one minute after their previous attempt/update; execution history and successful records are preserved. No invoice/payment mutation or database reset is performed.

Quarantined executions need human reconciliation; this phase adds no dashboard or alert delivery. Backlogs drain over repeated scheduler invocations. A database outage during side effects can still leave an ambiguous outcome; action idempotency and fencing mitigate duplicates, while unsupported third-party effects are intentionally not auto-replayed.
