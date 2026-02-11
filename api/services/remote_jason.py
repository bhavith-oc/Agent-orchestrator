"""
Remote Jason Client — connects to an external OpenClaw gateway via WebSocket.

Speaks the OpenClaw JSON-RPC-over-WebSocket protocol:
  - Frame format: {type: "req", id: <uuid>, method: <str>, params: <obj>}
  - Response:     {type: "res", id: <uuid>, ok: bool, payload|error: ...}
  - Events:       {type: "event", event: <str>, payload: ...}

Supports token-based auth (no device identity required).
"""

import asyncio
import json
import logging
import uuid
from typing import Any, Optional, Callable

import websockets
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger(__name__)


class RemoteJasonClient:
    """Persistent WebSocket client for an OpenClaw gateway."""

    def __init__(
        self,
        url: str,
        token: str,
        session_key: str = "agent:main:main",
        on_event: Optional[Callable[[dict], None]] = None,
        cf_client_id: Optional[str] = None,
        cf_client_secret: Optional[str] = None,
        gateway_client_id: str = "gateway-client",
    ):
        self.url = url
        self.token = token
        self.session_key = session_key
        self.on_event = on_event
        self.cf_client_id = cf_client_id
        self.cf_client_secret = cf_client_secret
        self.gateway_client_id = gateway_client_id

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._pending: dict[str, asyncio.Future] = {}
        self._connected = False
        self._hello: Optional[dict] = None
        self._listen_task: Optional[asyncio.Task] = None
        self._reconnect_task: Optional[asyncio.Task] = None
        self._event_worker_task: Optional[asyncio.Task] = None
        self._stopped = False

        # Event sequence tracking — detect gaps from the gateway
        self._last_seq: int = -1
        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._gap_count: int = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> dict:
        """Connect to the gateway and complete the handshake. Returns hello payload."""
        self._stopped = False
        # Reset sequence tracking on fresh connection
        self._last_seq = -1

        # Build extra headers for Cloudflare Access (if behind CF Zero Trust)
        extra_headers = {}
        if self.cf_client_id and self.cf_client_secret:
            extra_headers["CF-Access-Client-Id"] = self.cf_client_id
            extra_headers["CF-Access-Client-Secret"] = self.cf_client_secret
            # Also set as cookie fallback (some CF setups need this)
            extra_headers["Cookie"] = f"CF_Authorization={self.cf_client_secret}"
            logger.info("Using Cloudflare Access service token for WSS connection")

        try:
            ws = await asyncio.wait_for(
                websockets.connect(
                    self.url,
                    ping_interval=20,
                    ping_timeout=10,
                    extra_headers=extra_headers or None,
                ),
                timeout=15,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Connection to {self.url} timed out after 15s. "
                "If this endpoint is behind Cloudflare Access, "
                "provide CF-Access-Client-Id and CF-Access-Client-Secret."
            )
        except Exception as e:
            err_str = str(e)
            if "cloudflareaccess.com" in err_str or "access/login" in err_str:
                raise RuntimeError(
                    "Cloudflare Access is blocking the connection. "
                    "This endpoint requires Cloudflare Access service token credentials. "
                    "Please provide CF-Access-Client-Id and CF-Access-Client-Secret "
                    "from your Cloudflare Zero Trust dashboard."
                ) from e
            raise
        self._ws = ws

        # 1. Read challenge
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        challenge = json.loads(raw)
        if challenge.get("type") != "event" or challenge.get("event") != "connect.challenge":
            raise RuntimeError(f"Expected connect.challenge, got: {challenge}")

        # 2. Send connect request
        hello = await self._send_connect()
        self._connected = True
        self._hello = hello
        logger.info(f"Connected to remote Jason at {self.url}")

        # 3. Start background listener + async event processor
        self._listen_task = asyncio.create_task(self._listen_loop())
        self._event_worker_task = asyncio.create_task(self._process_events())
        return hello

    async def disconnect(self):
        """Gracefully disconnect."""
        self._stopped = True
        self._connected = False
        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
        if self._event_worker_task and not self._event_worker_task.done():
            self._event_worker_task.cancel()
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
        if self._ws:
            await self._ws.close()
            self._ws = None
        self._flush_pending("disconnected")
        logger.info("Disconnected from remote Jason")

    @property
    def connected(self) -> bool:
        return self._connected and self._ws is not None

    @property
    def hello_payload(self) -> Optional[dict]:
        return self._hello

    # ------------------------------------------------------------------
    # RPC
    # ------------------------------------------------------------------

    async def request(self, method: str, params: Optional[dict] = None, timeout: float = 30.0) -> Any:
        """Send an RPC request and wait for the response payload."""
        if not self._ws or not self._connected:
            raise RuntimeError("Not connected to remote Jason")

        req_id = str(uuid.uuid4())
        frame = {
            "type": "req",
            "id": req_id,
            "method": method,
            "params": params or {},
        }

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = future

        await self._ws.send(json.dumps(frame))

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise TimeoutError(f"RPC {method} timed out after {timeout}s")

    # ------------------------------------------------------------------
    # Chat convenience methods
    # ------------------------------------------------------------------

    @staticmethod
    def _count_llm_messages(messages: list[dict]) -> int:
        """Count messages that are actual LLM responses (have model set + non-empty content)."""
        count = 0
        for m in messages:
            if m.get("role") == "user":
                continue
            if not m.get("model"):
                continue
            content = m.get("content", "")
            if isinstance(content, list):
                text = "".join(
                    p.get("text", "") for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                )
            elif isinstance(content, str):
                text = content
            else:
                text = ""
            if text.strip():
                count += 1
        return count

    @staticmethod
    def _has_content(m: dict) -> bool:
        """Check if a message has non-empty text content."""
        content = m.get("content", "")
        if isinstance(content, list):
            text = "".join(
                p.get("text", "") for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            )
        elif isinstance(content, str):
            text = content
        else:
            text = ""
        return len(text.strip()) > 0

    @staticmethod
    def _is_error_response(m: dict) -> bool:
        """Check if a message is an error response from the LLM provider."""
        return (m.get("stopReason") == "error"
                or bool(m.get("errorMessage")))

    async def chat_history(self, session_key: Optional[str] = None) -> list[dict]:
        """Get chat history for a session."""
        key = session_key or self.session_key
        result = await self.request("chat.history", {"sessionKey": key})
        return result.get("messages", [])

    async def chat_send(self, message: str, session_key: Optional[str] = None) -> dict:
        """Send a chat message and wait for the agent response.

        chat.send is async — it returns {status: "started", runId: ...}.
        We then poll chat.history until a new assistant message appears.
        """
        key = session_key or self.session_key

        # Snapshot total message count BEFORE sending.
        # We will only look at messages AFTER this index for the response.
        old_messages = await self.chat_history(key)
        baseline_index = len(old_messages)

        # Send with required idempotencyKey
        idempotency_key = str(uuid.uuid4())
        result = await self.request(
            "chat.send",
            {
                "sessionKey": key,
                "idempotencyKey": idempotency_key,
                "message": message,
            },
            timeout=30.0,
        )
        logger.info(f"chat.send accepted: {result}")

        # Poll history until a NEW assistant message with text appears
        return await self._poll_for_response(key, baseline_index, timeout=180.0)

    async def _poll_for_response(
        self, session_key: str, baseline_index: int, timeout: float = 180.0
    ) -> dict:
        """Poll chat.history until a new LLM response with text appears.

        Only examines messages AFTER baseline_index (the message count before
        we sent our request). This prevents returning stale old responses.

        Some models (Claude, DeepSeek) emit tool calls first with empty text,
        then produce text content in a later message. We track total message
        count as an activity signal — keep polling while new messages appear
        (agent is actively working), even if none have text yet.
        """
        import time
        deadline = time.monotonic() + timeout
        poll_interval = 1.5
        last_msg_count = baseline_index
        idle_polls = 0  # consecutive polls with no new messages

        while time.monotonic() < deadline:
            await asyncio.sleep(poll_interval)
            messages = await self.chat_history(session_key)
            current_count = len(messages)

            # Only look at NEW messages (after baseline)
            new_messages = messages[baseline_index:]

            # Check for error responses first (e.g. 402 insufficient credits)
            for msg in reversed(new_messages):
                if msg.get("role") != "user" and self._is_error_response(msg):
                    error_msg = msg.get("errorMessage", "Unknown LLM provider error")
                    logger.error(f"LLM provider error: {error_msg}")
                    raise RuntimeError(f"LLM provider error: {error_msg}")

            # Check for a new LLM message with text content (ideal case)
            for msg in reversed(new_messages):
                if (msg.get("role") != "user"
                        and msg.get("model")
                        and self._has_content(msg)):
                    return msg

            # Track activity — new messages appearing means agent is working
            if current_count > last_msg_count:
                idle_polls = 0
                last_msg_count = current_count
                poll_interval = 1.5  # reset to fast polling when active
                logger.debug(f"Poll: {current_count - baseline_index} new msgs, waiting for text...")
            else:
                idle_polls += 1

            # If idle for 20+ consecutive polls (~40s) with no new text,
            # check for any non-empty agent message in new messages
            if idle_polls >= 20:
                for msg in reversed(new_messages):
                    if msg.get("role") != "user" and self._has_content(msg):
                        return msg
                # Truly idle with no content at all
                break

            poll_interval = min(poll_interval + 0.3, 3.0)

        raise TimeoutError(f"No response from remote Jason after {timeout}s")

    async def chat_abort(self, session_key: Optional[str] = None) -> dict:
        """Abort the current chat generation."""
        key = session_key or self.session_key
        return await self.request("chat.abort", {"sessionKey": key})

    async def get_status(self) -> dict:
        """Get gateway status."""
        return await self.request("status")

    async def get_health(self) -> dict:
        """Get gateway health."""
        return await self.request("health")

    async def get_agents(self) -> dict:
        """Get agents list."""
        return await self.request("agents.list")

    async def get_sessions(self) -> dict:
        """Get sessions list."""
        return await self.request("sessions.list")

    async def get_models(self) -> list:
        """Get available models."""
        return await self.request("models.list")

    # ------------------------------------------------------------------
    # Agent Files (persona files like IDENTITY.md)
    # ------------------------------------------------------------------

    async def read_file(self, path: str) -> str:
        """Read a file from the agent workspace."""
        result = await self.request("files.read", {"path": path})
        return result.get("content", "")

    async def write_file(self, path: str, content: str) -> dict:
        """Write a file to the agent workspace."""
        return await self.request("files.write", {"path": path, "content": content})

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    async def get_config(self) -> dict:
        """Get the full OpenClaw config (raw, parsed, hash, issues)."""
        return await self.request("config.get")

    async def set_config(self, raw: str, config_hash: str = "") -> dict:
        """Replace the entire config. Requires baseHash from config.get for concurrency."""
        params = {"raw": raw}
        if config_hash:
            params["baseHash"] = config_hash
        return await self.request("config.set", params)

    async def patch_config(self, raw: str, config_hash: str, restart_delay_ms: int = 2000) -> dict:
        """Partial config update — merges keys into existing config. Gateway restarts after."""
        params = {
            "raw": raw,
            "baseHash": config_hash,
            "restartDelayMs": restart_delay_ms,
        }
        return await self.request("config.patch", params)

    async def create_agent(
        self,
        agent_id: str,
        name: str,
        model: Optional[str] = None,
        workspace: Optional[str] = None,
        identity: Optional[dict] = None,
        sandbox: Optional[dict] = None,
    ) -> dict:
        """Create a new OpenClaw agent by patching the config.

        1. Fetches current config + hash
        2. Appends new agent to agents.list[]
        3. Patches config → gateway restarts with new agent
        """
        import json as _json

        # 1. Get current config
        cfg_result = await self.get_config()
        config_hash = cfg_result.get("hash", "")
        parsed = cfg_result.get("parsed", {})

        # 2. Build new agent entry
        agent_entry: dict = {"id": agent_id}
        if name:
            agent_entry["name"] = name
        if workspace:
            agent_entry["workspace"] = workspace
        else:
            agent_entry["workspace"] = f"~/.openclaw/workspace-{agent_id}"
        if model:
            agent_entry["model"] = model
        if identity:
            agent_entry["identity"] = identity
        if sandbox:
            agent_entry["sandbox"] = sandbox
        agent_entry["subagents"] = {"allowAgents": ["*"]}

        # 3. Append to agents.list (or create it)
        agents_cfg = parsed.get("agents", {})
        agents_list = agents_cfg.get("list", [])

        # Check for duplicate
        existing_ids = [a.get("id") for a in agents_list]
        if agent_id in existing_ids:
            raise RuntimeError(f"Agent '{agent_id}' already exists in OpenClaw config")

        agents_list.append(agent_entry)

        # 4. Build patch payload — only the agents.list key
        patch = {"agents": {"list": agents_list}}
        raw_patch = _json.dumps(patch)

        logger.info(f"Creating OpenClaw agent '{agent_id}' via config.patch")
        result = await self.patch_config(raw_patch, config_hash, restart_delay_ms=2000)
        return {"agent": agent_entry, "patch_result": result}

    async def get_agent_files(self, agent_id: str = "main") -> dict:
        """List agent workspace files."""
        return await self.request("agents.files.list", {"agentId": agent_id})

    async def get_agent_file(self, name: str, agent_id: str = "main") -> dict:
        """Get a single agent file's content."""
        return await self.request("agents.files.get", {"agentId": agent_id, "name": name})

    async def set_agent_file(self, name: str, content: str, agent_id: str = "main") -> dict:
        """Set a single agent file's content."""
        return await self.request("agents.files.set", {"agentId": agent_id, "name": name, "content": content})

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _send_connect(self) -> dict:
        """Send the connect handshake frame and return the hello payload."""
        req_id = str(uuid.uuid4())
        connect_frame = {
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": self.gateway_client_id,
                    "version": "1.0.0",
                    "platform": "linux",
                    "mode": "backend",
                    "instanceId": str(uuid.uuid4())[:8],
                },
                "role": "operator",
                "scopes": ["operator.admin"],
                "caps": [],
                "auth": {"token": self.token},
                "userAgent": "Aether-Orchestrator/1.0",
                "locale": "en-US",
            },
        }

        await self._ws.send(json.dumps(connect_frame))

        # Wait for the connect response (skip any events)
        for _ in range(20):
            raw = await asyncio.wait_for(self._ws.recv(), timeout=10)
            msg = json.loads(raw)
            if msg.get("type") == "res" and msg.get("id") == req_id:
                if not msg.get("ok"):
                    error = msg.get("error", {})
                    raise RuntimeError(
                        f"Connect failed: {error.get('code', '?')}: {error.get('message', '?')}"
                    )
                return msg.get("payload", {})
        raise RuntimeError("No connect response received")

    async def _listen_loop(self):
        """Background loop that routes incoming messages to pending futures or event queue.

        Events are dispatched to an async queue instead of being processed inline,
        preventing backpressure that causes the gateway to disconnect us as a
        'slow consumer'.
        """
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

                if msg_type == "res":
                    req_id = msg.get("id")
                    future = self._pending.pop(req_id, None)
                    if future and not future.done():
                        if msg.get("ok"):
                            future.set_result(msg.get("payload", {}))
                        else:
                            error = msg.get("error", {})
                            future.set_exception(
                                RuntimeError(f"{error.get('code', '?')}: {error.get('message', '?')}")
                            )

                elif msg_type == "event":
                    # Track event sequence to detect gaps
                    seq = msg.get("seq")
                    if seq is not None and isinstance(seq, int):
                        if self._last_seq >= 0 and seq > self._last_seq + 1:
                            gap = seq - self._last_seq - 1
                            self._gap_count += 1
                            logger.warning(
                                f"Event gap detected (expected seq {self._last_seq + 1}, "
                                f"got {seq}); {gap} events missed — scheduling refresh"
                            )
                            asyncio.create_task(self._handle_seq_gap(gap))
                        self._last_seq = seq

                    # Dispatch to async queue (non-blocking to avoid backpressure)
                    try:
                        self._event_queue.put_nowait(msg)
                    except asyncio.QueueFull:
                        # Drop oldest event to keep up — better than disconnecting
                        try:
                            self._event_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                        self._event_queue.put_nowait(msg)

        except ConnectionClosed as e:
            logger.warning(f"Remote Jason connection closed: {e}")
            self._connected = False
            self._flush_pending("connection closed")
            if not self._stopped:
                self._reconnect_task = asyncio.create_task(self._reconnect())
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Listen loop error: {e}")
            self._connected = False
            self._flush_pending(str(e))

    async def _process_events(self):
        """Async worker that drains the event queue and calls the event handler.

        Running event handlers in a separate task prevents slow handlers from
        blocking the WebSocket read loop (which causes 'slow consumer' kicks).
        """
        try:
            while not self._stopped:
                msg = await self._event_queue.get()
                if self.on_event:
                    try:
                        self.on_event(msg)
                    except Exception as e:
                        logger.error(f"Event handler error: {e}")
        except asyncio.CancelledError:
            pass

    async def _handle_seq_gap(self, gap: int):
        """Handle a detected event sequence gap.

        When the gateway reports a gap, some events were lost. The safest
        recovery is to log the gap and let any polling-based logic (e.g.
        _poll_for_response, _monitor_remote_completion) naturally catch up
        on the next history fetch. For large gaps, we log at error level.
        """
        if gap > 100:
            logger.error(
                f"Large event gap ({gap} events missed, total gaps: {self._gap_count}). "
                f"Consider checking network stability to the OpenClaw gateway."
            )
        else:
            logger.info(f"Small event gap ({gap} events), polling will recover.")

    async def _reconnect(self, max_retries: int = 10):
        """Auto-reconnect with exponential backoff."""
        delay = 1.0
        for attempt in range(max_retries):
            if self._stopped:
                return
            logger.info(f"Reconnecting to remote Jason (attempt {attempt + 1})...")
            await asyncio.sleep(delay)
            try:
                await self.connect()
                logger.info("Reconnected to remote Jason")
                return
            except Exception as e:
                logger.warning(f"Reconnect failed: {e}")
                delay = min(delay * 1.5, 30.0)
        logger.error(f"Failed to reconnect after {max_retries} attempts")

    def _flush_pending(self, reason: str):
        """Reject all pending futures."""
        for req_id, future in self._pending.items():
            if not future.done():
                future.set_exception(RuntimeError(reason))
        self._pending.clear()


