# Bug Fix: Event Gap & Slow Consumer Disconnects

**Date:** 2026-02-09  
**Status:** Fixed & Verified

---

## Issue

The remote OpenClaw container intermittently reports:
```
event gap detected (expected seq 52067, got 52514); refresh recommended
```

This is accompanied by "slow consumer" WebSocket disconnects:
```
received 1008 (policy violation) slow consumer
```

## Root Cause

The OpenClaw gateway streams events with sequential `seq` IDs. Our `_listen_loop` was processing events **inline** (calling `on_event` synchronously inside the WebSocket read loop). If the event handler was slow, the read loop stalled, the gateway's send buffer filled, and it kicked us as a "slow consumer". After reconnect, the `seq` jumped — producing the gap warning.

## Fix (`api/services/remote_jason.py`)

Three changes to `RemoteJasonClient`:

### 1. Async event queue (prevents slow consumer)
Events are now dispatched to a bounded `asyncio.Queue(maxsize=500)` instead of being processed inline. A separate `_process_events()` worker drains the queue and calls `on_event`. This decouples the WebSocket read loop from event processing — the read loop stays fast and never blocks.

If the queue fills (handler is very slow), the oldest event is dropped rather than blocking the read loop.

### 2. Event sequence tracking (detects gaps)
`_listen_loop` now tracks `_last_seq` and detects when `seq` jumps. On gap detection:
- **Small gaps (<100):** Logged as info — polling-based logic (`_poll_for_response`, `_monitor_remote_completion`) will naturally catch up on the next `chat.history` fetch.
- **Large gaps (>100):** Logged as error with a recommendation to check network stability.

### 3. Sequence reset on reconnect
`_last_seq` is reset to `-1` on `connect()` so we don't get false gap detections after a fresh connection.

## Why This Is Sufficient

Our orchestrator doesn't rely on real-time events for correctness — it uses **polling** (`chat.history`) to detect responses and completion. Events are informational (status updates, heartbeats). So missed events don't cause data loss; they just mean slightly delayed UI updates until the next poll cycle.

## Files Modified

| File | Change |
|------|--------|
| `api/services/remote_jason.py` | Added `_last_seq`, `_event_queue`, `_gap_count` tracking; async `_process_events()` worker; `_handle_seq_gap()` handler; seq reset on reconnect |
