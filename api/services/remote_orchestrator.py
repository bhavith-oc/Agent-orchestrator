"""
Remote Orchestrator — bridges @jason mentions in remote chat to local
Mission Control and Agent Pool tracking.

Flow:
  1. User sends "@jason <task>" in remote chat
  2. This service detects the mention, strips it
  3. Creates a parent Mission in local DB (appears in Mission Control)
  4. Forwards the task to remote OpenClaw Jason
  5. Parses the response for sub-tasks
  6. Creates sub-Mission cards + Agent records (appear in Agent Pool)
  7. Updates mission status on completion

Non-@jason messages are ignored (not forwarded to OpenClaw).
"""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session
from models.agent import Agent
from models.mission import Mission, MissionDependency
from services.remote_jason import remote_jason_manager
from websocket.manager import ws_manager

logger = logging.getLogger(__name__)

# Regex to detect @jason mention (case-insensitive, at word boundary)
JASON_MENTION_RE = re.compile(r"@jason\b", re.IGNORECASE)

# Known agent role names that Jason spawns as sub-agents
KNOWN_AGENT_ROLES = {
    'researcher', 'qa', 'verifier', 'planner', 'coder', 'designer',
    'tester', 'reviewer', 'writer', 'analyst', 'architect', 'debugger',
    'documenter', 'editor', 'summarizer', 'validator', 'checker',
    'qa/verifier', 'code reviewer',
}

# Regex to find "Launched <Name> session" or "Spawn <Name> sub-agent"
LAUNCHED_RE = re.compile(
    r"(?:Launched|Spawned?|Started)\s+(\w+)\s+(?:session|sub[- ]?agent|worker)",
    re.IGNORECASE,
)

# Regex to find "Delegating to a researcher sub-agent" or "researcher sub-agent running"
DELEGATING_RE = re.compile(
    r"(?:delegat\w+\s+(?:to\s+)?(?:a\s+)?|\b)(\w+)\s+sub[- ]?agent",
    re.IGNORECASE,
)

# Regex to find agent names with roles in parentheses: "Researcher (core research)"
AGENT_WITH_ROLE_RE = re.compile(
    r"\b(\w+)\s*\(([^)]+)\)",
)

# Extract numbered plan steps for plan_json storage
PLAN_STEP_RE = re.compile(
    r"(?:^|\n)\s*(\d+)[\.\)]\s*(.*?)(?=\n\s*\d+[\.\)]|\n\n|\Z)",
    re.DOTALL,
)



def is_jason_mention(message: str) -> bool:
    """Check if a message contains @jason mention."""
    return bool(JASON_MENTION_RE.search(message))


def strip_jason_mention(message: str) -> str:
    """Remove @jason mention from message, returning the task text."""
    cleaned = JASON_MENTION_RE.sub("", message).strip()
    # Remove leading punctuation/whitespace left over
    cleaned = cleaned.lstrip(",: ").strip()
    return cleaned


def _is_known_agent(name: str) -> bool:
    """Check if a name matches a known agent role (case-insensitive)."""
    return name.lower().strip() in KNOWN_AGENT_ROLES


def extract_spawned_sessions(messages: list[dict]) -> list[dict]:
    """Extract actual sub-agent spawns from OpenClaw chat history messages.

    Looks for sessions_spawn tool outputs containing childSessionKey.
    Returns a list of {session_key, run_id} dicts.
    """
    spawns = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            text = "\n".join(
                p.get("text", "") for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            )
        elif isinstance(content, str):
            text = content
        else:
            continue

        # Look for sessions_spawn accepted responses
        if "childSessionKey" in text and "accepted" in text:
            try:
                data = json.loads(text)
                if data.get("status") == "accepted" and data.get("childSessionKey"):
                    spawns.append({
                        "session_key": data["childSessionKey"],
                        "run_id": data.get("runId", ""),
                    })
            except (json.JSONDecodeError, TypeError):
                pass
    return spawns


