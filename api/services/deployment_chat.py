"""
Deployment Chat Manager — connects to locally deployed OpenClaw containers.

Allows the Agent Hub to chat with any running deployment from the Deploy Agent page.
Uses RemoteJasonClient under the hood to speak the OpenClaw WebSocket protocol.

Session names are generated as meaningful human-readable identifiers.
"""

import logging
import random
from typing import Optional

from services.remote_jason import RemoteJasonClient
from services.deployer import deployer

logger = logging.getLogger(__name__)

# --- Session Name Generator ---

_ADJECTIVES = [
    "Crimson", "Stellar", "Quantum", "Neural", "Cosmic", "Phantom",
    "Radiant", "Obsidian", "Emerald", "Sapphire", "Titanium", "Velvet",
    "Arctic", "Solar", "Lunar", "Thunder", "Crystal", "Shadow",
    "Neon", "Amber", "Cobalt", "Ivory", "Onyx", "Prism",
]

_NOUNS = [
    "Falcon", "Horizon", "Nexus", "Cipher", "Vortex", "Phoenix",
    "Sentinel", "Catalyst", "Beacon", "Forge", "Pulse", "Echo",
    "Vertex", "Orbit", "Zenith", "Aegis", "Flux", "Nova",
    "Helix", "Apex", "Drift", "Core", "Arc", "Spark",
]


def generate_session_name() -> str:
    """Generate a meaningful session name like 'Crimson Falcon'."""
    return f"{random.choice(_ADJECTIVES)} {random.choice(_NOUNS)}"


class DeploymentChatManager:
    """Manages chat connections to locally deployed OpenClaw containers."""

    def __init__(self):
        self._client: Optional[RemoteJasonClient] = None
        self._deployment_id: Optional[str] = None
        self._session_name: Optional[str] = None
        self._port: Optional[int] = None
        self._token: Optional[str] = None

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.connected

    @property
    def deployment_id(self) -> Optional[str]:
        return self._deployment_id

    @property
    def session_name(self) -> Optional[str]:
        return self._session_name

    async def connect(self, deployment_id: str, session_name: Optional[str] = None) -> dict:
        """Connect to a deployed container by its deployment ID.

        Looks up port/token from the deployer, creates a RemoteJasonClient,
        and performs the WebSocket handshake.

        Args:
            deployment_id: The deployment ID from the deploy list
            session_name: Optional custom session name (auto-generated if not provided)

        Returns:
            Connection info dict with session_name, deployment_id, port, protocol
        """
        # Disconnect existing connection first
        if self._client:
            await self._client.disconnect()
            self._client = None

        # Look up deployment info
        await deployer.restore_deployments()
        info = deployer._active_deployments.get(deployment_id)
        if not info:
            raise ValueError(f"Deployment {deployment_id} not found")

        port = info.get("port")
        token = info.get("gateway_token", "")
        status = info.get("status")

        if not port:
            raise ValueError(f"Deployment {deployment_id} has no port configured")
        if status != "running":
            raise ValueError(f"Deployment {deployment_id} is not running (status: {status})")
        if not token:
            raise ValueError(f"Deployment {deployment_id} has no gateway token")

        # Create client and connect
        # Local OpenClaw containers require client.id="cli" (not "gateway-client")
        ws_url = f"ws://localhost:{port}"
        self._client = RemoteJasonClient(
            url=ws_url,
            token=token,
            session_key="agent:main:main",
            gateway_client_id="cli",
        )

        try:
            hello = await self._client.connect()
        except Exception as e:
            self._client = None
            raise RuntimeError(f"Failed to connect to deployment {deployment_id} at {ws_url}: {e}")

        self._deployment_id = deployment_id
        self._port = port
        self._token = token
        self._session_name = session_name or generate_session_name()

        logger.info(
            f"Connected to deployment {deployment_id} at ws://localhost:{port} "
            f"(session: {self._session_name})"
        )

        return {
            "connected": True,
            "deployment_id": deployment_id,
            "session_name": self._session_name,
            "port": port,
            "protocol": hello.get("protocol"),
            "server": hello.get("server"),
        }

    async def disconnect(self):
        """Disconnect from the current deployment."""
        if self._client:
            await self._client.disconnect()
            self._client = None
        old_name = self._session_name
        self._deployment_id = None
        self._session_name = None
        self._port = None
        self._token = None
        logger.info(f"Disconnected from deployment chat (session: {old_name})")

    async def get_status(self) -> dict:
        """Get current connection status."""
        if not self._client or not self._client.connected:
            return {
                "connected": False,
                "deployment_id": None,
                "session_name": None,
            }

        return {
            "connected": True,
            "deployment_id": self._deployment_id,
            "session_name": self._session_name,
            "port": self._port,
            "url": f"ws://localhost:{self._port}",
        }

    async def send_message(self, content: str) -> dict:
        """Send a chat message to the connected deployment and get the response.

        Returns normalized message dict with role, name, content.
        """
        if not self._client or not self._client.connected:
            raise RuntimeError("Not connected to any deployment. Connect first.")

        response = await self._client.chat_send(content)

        # Normalize the OpenClaw response to our Message format
        content_parts = response.get("content", [])
        if isinstance(content_parts, list):
            text = "\n".join(
                part.get("text", "") for part in content_parts
                if isinstance(part, dict) and part.get("type") == "text"
            )
        elif isinstance(content_parts, str):
            text = content_parts
        else:
            text = str(content_parts)

        return {
            "role": "agent",
            "name": self._session_name or "Deployed Jason",
            "content": text,
            "model": response.get("model"),
        }

    async def get_history(self) -> list[dict]:
        """Get chat history from the connected deployment.

        Returns list of normalized message dicts.
        """
        if not self._client or not self._client.connected:
            raise RuntimeError("Not connected to any deployment. Connect first.")

        messages = await self._client.chat_history()

        normalized = []
        for msg in messages:
            role = msg.get("role", "assistant")
            content_parts = msg.get("content", [])
            if isinstance(content_parts, list):
                text = "\n".join(
                    part.get("text", "") for part in content_parts
                    if isinstance(part, dict) and part.get("type") == "text"
                )
            elif isinstance(content_parts, str):
                text = content_parts
            else:
                text = str(content_parts)

            normalized.append({
                "role": "user" if role == "user" else "agent",
                "name": (self._session_name or "Deployed Jason") if role != "user" else None,
                "content": text,
            })
        return normalized


# Singleton
deployment_chat_manager = DeploymentChatManager()
