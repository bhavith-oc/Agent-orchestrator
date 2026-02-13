"""
Orchestrator Service — Jason Master → Sub-Agent Container Orchestration

This is the core of Phase 1 architecture. The orchestrator:
1. Receives a coding task from the user
2. Sends it to the Jason master container for task decomposition
3. Jason returns a plan with subtasks and required agent types
4. The orchestrator creates/reuses expert agent containers via the deployer
5. Sends each subtask to the appropriate expert agent container
6. Collects results and feeds them back to Jason for synthesis
7. Returns the final synthesized response

Architecture:
    User → API → Orchestrator → Jason Master (task plan)
                              → Expert Containers (subtask execution)
                              → Jason Master (synthesis)
                              → User (final response)
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Callable, Awaitable

from services.deployer import deployer
from services.deployment_chat import DeploymentChatManager
from services.llm_client import llm_client
from services.agent_templates import get_template, list_templates, match_template
from services.team_chat import team_chat
from websocket.manager import ws_manager
from config import settings

logger = logging.getLogger(__name__)


# ── Task Status ──────────────────────────────────────────────────

class TaskStatus(str, Enum):
    PENDING = "pending"
    PLANNING = "planning"
    EXECUTING = "executing"
    SYNTHESIZING = "synthesizing"
    COMPLETED = "completed"
    FAILED = "failed"


class SubtaskStatus(str, Enum):
    PENDING = "pending"
    CREATING_AGENT = "creating_agent"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Data Structures ──────────────────────────────────────────────

class Subtask:
    def __init__(self, id: str, description: str, agent_type: str, depends_on: list[str] = None):
        self.id = id
        self.description = description
        self.agent_type = agent_type
        self.depends_on = depends_on or []
        self.status = SubtaskStatus.PENDING
        self.result: Optional[str] = None
        self.error: Optional[str] = None
        self.deployment_id: Optional[str] = None
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "description": self.description,
            "agent_type": self.agent_type,
            "depends_on": self.depends_on,
            "status": self.status.value,
            "result": self.result,
            "error": self.error,
            "deployment_id": self.deployment_id,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class OrchestratorTask:
    def __init__(self, id: str, description: str, master_deployment_id: str,
                 mission_id: Optional[str] = None):
        self.id = id
        self.description = description
        self.master_deployment_id = master_deployment_id
        self.mission_id = mission_id  # Parent mission on Kanban board
        self.status = TaskStatus.PENDING
        self.subtasks: list[Subtask] = []
        self.plan: Optional[dict] = None
        self.final_result: Optional[str] = None
        self.error: Optional[str] = None
        self.logs: list[str] = []
        self.created_at = datetime.now(timezone.utc)
        self.completed_at: Optional[datetime] = None
        # Callback for when the task completes (used by TelegramBridge)
        self.on_complete: Optional[Callable[["OrchestratorTask"], Awaitable[None]]] = None

    def add_log(self, message: str, level: str = "INFO"):
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.logs.append(f"[{ts}] [{level}] {message}")
        logger.info(f"[Task {self.id[:8]}] {message}")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "description": self.description,
            "status": self.status.value,
            "master_deployment_id": self.master_deployment_id,
            "mission_id": self.mission_id,
            "subtasks": [s.to_dict() for s in self.subtasks],
            "plan": self.plan,
            "final_result": self.final_result,
            "error": self.error,
            "logs": self.logs[-50:],
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


# ── Orchestrator ─────────────────────────────────────────────────

PLANNING_SYSTEM_PROMPT = """You are Jason, the master AI orchestrator. You manage a team of expert AI agents.

When given a coding task, you must:
1. Analyze the task and break it into subtasks
2. For each subtask, specify which type of expert agent should handle it
3. Identify dependencies between subtasks (which must complete before others can start)

Available agent types:
{agent_types}

Respond with a JSON object in this exact format:
{{
    "analysis": "Brief analysis of the task",
    "subtasks": [
        {{
            "id": "subtask-1",
            "description": "Detailed description of what this subtask should accomplish, including specific requirements and expected output",
            "agent_type": "python-backend",
            "depends_on": []
        }},
        {{
            "id": "subtask-2",
            "description": "Detailed description...",
            "agent_type": "react-frontend",
            "depends_on": ["subtask-1"]
        }}
    ]
}}