def extract_worker_agents(response_text: str, history_messages: list[dict] | None = None) -> list[dict]:
    """Extract actual worker sessions / sub-agents from Jason's response.

    Uses multiple strategies:
    1. Detect sessions_spawn tool outputs from chat history (most reliable)
    2. Detect "Launched/Spawn X session" patterns in LLM text
    3. Detect "delegating to a researcher sub-agent" patterns
    4. Known role names with parenthetical descriptions
    5. "Worker set:" line scanning

    Returns a list of {name, role, session_key?} dicts for the actual sub-agents.
    """
    agents = []
    seen_names: set[str] = set()
    spawn_count = 0

    # Strategy 0: Detect actual sessions_spawn from chat history (most reliable)
    if history_messages:
        spawns = extract_spawned_sessions(history_messages)
        spawn_count = len(spawns)
        logger.info(f"Detected {spawn_count} sessions_spawn in chat history")

    # Strategy 1: "Launched/Spawn Researcher session/sub-agent"
    for match in LAUNCHED_RE.finditer(response_text):
        name = match.group(1).strip()
        if _is_known_agent(name) and name not in seen_names:
            agents.append({"name": name, "role": name})
            seen_names.add(name)

    # Strategy 2: "Delegating to a researcher sub-agent"
    for match in DELEGATING_RE.finditer(response_text):
        name = match.group(1).strip()
        if _is_known_agent(name) and name not in seen_names:
            agents.append({"name": name, "role": name})
            seen_names.add(name)

    # Strategy 3: Known role names with parenthetical descriptions
    # e.g. "Researcher (main gather/summarize) + QA (verify accuracy)"
    for match in AGENT_WITH_ROLE_RE.finditer(response_text):
        name = match.group(1).strip()
        role = match.group(2).strip()
        if _is_known_agent(name) and name not in seen_names:
            agents.append({"name": name, "role": role})
            seen_names.add(name)

    # Strategy 4: Scan for "Worker set: 1 Researcher" or "Worker set: Researcher + QA"
    worker_set_re = re.compile(
        r"Worker\s+(?:session\s+)?set[^:]*:\s*(.*?)(?:\n|$)",
        re.IGNORECASE,
    )
    for match in worker_set_re.finditer(response_text):
        line = match.group(1).replace("**", "").replace("*", "").strip()
        parts = re.split(r'[+,;]', line)
        for part in parts:
            part = part.strip().strip('.')
            part = re.sub(r'^\d+\s+', '', part)
            word = part.split('(')[0].split()[0] if part.split() else ''
            if _is_known_agent(word) and word not in seen_names:
                role_match = re.search(r'\(([^)]+)\)', part)
                role = role_match.group(1).strip() if role_match else word
                agents.append({"name": word, "role": role})
                seen_names.add(word)

    # Strategy 5: If we detected spawns but no named agents from text,
    # create generic "Researcher" agents for each spawn
    if spawn_count > 0 and len(agents) == 0:
        for i, spawn in enumerate(spawns):
            name = "Researcher" if i == 0 else f"Worker-{i+1}"
            agents.append({"name": name, "role": name, "session_key": spawn["session_key"]})
            seen_names.add(name)
    elif spawn_count > len(agents):
        # More spawns than named agents — add extras
        for i in range(len(agents), spawn_count):
            name = f"Worker-{i+1}"
            agents.append({"name": name, "role": name, "session_key": spawns[i]["session_key"]})
            seen_names.add(name)

    # Attach session keys to named agents if available
    if history_messages and spawn_count > 0:
        spawns = extract_spawned_sessions(history_messages)
        for i, agent in enumerate(agents):
            if "session_key" not in agent and i < len(spawns):
                agent["session_key"] = spawns[i]["session_key"]

    return agents


def extract_plan_steps(response_text: str) -> list[dict]:
    """Extract numbered plan steps from Jason's response for plan_json storage.

    Returns a list of {step, text} dicts.
    """
    steps = []
    for match in PLAN_STEP_RE.finditer(response_text):
        step_num = match.group(1).strip()
        step_text = match.group(2).strip().rstrip('.')
        if step_text and len(step_text) > 3:
            steps.append({"step": int(step_num), "text": step_text})
    return steps


_COMPLEX_KEYWORDS = [
    "rest api", "flask", "django", "fastapi", "authentication", "database",
    "unit test", "separate module", "multiple file", "crud", "frontend",
    "backend", "full stack", "microservice", "docker", "deploy",
]


