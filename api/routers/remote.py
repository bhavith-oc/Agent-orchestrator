"""
Router for managing the remote Jason (OpenClaw) orchestrator connection.

Endpoints:
  POST   /api/remote/connect          — connect to a remote OpenClaw gateway
  POST   /api/remote/disconnect       — disconnect from remote
  GET    /api/remote/status           — get connection status + info
  GET    /api/remote/history          — get chat history from remote session
  POST   /api/remote/send             — send a message to remote Jason
  GET    /api/remote/sessions         — list remote sessions
  GET    /api/remote/agents           — list remote agents
  GET    /api/remote/models           — list remote models
  GET    /api/remote/config           — get OpenClaw config
  PUT    /api/remote/config           — set OpenClaw config
  GET    /api/remote/agent-files      — list agent persona files
  GET    /api/remote/agent-files/{n}  — get agent file content
  PUT    /api/remote/agent-files/{n}  — set agent file content
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.remote_jason import remote_jason_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/remote", tags=["remote"])


# --- Schemas ---

class RemoteConnectRequest(BaseModel):
    url: str
    token: str
    session_key: str = "agent:main:main"
    cf_client_id: Optional[str] = None
    cf_client_secret: Optional[str] = None


class RemoteSendRequest(BaseModel):
    content: str
    session_key: Optional[str] = None


class RemoteConfigSetRequest(BaseModel):
    config: dict
    hash: str


class RemoteAgentFileSetRequest(BaseModel):
    content: str


class CreateAgentRequest(BaseModel):
    agent_id: str
    name: str
    model: Optional[str] = None
    workspace: Optional[str] = None
    identity: Optional[dict] = None
    sandbox: Optional[dict] = None


# --- Endpoints ---

@router.post("/connect")
async def connect_remote(req: RemoteConnectRequest):
    """Connect to a remote OpenClaw Jason instance."""
    try:
        hello = await remote_jason_manager.connect(
            url=req.url,
            token=req.token,
            session_key=req.session_key,
            cf_client_id=req.cf_client_id,
            cf_client_secret=req.cf_client_secret,
        )
        return {
            "ok": True,
            "message": "Connected to remote Jason",
            "protocol": hello.get("protocol"),
            "server": hello.get("server"),
        }
    except Exception as e:
        logger.error(f"Failed to connect to remote Jason: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/disconnect")
async def disconnect_remote():
    """Disconnect from the remote Jason instance."""
    await remote_jason_manager.disconnect()
    return {"ok": True, "message": "Disconnected"}


@router.get("/status")
async def get_remote_status():
    """Get the current remote connection status."""
    info = await remote_jason_manager.get_info()
    return info


@router.get("/files/read")
async def read_remote_file(path: str):
    """Read a file from the remote agent workspace."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")
    try:
        content = await client.read_file(path)
        return {"path": path, "content": content}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/files/write")
async def write_remote_file(req: dict):
    """Write a file to the remote agent workspace."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")
    path = req.get("path", "")
    content = req.get("content", "")
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    try:
        result = await client.write_file(path, content)
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/raw-history")
async def get_raw_remote_history(session_key: Optional[str] = None, last: int = 5):
    """Get raw (un-normalized) chat history for debugging."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")
    try:
        messages = await client.chat_history(session_key)
        return messages[-last:]  # Return last N raw messages
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/history")
async def get_remote_history(session_key: Optional[str] = None):
    """Get chat history from the remote Jason session."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        messages = await client.chat_history(session_key)
        # Normalize to our Message format
        normalized = []
        for msg in messages:
            role = msg.get("role", "assistant")
            content_parts = msg.get("content", [])
            # OpenClaw content is an array of {type, text} objects
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
                "name": "Remote Jason" if role != "user" else None,
                "content": text,
                "model": msg.get("model"),
                "provider": msg.get("provider"),
                "timestamp": msg.get("timestamp"),
            })
        return normalized
    except Exception as e:
        logger.error(f"Failed to get remote history: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/send")
async def send_to_remote(req: RemoteSendRequest):
    """Send a message to the remote Jason and get the response.

    - Messages containing @jason are forwarded to the remote OpenClaw Jason
      and also create Mission + Agent records in the local DB.
    - Messages without @jason are team chat — they are ignored by Jason.
    """
    from services.remote_orchestrator import is_jason_mention, handle_jason_mention

    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    # --- @jason mention → full orchestration ---
    if is_jason_mention(req.content):
        try:
            result = await handle_jason_mention(req.content, req.session_key)
            return result
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Remote Jason response timed out")
        except Exception as e:
            logger.error(f"Failed to process @jason task: {e}")
            raise HTTPException(status_code=502, detail=str(e))

    # --- No @jason mention → ignore (team chat, not for Jason) ---
    return {
        "role": "agent",
        "name": "System",
        "content": "💬 Message sent to team chat. Tag **@jason** to assign a task.\n\nExample: `@jason build a login page with email and password`",
    }


@router.post("/abort")
async def abort_remote():
    """Abort the current chat generation on the remote Jason."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")
    try:
        result = await client.chat_abort()
        return {"ok": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to abort remote generation: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/sessions")
async def get_remote_sessions():
    """List sessions on the remote Jason instance."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.get_sessions()
        sessions = result.get("sessions", [])
        return sessions
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/agents")
async def get_remote_agents():
    """List agents on the remote Jason instance."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.get_agents()
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/models")
async def get_remote_models():
    """List available models on the remote Jason instance."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.get_models()
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# --- Config ---

@router.get("/config")
async def get_remote_config():
    """Get the full OpenClaw configuration."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.get_config()
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/config")
async def set_remote_config(req: RemoteConfigSetRequest):
    """Set the full OpenClaw configuration. Requires hash from GET /config."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        import json
        raw = json.dumps(req.config)
        result = await client.set_config(raw, req.hash)
        return {"ok": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to set remote config: {e}")
        raise HTTPException(status_code=502, detail=str(e))


# --- Agent Creation ---

@router.post("/agents/create")
async def create_remote_agent(req: CreateAgentRequest):
    """Create a new OpenClaw agent by patching the gateway config.

    This adds the agent to agents.list[] and triggers a gateway restart.
    The new agent gets its own workspace, model, and identity.
    """
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.create_agent(
            agent_id=req.agent_id,
            name=req.name,
            model=req.model,
            workspace=req.workspace,
            identity=req.identity,
            sandbox=req.sandbox,
        )
        return {
            "ok": True,
            "message": f"Agent '{req.name}' created. Gateway is restarting.",
            "agent": result.get("agent"),
        }
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create remote agent: {e}")
        raise HTTPException(status_code=502, detail=str(e))


# --- Agent Files ---

@router.get("/agent-files")
async def list_remote_agent_files(agent_id: str = "main"):
    """List agent persona files on the remote instance."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.get_agent_files(agent_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/agent-files/{name}")
async def get_remote_agent_file(name: str, agent_id: str = "main"):
    """Get a single agent persona file's content."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.get_agent_file(name, agent_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/agent-files/{name}")
async def set_remote_agent_file(name: str, req: RemoteAgentFileSetRequest, agent_id: str = "main"):
    """Set a single agent persona file's content."""
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise HTTPException(status_code=503, detail="Not connected to remote Jason")

    try:
        result = await client.set_agent_file(name, req.content, agent_id)
        return {"ok": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to set agent file {name}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
