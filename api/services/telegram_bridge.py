"""
Telegram Bridge — Listens to master OpenClaw container's WebSocket event stream
for Telegram-sourced chat messages and routes them into the orchestration pipeline.

Flow:
1. Connects to master container via RemoteJasonClient (same as DeploymentChatManager)
2. Registers on_event handler that filters for Telegram-sourced messages
3. On Telegram message: creates Mission card, team chat session, starts orchestration
4. On task complete: sends summary + UI link back via master container → Telegram
"""

import asyncio
import logging
import uuid
from typing import Optional

from services.deployer import deployer
from services.remote_jason import RemoteJasonClient
from services.team_chat import team_chat
from services.orchestrator import orchestrator, OrchestratorTask
from websocket.manager import ws_manager
from config import settings
from database import async_session
from models.mission import Mission

logger = logging.getLogger(__name__)


class TelegramBridge:
    """Bridges Telegram messages from the master OpenClaw container to the orchestrator."""

    def __init__(self):
        self._client: Optional[RemoteJasonClient] = None
        self._deployment_id: Optional[str] = None
        self._running = False
        # Track processed message IDs to avoid duplicates
        self._processed_ids: set[str] = set()

    @property
    def is_running(self) -> bool:
        return self._running and self._client is not None and self._client.connected

    async def start(self, deployment_id: str) -> dict:
        """Start listening to a master container's event stream for Telegram messages.

        Args:
            deployment_id: The deployment ID of the master OpenClaw container
        """
        if self._client:
            await self.stop()

        await deployer.restore_deployments()
        info = deployer._active_deployments.get(deployment_id)
        if not info:
            raise ValueError(f"Deployment {deployment_id} not found")

        port = info.get("port")
        token = info.get("gateway_token", "")
        status = info.get("status")

        if status != "running":
            raise ValueError(f"Deployment {deployment_id} is not running (status: {status})")
        if not token:
            raise ValueError(f"Deployment {deployment_id} has no gateway token")

        ws_url = f"ws://localhost:{port}"
        self._client = RemoteJasonClient(
            url=ws_url,
            token=token,
            session_key="agent:main:main",
            on_event=self._handle_event,
            gateway_client_id="telegram-bridge",
        )

        try:
            hello = await self._client.connect()
        except Exception as e:
            self._client = None
            raise RuntimeError(f"Failed to connect to deployment {deployment_id}: {e}")

        self._deployment_id = deployment_id
        self._running = True

        logger.info(f"TelegramBridge started — listening on deployment {deployment_id} (port {port})")

        return {
            "status": "running",
            "deployment_id": deployment_id,
            "port": port,
        }

    async def stop(self):
        """Stop listening."""
        self._running = False
        if self._client:
            await self._client.disconnect()
            self._client = None
        self._deployment_id = None
        logger.info("TelegramBridge stopped")

    def _handle_event(self, msg: dict):
        """Event handler called by RemoteJasonClient._process_events.

        This runs in the event loop context. We filter for Telegram-sourced
        chat messages and schedule async processing.
        """
        if not self._running:
            return

        event_name = msg.get("event", "")
        payload = msg.get("payload", {})

        # Look for chat message events that came from Telegram
        # OpenClaw events: chat.message, chat.update, agent.message, etc.
        if event_name in ("chat.message", "agent.message"):
            source = payload.get("source", {})
            channel = source.get("channel", "")

            if channel == "telegram":
                # Schedule async processing
                asyncio.create_task(self._process_telegram_message(payload))

    async def _process_telegram_message(self, payload: dict):
        """Process an incoming Telegram message from the event stream."""
        try:
            # Extract message content
            message_content = ""
            content = payload.get("content", payload.get("message", ""))
            if isinstance(content, list):
                # OpenClaw content format: [{type: "text", text: "..."}]
                message_content = "\n".join(
                    part.get("text", "") for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                )
            elif isinstance(content, str):
                message_content = content
            else:
                message_content = str(content)

            if not message_content.strip():
                return

            # Deduplicate by message ID
            msg_id = payload.get("id", payload.get("messageId", ""))
            if not msg_id:
                msg_id = uuid.uuid4().hex[:12]
            if msg_id in self._processed_ids:
                return
            self._processed_ids.add(msg_id)
            # Cap the set size
            if len(self._processed_ids) > 1000:
                self._processed_ids = set(list(self._processed_ids)[-500:])

            source = payload.get("source", {})
            telegram_chat_id = source.get("chatId", "")

            logger.info(f"Telegram message received: {message_content[:100]}...")

            # Create a Mission card on the Kanban board
            async with async_session() as db:
                mission = Mission(
                    title=message_content[:100],
                    description=message_content,
                    status="Queue",
                    priority="General",
                    source="telegram",
                    source_message_id=f"{telegram_chat_id}:{msg_id}",
                )
                db.add(mission)
                await db.commit()
                await db.refresh(mission)
                mission_id = mission.id

            logger.info(f"Created mission {mission_id} from Telegram message")

            # Broadcast new mission to UI
            await ws_manager.broadcast_all("mission:created", {
                "mission_id": mission_id,
                "title": message_content[:100],
                "source": "telegram",
            })

            # Post to team chat
            await team_chat.post_message(
                mission_id, "Telegram",
                f"New task from Telegram:\n\n{message_content}",
                role="user",
            )

            # Send acknowledgment back via Telegram (through master container)
            await self._send_telegram_reply(
                f"📋 Task received! Mission #{mission_id} created.\n"
                f"Planning subtasks now...\n\n"
                f"Track progress: {settings.UI_BASE_URL}"
            )

            # Start orchestration
            deployment_id = self._deployment_id or settings.MASTER_DEPLOYMENT_ID
            if not deployment_id:
                logger.error("No master deployment ID configured for orchestration")
                return

            await orchestrator.submit_task(
                description=message_content,
                master_deployment_id=deployment_id,
                mission_id=mission_id,
                on_complete=self._on_task_complete,
            )

        except Exception as e:
            logger.error(f"Failed to process Telegram message: {e}", exc_info=True)

    async def _on_task_complete(self, task: OrchestratorTask):
        """Callback when an orchestrated task completes. Sends summary via Telegram."""
        try:
            status = "✅ Completed" if task.status.value == "completed" else "❌ Failed"
            result_preview = ""
            if task.final_result:
                result_preview = task.final_result[:800]
            elif task.error:
                result_preview = f"Error: {task.error}"

            subtask_summary = "\n".join(
                f"  • {st.agent_type}: {st.status.value}"
                for st in task.subtasks
            )

            message = (
                f"{status}\n\n"
                f"**Task:** {task.description[:150]}\n\n"
                f"**Subtasks:**\n{subtask_summary}\n\n"
                f"**Result:**\n{result_preview}\n\n"
                f"Full details: {settings.UI_BASE_URL}"
            )

            await self._send_telegram_reply(message)

        except Exception as e:
            logger.error(f"Failed to send Telegram completion reply: {e}")

    async def _send_telegram_reply(self, text: str):
        """Send a message back through the master container's Telegram channel.

        Uses the master container's chat.send to reply — the container routes
        the response back to the Telegram user automatically.
        """
        if not self._client or not self._client.connected:
            logger.warning("Cannot send Telegram reply — not connected to master container")
            return

        try:
            # Send via the master container's chat — it will route to Telegram
            await self._client.chat_send(text, session_key="agent:main:main")
        except Exception as e:
            logger.warning(f"Failed to send Telegram reply: {e}")


# Singleton
telegram_bridge = TelegramBridge()