Rules:
- Each subtask must be self-contained enough for an expert agent to execute independently
- Use depends_on to specify ordering when a subtask needs results from another
- Choose the most specific agent type for each subtask
- Keep subtasks focused — prefer more smaller subtasks over fewer large ones
- Include enough detail in each description that the expert agent can work without additional context
"""

REVIEW_SYSTEM_PROMPT = """You are Jason, the master AI orchestrator. A sub-agent has completed a subtask and you must review its output.

Original task: {task_description}
Subtask: {subtask_description}
Agent type: {agent_type}

Sub-agent output:
{agent_output}

Review the output and respond with a JSON object:
{{
    "verdict": "approved" or "changes_requested",
    "summary": "Brief summary of what the agent accomplished",
    "feedback": "If changes_requested, explain what needs to be fixed. If approved, leave empty."
}}

Approve if the output is reasonable and addresses the subtask. Request changes only for significant issues."""

SYNTHESIS_SYSTEM_PROMPT = """You are Jason, the master AI orchestrator. You delegated subtasks to expert agents and now have their results.

Your job is to:
1. Review all subtask results
2. Synthesize them into a coherent, complete response
3. Identify any issues or conflicts between results
4. Provide the final integrated solution

Original task: {task_description}

Subtask results:
{subtask_results}

Provide a clear, well-organized final response that integrates all the expert agents' work. If there are conflicts or issues, note them and provide your recommended resolution."""


