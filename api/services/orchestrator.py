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
from typing import Optional

from services.deployer import deployer
from services.deployment_chat import DeploymentChatManager
from services.llm_client import llm_client
from services.agent_templates import get_template, list_templates, match_template
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
    def __init__(self, id: str, description: str, master_deployment_id: str):
        self.id = id
        self.description = description
        self.master_deployment_id = master_deployment_id
        self.status = TaskStatus.PENDING
        self.subtasks: list[Subtask] = []
        self.plan: Optional[dict] = None
        self.final_result: Optional[str] = None
        self.error: Optional[str] = None
        self.logs: list[str] = []
        self.created_at = datetime.now(timezone.utc)
        self.completed_at: Optional[datetime] = None

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
            "subtasks": [s.to_dict() for s in self.subtasks],
            "plan": self.plan,
            "final_result": self.final_result,
            "error": self.error,
            "logs": self.logs[-50:],  # Last 50 log lines
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
    """Manages the lifecycle of orchestrated coding tasks."""

    def __init__(self):
        self._tasks: dict[str, OrchestratorTask] = {}
        # Pool of chat managers for sub-agent connections (keyed by deployment_id)
        self._agent_connections: dict[str, DeploymentChatManager] = {}

    # ── Public API ───────────────────────────────────────────────

    async def submit_task(
        self,
        description: str,
        master_deployment_id: str,
    ) -> OrchestratorTask:
        """Submit a new coding task for orchestration.

        Args:
            description: The coding task description
            master_deployment_id: The deployment ID of the Jason master container

        Returns:
            The created OrchestratorTask
        """
        task_id = str(uuid.uuid4())
        task = OrchestratorTask(
            id=task_id,
            description=description,
            master_deployment_id=master_deployment_id,
        )
        self._tasks[task_id] = task
        task.add_log(f"Task created: {description[:100]}...")
        task.add_log(f"Master container: {master_deployment_id}")

        # Start orchestration in background
        asyncio.create_task(self._orchestrate(task))

        return task

    def get_task(self, task_id: str) -> Optional[OrchestratorTask]:
        """Get a task by ID."""
        return self._tasks.get(task_id)

    def list_tasks(self) -> list[dict]:
        """List all tasks with their status."""
        return [t.to_dict() for t in self._tasks.values()]

    def get_available_agents(self) -> list[dict]:
        """List available agent templates."""
        return list_templates()

    # ── Orchestration Pipeline ───────────────────────────────────

    async def _orchestrate(self, task: OrchestratorTask):
        """Main orchestration pipeline — runs in background."""
        try:
            # Phase 1: Planning — ask Jason to decompose the task
            task.status = TaskStatus.PLANNING
            task.add_log("Phase 1: Task decomposition (asking Jason for a plan)...")
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

            # Phase 2: Execution — create/reuse agents and execute subtasks
            task.status = TaskStatus.EXECUTING
            task.add_log("Phase 2: Executing subtasks...")
            await self._execute_subtasks(task)

            # Phase 3: Synthesis — ask Jason to combine results
            task.status = TaskStatus.SYNTHESIZING
            task.add_log("Phase 3: Synthesizing results (asking Jason to integrate)...")
            final_result = await self._synthesize_results(task)
            task.final_result = final_result

            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now(timezone.utc)
            task.add_log("Task completed successfully ✓")

        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.completed_at = datetime.now(timezone.utc)
            task.add_log(f"Task failed: {e}", "ERROR")
            logger.exception(f"Orchestration failed for task {task.id}")

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
        """
        completed_ids: set[str] = set()
        max_iterations = len(task.subtasks) + 5  # Safety limit

        for iteration in range(max_iterations):
            # Find subtasks ready to execute (all deps completed)
            ready = [
                st for st in task.subtasks
                if st.status == SubtaskStatus.PENDING
                and all(dep in completed_ids for dep in st.depends_on)
            ]

            if not ready:
                # Check if all done
                if all(st.status in (SubtaskStatus.COMPLETED, SubtaskStatus.FAILED) for st in task.subtasks):
                    break
                # Still waiting for deps
                await asyncio.sleep(1)
                continue

            task.add_log(f"Executing {len(ready)} subtask(s) in parallel...")

            # Execute ready subtasks in parallel
            results = await asyncio.gather(
                *(self._execute_single_subtask(task, st) for st in ready),
                return_exceptions=True,
            )

            for st, result in zip(ready, results):
                if isinstance(result, Exception):
                    st.status = SubtaskStatus.FAILED
                    st.error = str(result)
                    task.add_log(f"  Subtask [{st.id}] failed: {result}", "ERROR")
                else:
                    completed_ids.add(st.id)

    async def _execute_single_subtask(self, task: OrchestratorTask, subtask: Subtask):
        """Execute a single subtask using an expert agent container.

        For Phase 1, we use the LLM client directly with the agent's system prompt
        rather than spinning up a new container for each subtask. This is faster
        and more reliable. Container-based execution will be added in Phase 2.
        """
        subtask.status = SubtaskStatus.EXECUTING
        subtask.started_at = datetime.now(timezone.utc)
        task.add_log(f"  Subtask [{subtask.id}] executing via {subtask.agent_type}...")

        template = get_template(subtask.agent_type)
        if not template:
            template = get_template("fullstack")

        system_prompt = template["system_prompt"]

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

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        try:
            result = await llm_client.chat(
                model=settings.SUB_AGENT_MODEL,
                messages=messages,
                temperature=float(settings.SUB_AGENT_TEMPERATURE),
                max_tokens=int(settings.SUB_AGENT_MAX_TOKENS),
            )
            subtask.result = result
            subtask.status = SubtaskStatus.COMPLETED
            subtask.completed_at = datetime.now(timezone.utc)
            task.add_log(f"  Subtask [{subtask.id}] completed ✓ ({len(result)} chars)")
        except Exception as e:
            subtask.status = SubtaskStatus.FAILED
            subtask.error = str(e)
            subtask.completed_at = datetime.now(timezone.utc)
            raise

    async def _execute_subtask_via_container(
        self, task: OrchestratorTask, subtask: Subtask, deployment_id: str
    ):
        """Execute a subtask by sending it to a deployed OpenClaw container.

        This is the Phase 2 approach — creates a real container connection.
        Currently unused; _execute_single_subtask uses LLM directly instead.
        """
        subtask.status = SubtaskStatus.EXECUTING
        subtask.deployment_id = deployment_id
        task.add_log(f"  Subtask [{subtask.id}] connecting to container {deployment_id[:8]}...")

        # Get or create a chat manager for this deployment
        if deployment_id not in self._agent_connections:
            mgr = DeploymentChatManager()
            self._agent_connections[deployment_id] = mgr

        mgr = self._agent_connections[deployment_id]

        if not mgr.is_connected:
            await mgr.connect(deployment_id)

        # Send the subtask
        response = await mgr.send_message(subtask.description)
        subtask.result = response.get("content", "")
        subtask.status = SubtaskStatus.COMPLETED
        subtask.completed_at = datetime.now(timezone.utc)
        task.add_log(f"  Subtask [{subtask.id}] completed via container ✓")

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