# ---------------------------------------------------------------------------
# Singleton manager
# ---------------------------------------------------------------------------

class RemoteJasonManager:
    """Manages the lifecycle of a single remote Jason connection."""

    def __init__(self):
        self._client: Optional[RemoteJasonClient] = None
        self._config: Optional[dict] = None

    @property
    def client(self) -> Optional[RemoteJasonClient]:
        return self._client

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.connected

    @property
    def config(self) -> Optional[dict]:
        return self._config

    async def connect(
        self,
        url: str,
        token: str,
        session_key: str = "agent:main:main",
        cf_client_id: Optional[str] = None,
        cf_client_secret: Optional[str] = None,
    ) -> dict:
        """Connect to a remote Jason instance. Disconnects existing connection first."""
        if self._client:
            await self._client.disconnect()

        # Derive WS URL from HTTP URL if needed
        ws_url = url
        if ws_url.startswith("http://"):
            ws_url = "ws://" + ws_url[7:]
        elif ws_url.startswith("https://"):
            ws_url = "wss://" + ws_url[8:]
        # Strip path if present (we connect to root)
        if ws_url.count("/") > 2:
            parts = ws_url.split("/")
            ws_url = "/".join(parts[:3])

        self._client = RemoteJasonClient(
            url=ws_url,
            token=token,
            session_key=session_key,
            cf_client_id=cf_client_id,
            cf_client_secret=cf_client_secret,
        )
        hello = await self._client.connect()
        self._config = {
            "url": url,
            "ws_url": ws_url,
            "token": token,
            "session_key": session_key,
        }
        return hello

    async def disconnect(self):
        """Disconnect from the remote Jason instance."""
        if self._client:
            await self._client.disconnect()
            self._client = None
            self._config = None

    async def get_info(self) -> dict:
        """Get info about the current remote connection."""
        if not self._client or not self._client.connected:
            return {"connected": False}

        try:
            health = await self._client.get_health()
        except Exception:
            health = {}

        hello = self._client.hello_payload or {}
        snapshot = hello.get("snapshot", {})

        return {
            "connected": True,
            "url": self._config.get("url", "") if self._config else "",
            "session_key": self._config.get("session_key", "") if self._config else "",
            "protocol": hello.get("protocol"),
            "server": hello.get("server"),
            "health": health,
            "uptime_ms": snapshot.get("uptimeMs"),
        }


# Global singleton
remote_jason_manager = RemoteJasonManager()