class Orchestrator:
    """Manages the lifecycle of orchestrated coding tasks.

    Supports two execution modes:
    - Container-based: deploys OpenClaw containers for sub-agents (primary)
    - LLM-based: uses LLM client directly with expert prompts (fallback)
    """

    def __init__(self):
        self._tasks: dict[str, OrchestratorTask] = {}
        self._agent_connections: dict[str, DeploymentChatManager] = {}

    # ── Public API ───────────────────────────────────────────────

    async def submit_task(
        self,
        description: str,
        master_deployment_id: str,
        mission_id: Optional[str] = None,
        on_complete: Optional[Callable[["OrchestratorTask"], Awaitable[None]]] = None,
    ) -> OrchestratorTask:
        """Submit a new coding task for orchestration."""
        task_id = str(uuid.uuid4())
        task = OrchestratorTask(
            id=task_id,
            description=description,
            master_deployment_id=master_deployment_id,
            mission_id=mission_id,
        )
        task.on_complete = on_complete
        self._tasks[task_id] = task
        task.add_log(f"Task created: {description[:100]}...")
        task.add_log(f"Master container: {master_deployment_id}")

        # Start orchestration in background
        asyncio.create_task(self._orchestrate(task))

        return task

    def get_task(self, task_id: str) -> Optional[OrchestratorTask]:
        return self._tasks.get(task_id)

    def list_tasks(self) -> list[dict]:
        return [t.to_dict() for t in self._tasks.values()]

    def get_available_agents(self) -> list[dict]:
        return list_templates()

    # ── Orchestration Pipeline ───────────────────────────────────

    async def _orchestrate(self, task: OrchestratorTask):
        """Main orchestration pipeline — runs in background."""
        try:
            mission_id = task.mission_id

            # Phase 1: Planning
            task.status = TaskStatus.PLANNING
            task.add_log("Phase 1: Task decomposition...")
            if mission_id:
                await team_chat.post_message(
                    mission_id, "Jason",
                    f"📋 Received task: {task.description[:200]}\n\nPlanning subtasks...",
                    role="system",
                )

            plan = await self._get_task_plan(task)
            task.plan = plan
            task.add_log(f"Plan received: {len(plan.get('subtasks', []))} subtasks")

            # Create Subtask objects
            for st_data in plan.get("subtasks", []):
                subtask = Subtask(
                    id=st_data["id"],
                    description=st_data["description"],
                    agent_type=st_data.get("agent_type", "fullstack"),
                    depends_on=st_data.get("depends_on", []),
                )
                task.subtasks.append(subtask)
                task.add_log(f"  Subtask [{subtask.id}]: {subtask.agent_type} — {subtask.description[:80]}...")

            if not task.subtasks:
                task.add_log("No subtasks generated — executing as single task", "WARN")
                task.subtasks.append(Subtask(
                    id="subtask-1",
                    description=task.description,
                    agent_type=match_template(task.description),
                ))

            # Post plan to team chat
            if mission_id:
                plan_summary = plan.get("analysis", "")
                subtask_list = "\n".join(
                    f"  • `{st.id}` ({st.agent_type}): {st.description[:80]}"
                    for st in task.subtasks
                )
                await team_chat.post_message(
                    mission_id, "Jason",
                    f"**Plan ready** — {len(task.subtasks)} subtask(s)\n\n"
                    f"{plan_summary}\n\n{subtask_list}",
                )

            # Broadcast mission update
            if mission_id:
                await ws_manager.broadcast_all("mission:updated", {
                    "mission_id": mission_id, "status": "Active",
                })

            # Phase 2: Execution
            task.status = TaskStatus.EXECUTING
            task.add_log("Phase 2: Executing subtasks...")
            await self._execute_subtasks(task)

            # Phase 3: Synthesis
            task.status = TaskStatus.SYNTHESIZING
            task.add_log("Phase 3: Synthesizing results...")
            if mission_id:
                await team_chat.post_message(
                    mission_id, "Jason",
                    "All subtasks complete. Synthesizing final result...",
                )

            final_result = await self._synthesize_results(task)
            task.final_result = final_result

            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now(timezone.utc)
            task.add_log("Task completed successfully ✓")

            # Post final result to team chat
            if mission_id:
                await team_chat.post_message(
                    mission_id, "Jason",
                    f"✅ **Task completed**\n\n{final_result[:500]}",
                )
                await ws_manager.broadcast_all("mission:updated", {
                    "mission_id": mission_id, "status": "Completed",
                })

            # Fire completion callback (used by TelegramBridge)
            if task.on_complete:
                try:
                    await task.on_complete(task)
                except Exception as cb_err:
                    logger.warning(f"on_complete callback failed: {cb_err}")

        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.completed_at = datetime.now(timezone.utc)
            task.add_log(f"Task failed: {e}", "ERROR")
            logger.exception(f"Orchestration failed for task {task.id}")

            if task.mission_id:
                await team_chat.post_message(
                    task.mission_id, "Jason",
                    f"❌ **Task failed**: {e}",
                    role="system",
                )
                await ws_manager.broadcast_all("mission:updated", {
                    "mission_id": task.mission_id, "status": "Failed",
                })

    async def _get_task_plan(self, task: OrchestratorTask) -> dict:
        """Ask Jason (via LLM) to decompose the task into subtasks.

        Uses the LLM client directly with the planning system prompt.
        This avoids needing a WebSocket connection to the master container
        for the planning phase — the master container is used for synthesis.
        """
        templates = list_templates()
        agent_types_str = "\n".join(
            f"- {t['type']}: {t['description']}"
            for t in templates
        )

        system_prompt = PLANNING_SYSTEM_PROMPT.format(agent_types=agent_types_str)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Task: {task.description}"},
        ]

        try:
            plan = await llm_client.chat_json(
                model=settings.JASON_MODEL,
                messages=messages,
                temperature=0.3,
                max_tokens=4096,
            )
            return plan
        except Exception as e:
            task.add_log(f"LLM planning failed: {e}", "ERROR")
            # Fallback: single subtask with best-match template
            return {
                "analysis": f"Planning failed ({e}), executing as single task",
                "subtasks": [{
                    "id": "subtask-1",
                    "description": task.description,
                    "agent_type": match_template(task.description),
                    "depends_on": [],
                }],
            }

    async def _execute_subtasks(self, task: OrchestratorTask):
        """Execute subtasks respecting dependency ordering.

        Subtasks with no unmet dependencies are executed in parallel.
        Tries container-based execution first, falls back to LLM.
        """
        completed_ids: set[str] = set()
        max_iterations = len(task.subtasks) + 5

        for iteration in range(max_iterations):
            ready = [
                st for st in task.subtasks
                if st.status == SubtaskStatus.PENDING
                and all(dep in completed_ids for dep in st.depends_on)
            ]

            if not ready:
                if all(st.status in (SubtaskStatus.COMPLETED, SubtaskStatus.FAILED) for st in task.subtasks):
                    break
                await asyncio.sleep(1)
                continue

            task.add_log(f"Executing {len(ready)} subtask(s) in parallel...")

            results = await asyncio.gather(
                *(self._execute_single_subtask(task, st) for st in ready),
                return_exceptions=True,
            )

            for st, result in zip(ready, results):
                if isinstance(result, Exception):
                    st.status = SubtaskStatus.FAILED
                    st.error = str(result)
                    task.add_log(f"  Subtask [{st.id}] failed: {result}", "ERROR")
                    if task.mission_id:
                        await team_chat.post_message(
                            task.mission_id, st.agent_type,
                            f"❌ Subtask `{st.id}` failed: {result}",
                            role="system",
                        )
                else:
                    completed_ids.add(st.id)

    async def _execute_single_subtask(self, task: OrchestratorTask, subtask: Subtask):
        """Execute a single subtask.

        Primary: try container-based execution via deployed OpenClaw container.
        Fallback: use LLM client directly with expert system prompt.
        After execution, Jason reviews the output.
        """
        subtask.status = SubtaskStatus.EXECUTING
        subtask.started_at = datetime.now(timezone.utc)
        agent_name = f"{subtask.agent_type}-{subtask.id}"
        task.add_log(f"  Subtask [{subtask.id}] executing via {subtask.agent_type}...")

        if task.mission_id:
            await team_chat.post_message(
                task.mission_id, agent_name,
                f"Starting work on: {subtask.description[:150]}",
            )

        # Build context from completed dependency results
        context_parts = []
        for dep_id in subtask.depends_on:
            dep = next((s for s in task.subtasks if s.id == dep_id), None)
            if dep and dep.result:
                context_parts.append(f"Result from [{dep_id}] ({dep.agent_type}):\n{dep.result}")

        user_message = subtask.description
        if context_parts:
            user_message = (
                "Context from previous subtasks:\n"
                + "\n---\n".join(context_parts)
                + f"\n\n---\nYour task:\n{subtask.description}"
            )

        # Try container-based execution first
        result_text = None
        try:
            result_text = await self._execute_via_container(task, subtask, user_message)
        except Exception as container_err:
            task.add_log(f"  Container execution failed for [{subtask.id}], falling back to LLM: {container_err}", "WARN")

        # Fallback to LLM-based execution
        if result_text is None:
            result_text = await self._execute_via_llm(task, subtask, user_message)

        subtask.result = result_text

        # Post result to team chat
        if task.mission_id:
            preview = result_text[:300] if result_text else "No output"
            await team_chat.post_message(
                task.mission_id, agent_name,
                f"Completed subtask `{subtask.id}`:\n\n{preview}",
            )

        # Jason review loop
        review = await self._review_subtask(task, subtask)
        if review.get("verdict") == "approved":
            subtask.status = SubtaskStatus.COMPLETED
            subtask.completed_at = datetime.now(timezone.utc)
            task.add_log(f"  Subtask [{subtask.id}] approved ✓ — {review.get('summary', '')[:80]}")
            if task.mission_id:
                await team_chat.post_message(
                    task.mission_id, "Jason",
                    f"✅ Approved `{subtask.id}`: {review.get('summary', '')}",
                )
        else:
            # Changes requested — for now, mark as completed with feedback noted
            # Future: re-execute with feedback
            feedback = review.get("feedback", "")
            task.add_log(f"  Subtask [{subtask.id}] review: changes requested — {feedback[:80]}", "WARN")
            if task.mission_id:
                await team_chat.post_message(
                    task.mission_id, "Jason",
                    f"⚠️ Review for `{subtask.id}`: {feedback}\n\n_Accepting with notes for now._",
                )
            subtask.status = SubtaskStatus.COMPLETED
            subtask.completed_at = datetime.now(timezone.utc)

    async def _execute_via_container(
        self, task: OrchestratorTask, subtask: Subtask, user_message: str
    ) -> str:
        """Execute a subtask by sending it to a deployed OpenClaw container."""
        # Find an idle container or use the master's deployment
        deployment_id = task.master_deployment_id
        subtask.deployment_id = deployment_id
        task.add_log(f"  Subtask [{subtask.id}] connecting to container {deployment_id[:8]}...")

        if deployment_id not in self._agent_connections:
            mgr = DeploymentChatManager()
            self._agent_connections[deployment_id] = mgr

        mgr = self._agent_connections[deployment_id]

        if not mgr.is_connected:
            await mgr.connect(deployment_id)

        # Prepend expert context to the message
        template = get_template(subtask.agent_type) or get_template("fullstack")
        expert_prefix = (
            f"You are acting as a {template['name']}. {template['description']}\n\n"
            f"Task:\n{user_message}"
        )

        response = await mgr.send_message(expert_prefix)
        return response.get("content", "")

    async def _execute_via_llm(
        self, task: OrchestratorTask, subtask: Subtask, user_message: str
    ) -> str:
        """Fallback: execute a subtask using LLM client directly."""
        template = get_template(subtask.agent_type) or get_template("fullstack")
        system_prompt = template["system_prompt"]

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        result = await llm_client.chat(
            model=settings.SUB_AGENT_MODEL,
            messages=messages,
            temperature=float(settings.SUB_AGENT_TEMPERATURE),
            max_tokens=int(settings.SUB_AGENT_MAX_TOKENS),
        )
        return result

    async def _review_subtask(self, task: OrchestratorTask, subtask: Subtask) -> dict:
        """Jason reviews a sub-agent's output and approves or requests changes."""
        subtask.status = SubtaskStatus.REVIEWING
        task.add_log(f"  Subtask [{subtask.id}] under review by Jason...")

        prompt = REVIEW_SYSTEM_PROMPT.format(
            task_description=task.description,
            subtask_description=subtask.description,
            agent_type=subtask.agent_type,
            agent_output=(subtask.result or "")[:3000],
        )

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": "Review the sub-agent's output."},
        ]

        try:
            review = await llm_client.chat_json(
                model=settings.JASON_MODEL,
                messages=messages,
                temperature=0.2,
                max_tokens=1024,
            )
            return review
        except Exception as e:
            task.add_log(f"  Review failed for [{subtask.id}]: {e}", "WARN")
            return {"verdict": "approved", "summary": "Auto-approved (review failed)", "feedback": ""}

    async def _synthesize_results(self, task: OrchestratorTask) -> str:
        """Ask Jason (via LLM) to synthesize all subtask results."""
        subtask_results = []
        for st in task.subtasks:
            status = "completed" if st.status == SubtaskStatus.COMPLETED else "failed"
            result_text = st.result or st.error or "No output"
            subtask_results.append(
                f"[{st.id}] ({st.agent_type}, {status}):\n{result_text}"
            )

        system_prompt = SYNTHESIS_SYSTEM_PROMPT.format(
            task_description=task.description,
            subtask_results="\n\n---\n\n".join(subtask_results),
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Please synthesize the results from all expert agents into a final, integrated response."},
        ]

        try:
            result = await llm_client.chat(
                model=settings.JASON_MODEL,
                messages=messages,
                temperature=0.3,
                max_tokens=8192,
            )
            return result
        except Exception as e:
            task.add_log(f"Synthesis failed: {e}", "ERROR")
            # Fallback: concatenate results
            return "\n\n---\n\n".join(
                f"## {st.agent_type}: {st.description}\n\n{st.result or st.error or 'No output'}"
                for st in task.subtasks
            )

    # ── Cleanup ──────────────────────────────────────────────────

    async def cleanup_connections(self):
        """Disconnect all agent connections."""
        for deployment_id, mgr in self._agent_connections.items():
            try:
                await mgr.disconnect()
            except Exception as e:
                logger.warning(f"Failed to disconnect agent {deployment_id}: {e}")
        self._agent_connections.clear()


# Singleton
orchestrator = Orchestrator()