def _is_complex_task(task_text: str) -> bool:
    """Heuristic: detect tasks that benefit from sub-agent delegation."""
    lower = task_text.lower()
    hits = sum(1 for kw in _COMPLEX_KEYWORDS if kw in lower)
    # 2+ keyword hits or task is long (>200 chars) = complex
    return hits >= 2 or len(task_text) > 200


def _build_delegation_prompt(task_text: str) -> str:
    """Prepend delegation instructions for complex tasks.

    For simple tasks (<2 complexity keywords, <200 chars), returns task as-is.
    For complex tasks, prepends instructions to use sessions_spawn.
    """
    if not _is_complex_task(task_text):
        return task_text

    return (
        "IMPORTANT: This is a complex multi-part task. You MUST delegate using "
        "sessions_spawn to create sub-agents for parallel work. Do NOT write all "
        "the code yourself in one turn.\n\n"
        "Steps:\n"
        "1. Plan the task breakdown (which sub-agents to spawn)\n"
        "2. Use sessions_spawn for each sub-agent with a clear task description\n"
        "3. Report your delegation plan and STOP\n\n"
        f"Task: {task_text}"
    )


def normalize_openclaw_content(content) -> str:
    """Normalize OpenClaw content (array of {type, text} or string) to plain text."""
    if isinstance(content, list):
        return "\n".join(
            part.get("text", "") for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    elif isinstance(content, str):
        return content
    return str(content)


async def get_or_create_jason(db: AsyncSession) -> Agent:
    """Ensure the Jason master agent exists in the DB."""
    result = await db.execute(
        select(Agent).where(Agent.type == "master", Agent.name == "Jason")
    )
    jason = result.scalar_one_or_none()
    if not jason:
        jason = Agent(
            name="Jason",
            type="master",
            status="active",
            current_task="Awaiting commands",
        )
        db.add(jason)
        await db.commit()
        await db.refresh(jason)
    return jason


async def handle_jason_mention(message: str, session_key: Optional[str] = None) -> dict:
    """Orchestration flow for an @jason mention in remote chat.

    1. Creates a Mission in the local DB (appears in Mission Control).
    2. Sends the task to remote OpenClaw Jason.
    3. Returns Jason's first LLM response (plan/acknowledgment) immediately.
    4. Kicks off a background task that monitors the remote history for the
       final response, then creates sub-tasks and agents in the local DB.
    """
    client = remote_jason_manager.client
    if not client or not client.connected:
        raise RuntimeError("Not connected to remote Jason")

    task_text = strip_jason_mention(message)
    if not task_text:
        return {
            "role": "agent",
            "name": "Remote Jason",
            "content": "Please provide a task after @jason. Example: `@jason build a login page`",
        }

    async with async_session() as db:
        jason = await get_or_create_jason(db)

        # --- Step 1: Create parent Mission (Queue until agents start) ---
        parent_mission = Mission(
            title=task_text[:120],
            description=task_text,
            status="Queue",
            priority="General",
            assigned_agent_id=jason.id,
        )
        db.add(parent_mission)
        await db.commit()
        await db.refresh(parent_mission)

        mission_id = parent_mission.id
        jason_id = jason.id

        logger.info(f"Created mission {mission_id}: {parent_mission.title}")

        await ws_manager.broadcast_all("mission:created", {
            "mission_id": mission_id,
            "title": parent_mission.title,
            "status": "Queue",
        })

        jason.status = "busy"
        jason.current_task = f"Processing: {task_text[:60]}"
        await db.commit()

        await ws_manager.broadcast_all("agent:status", {
            "agent_id": jason_id, "status": "busy", "task": jason.current_task
        })

    # --- Step 1b: Snapshot spawn count BEFORE sending (to detect only new spawns) ---
    try:
        pre_history = await client.chat_history(session_key)
        baseline_spawn_count = len(extract_spawned_sessions(pre_history))
    except Exception:
        baseline_spawn_count = 0

    # --- Step 1c: For complex tasks, prepend delegation instructions ---
    # This encourages the model to use sessions_spawn for multi-file work
    send_text = _build_delegation_prompt(task_text)

    # --- Step 2: Send to remote OpenClaw Jason and get first response ---
    try:
        response_msg = await client.chat_send(send_text, session_key)
        response_text = normalize_openclaw_content(response_msg.get("content", ""))
    except Exception as e:
        logger.error(f"Remote Jason failed: {e}")
        async with async_session() as db:
            mission = await db.get(Mission, mission_id)
            if mission:
                mission.status = "Failed"
                await db.commit()
            jason = await get_or_create_jason(db)
            jason.status = "active"
            jason.current_task = "Awaiting commands"
            await db.commit()
        await ws_manager.broadcast_all("mission:updated", {
            "mission_id": mission_id, "status": "Failed"
        })
        raise

    # --- Step 2b: Fetch chat history to detect NEW sessions_spawn tool outputs ---
    try:
        history_messages = await client.chat_history(session_key)
    except Exception:
        history_messages = []

    # --- Step 3: Parse first response for sub-tasks, create records ---
    subtasks_info = await _create_subtask_records(
        mission_id, jason_id, task_text, response_text, response_msg,
        history_messages=history_messages,
        baseline_spawn_count=baseline_spawn_count,
    )

    # --- Step 3b: Move parent mission to Active (agents are now working) ---
    async with async_session() as db:
        mission = await db.get(Mission, mission_id)
        if mission and mission.status == "Queue":
            mission.status = "Active"
            mission.started_at = datetime.utcnow()
            await db.commit()
            await ws_manager.broadcast_all("mission:updated", {
                "mission_id": mission_id, "status": "Active"
            })
            logger.info(f"Mission {mission_id} moved to Active Operations")

    # --- Step 4: Kick off background monitor for final completion ---
    asyncio.create_task(
        _monitor_remote_completion(mission_id, jason_id, session_key)
    )

    return {
        "role": "agent",
        "name": "Remote Jason",
        "content": response_text or "Task received — Jason is working on it.",
        "model": response_msg.get("model"),
        "provider": response_msg.get("provider"),
        "mission_id": mission_id,
        "subtasks": subtasks_info,
    }


async def _create_subtask_records(
    mission_id: str,
    jason_id: str,
    task_text: str,
    response_text: str,
    response_msg: dict,
    history_messages: list[dict] | None = None,
    baseline_spawn_count: int = 0,
) -> list[dict]:
    """Parse the response for actual worker agents and create Mission + Agent records.

    Extracts real sub-agents from Jason's response using:
    - sessions_spawn tool outputs from chat history (most reliable)
    - Text patterns like "Launched Researcher session", "delegating to researcher sub-agent"
    - Whitelist of known agent role names
    """
    subtasks_info = []
    async with async_session() as db:
        # Extract actual worker agents (Researcher, QA, etc.)
        # Only pass NEW history messages (after baseline) to avoid counting old spawns
        new_history = None
        if history_messages:
            all_spawns = extract_spawned_sessions(history_messages)
            new_spawns = all_spawns[baseline_spawn_count:]
            if new_spawns:
                # Build a minimal history with just the new spawn messages
                new_history = [
                    {"content": json.dumps({"status": "accepted", "childSessionKey": s["session_key"], "runId": s["run_id"]})}
                    for s in new_spawns
                ]
                logger.info(f"New spawns since request: {len(new_spawns)} (baseline was {baseline_spawn_count})")

        worker_agents = extract_worker_agents(response_text, history_messages=new_history)
        # Extract plan steps for storage
        plan_steps = extract_plan_steps(response_text)

        # Store the full plan in parent mission
        mission = await db.get(Mission, mission_id)
        if mission:
            mission.plan_json = json.dumps({
                "plan_summary": task_text[:120],
                "steps": plan_steps,
                "workers": [w["name"] for w in worker_agents],
            })
            await db.commit()

        if worker_agents:
            for wa in worker_agents:
                # Use role if it differs from name, otherwise use parent task for context
                role_desc = wa["role"] if wa["role"] != wa["name"] else task_text[:80]
                display_title = f"{wa['name']}: {role_desc[:80]}"

                # Create sub-mission for this worker (Active — agent is working)
                sub_mission = Mission(
                    title=display_title,
                    description=f"Sub-agent {wa['name']} — {role_desc}",
                    status="Active",
                    priority="General",
                    parent_mission_id=mission_id,
                    started_at=datetime.utcnow(),
                )
                db.add(sub_mission)
                await db.commit()
                await db.refresh(sub_mission)

                # Create agent with the actual name Jason assigned
                sub_agent = Agent(
                    name=wa["name"],
                    type="sub",
                    status="busy",
                    parent_agent_id=jason_id,
                    model=response_msg.get("model", "remote"),
                    current_task=role_desc[:120],
                    load=50.0,
                )
                db.add(sub_agent)
                await db.commit()
                await db.refresh(sub_agent)

                sub_mission.assigned_agent_id = sub_agent.id
                await db.commit()

                subtasks_info.append({
                    "mission_id": sub_mission.id,
                    "agent_id": sub_agent.id,
                    "agent_name": wa["name"],
                    "title": role_desc,
                })

                await ws_manager.broadcast_all("agent:spawned", {
                    "agent_id": sub_agent.id,
                    "name": wa["name"],
                    "task": role_desc,
                })

            logger.info(
                f"Created {len(subtasks_info)} worker agents for mission {mission_id}: "
                f"{[w['name'] for w in worker_agents]}"
            )

    return subtasks_info


async def _monitor_remote_completion(
    mission_id: str, jason_id: str, session_key: Optional[str] = None
):
    """Background task: poll remote history until Jason finishes, then
    mark the mission and sub-tasks as completed."""
    import time

    client = remote_jason_manager.client
    if not client or not client.connected:
        return

    # Snapshot current LLM message count
    try:
        messages = await client.chat_history(session_key)
        baseline_count = client._count_llm_messages(messages)
    except Exception:
        baseline_count = 0

    # Poll for additional LLM responses (Jason's final summary after sub-tasks)
    deadline = time.monotonic() + 300  # 5 minute max
    poll_interval = 5.0
    last_count = baseline_count

    while time.monotonic() < deadline:
        await asyncio.sleep(poll_interval)

        try:
            messages = await client.chat_history(session_key)
            current_count = client._count_llm_messages(messages)
        except Exception:
            continue

        if current_count > last_count:
            last_count = current_count
            # Reset deadline — Jason is still active
            deadline = time.monotonic() + 60
            poll_interval = 5.0
            continue

        # No new messages for one poll cycle — Jason may be done
        # Wait one more cycle to confirm
        await asyncio.sleep(poll_interval)
        try:
            messages = await client.chat_history(session_key)
            final_count = client._count_llm_messages(messages)
        except Exception:
            break

        if final_count == current_count:
            # Stable — Jason is done
            break
        else:
            last_count = final_count
            deadline = time.monotonic() + 60
            continue

    # --- Mark everything as completed ---
    async with async_session() as db:
        mission = await db.get(Mission, mission_id)
        if mission and mission.status == "Active":
            mission.status = "Completed"
            mission.completed_at = datetime.utcnow()
            await db.commit()

            await ws_manager.broadcast_all("mission:updated", {
                "mission_id": mission_id, "status": "Completed"
            })

        # Complete sub-missions and their agents
        from sqlalchemy import select as sa_select
        result = await db.execute(
            sa_select(Mission).where(Mission.parent_mission_id == mission_id)
        )
        sub_missions = result.scalars().all()
        for sm in sub_missions:
            if sm.status != "Completed":
                sm.status = "Completed"
                sm.completed_at = datetime.utcnow()
            if sm.assigned_agent_id:
                agent = await db.get(Agent, sm.assigned_agent_id)
                if agent and agent.status != "completed":
                    agent.status = "completed"
                    agent.load = 0.0
                    agent.terminated_at = datetime.utcnow()
        await db.commit()

        # Reset Jason
        jason = await get_or_create_jason(db)
        jason.status = "active"
        jason.current_task = "Awaiting commands"
        await db.commit()

        await ws_manager.broadcast_all("agent:status", {
            "agent_id": jason_id, "status": "active", "task": "Awaiting commands"
        })

    logger.info(f"Mission {mission_id} monitoring complete — marked as Completed")
