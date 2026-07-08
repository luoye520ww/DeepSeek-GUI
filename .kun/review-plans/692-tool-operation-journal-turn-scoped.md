# PR plan: turn-scoped tool operation journal

Source rejection: KunAgent/Kun#692.

## Problem

The rejected operation journal identity used `threadId + callId`. Compatibility paths can generate fallback call IDs such as `call_1` across multiple turns in the same thread. That makes a later turn reuse or collide with an earlier turn's journal entry.

## Implementation direction

1. Add a journal identity that includes at least `threadId`, `turnId`, `callId`, `toolName`, and `argsHash`.
2. Never reuse completed results across different turns, even when the fallback call ID is the same.
3. Store execution state transitions: started, completed, failed, unknown/interrupted.
4. Only reuse results when thread, turn, call ID, tool name, and args hash all match.
5. Treat unknown outcomes for non-idempotent tools conservatively and require explicit retry handling.

## Files expected to change

- `kun/src/reliability/operation-journal.ts`
- `kun/src/reliability/operation-journal.test.ts`
- `kun/src/adapters/tool/local-tool-host.ts`
- `kun/src/adapters/tool/local-tool-host.operation-journal.test.ts`
- Runtime factory wiring if the journal is injected.

## Required tests

- Same thread, different turns, same fallback `call_1` do not collide.
- Same thread, same turn, same call ID, same tool, same args can reuse.
- Same call ID with different args does not reuse.
- Same call ID with different tool does not reuse.
- Interrupted/unknown non-idempotent tool results are not silently replayed.
