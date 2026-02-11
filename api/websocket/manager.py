import json
from typing import Dict, Set
from fastapi import WebSocket


class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""

    def __init__(self):
        # Map of channel -> set of connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel: str = "general"):
        await websocket.accept()
        if channel not in self.active_connections:
            self.active_connections[channel] = set()
        self.active_connections[channel].add(websocket)

    def disconnect(self, websocket: WebSocket, channel: str = "general"):
        if channel in self.active_connections:
            self.active_connections[channel].discard(websocket)
            if not self.active_connections[channel]:
                del self.active_connections[channel]

    async def broadcast(self, channel: str, event: str, data: dict):
        """Broadcast an event to all connections on a channel."""
        message = json.dumps({"event": event, "data": data})
        if channel in self.active_connections:
            dead = set()
            for connection in self.active_connections[channel]:
                try:
                    await connection.send_text(message)
                except Exception:
                    dead.add(connection)
            # Clean up dead connections
            for conn in dead:
                self.active_connections[channel].discard(conn)

    async def broadcast_all(self, event: str, data: dict):
        """Broadcast to all channels."""
        for channel in list(self.active_connections.keys()):
            await self.broadcast(channel, event, data)

    async def send_to_session(self, session_id: str, event: str, data: dict):
        """Send to a specific chat session channel."""
        await self.broadcast(f"chat:{session_id}", event, data)


ws_manager = ConnectionManager()
