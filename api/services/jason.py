import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import async_session
from models.agent import Agent
from models.mission import Mission, MissionDependency
from models.chat import ChatSession, ChatMessage
from services.llm_client import llm_client
from services.task_planner import create_task_plan
from services.git_manager import git_manager
from services.sub_agent import execute_sub_agent, build_agent_prompt
from services import discussion_writer
from websocket.manager import ws_manager

logger = logging.getLogger(__name__)

JASON_SYSTEM_PROMPT = """You are Jason, the master AI orchestrator for the Aether system. You manage a team of AI sub-agents to accomplish coding tasks in a repository.

Your responsibilities:
1. Understand user requests about their codebase
2. Decompose complex requests into subtasks
3. Delegate tasks to specialized sub-agents
4. Monitor progress and report results

When responding to the user:
- Be concise and professional
- Explain your plan before executing
- Report progress and results clearly
- If something fails, explain what went wrong and what you'll do about it

You are currently managing the repository and can spawn sub-agents to work on different parts of the codebase simultaneously using isolated git worktrees."""


class JasonOrchestrator:
    """The master agent that orchestrates all sub-agents."""

    def __init__(self):
        self.jason_agent_id: Optional[str] = None
        self._monitoring_tasks: dict[str, asyncio.Task] = {}

    async def ensure_jason_exists(self, db: AsyncSession) -> Agent:
        """Ensure Jason master agent exists in DB, create if not."""
        result = await db.execute(
            select(Agent).where(Agent.type == "master", Agent.name == "Jason")
        )
        jason = result.scalar_one_or_none()

        if not jason:
            jason = Agent(
                name="Jason",
                type="master",
                status="active",
                model=settings.JASON_MODEL,
                system_prompt=JASON_SYSTEM_PROMPT,
                current_task="Awaiting commands",
            )
            db.add(jason)
            await db.commit()
            await db.refresh(jason)

        self.jason_agent_id = jason.id
        return jason

    async def handle_user_message(
        self,
        db: AsyncSession,
        session_id: str,
        user_message: str,
    ) -> str:
        """
        Main entry point: user sends a message, Jason processes it.

        Two modes:
        - Conversational mode (REPO_PATH empty): Jason chats directly with
          multi-turn history from the DB. No task planning or sub-agents.
        - Orchestrator mode (REPO_PATH set): Full pipeline — plan tasks,
          spawn sub-agents, monitor, merge.
        """
        jason = await self.ensure_jason_exists(db)

        # Guard: LLM provider must be configured
        if not self.llm.is_configured():
            provider = self.llm.provider
            return (
                f"⚠️ **LLM provider '{provider}' is not configured.**\n\n"
                f"Set the required keys in `api/.env` and restart the backend.\n"
                f"Current provider: `LLM_PROVIDER={provider}`\n\n"
                f"Options: `openrouter`, `runpod`, `custom`"
            )

        # Update Jason's status
        jason.status = "busy"
        jason.current_task = "Analyzing request"
        await db.commit()

        await ws_manager.broadcast_all("agent:status", {
            "agent_id": jason.id, "status": "busy", "task": "Analyzing request"
        })

        try:
            # Load chat history for multi-turn context
            history = await self._load_chat_history(db, session_id, limit=20)

            # --- Conversational mode (no repo configured) ---
            if not settings.REPO_PATH:
                response = await self._conversational_response(user_message, history)
                jason.status = "active"
                jason.current_task = "Awaiting commands"
                await db.commit()
                return response

            # --- Orchestrator mode (repo configured) ---
            # Get repo file tree for context
            file_tree = await git_manager.get_file_tree()

            # Step 1: Create task plan using LLM
            jason.current_task = "Planning tasks"
            await db.commit()

            plan = await create_task_plan(user_message, file_tree)
            plan_summary = plan.get("plan_summary", "Processing request...")
            tasks = plan.get("tasks", [])

            if not tasks:
                # Simple request — Jason responds directly with history context
                response = await self._direct_response(user_message, file_tree, history)
                jason.status = "active"
                jason.current_task = "Awaiting commands"
                await db.commit()
                return response

            # Step 2: Create parent mission
            parent_mission = Mission(
                title=plan_summary,
                description=user_message,
                status="Active",
                priority="General",
                assigned_agent_id=jason.id,
                plan_json=json.dumps(plan),
                started_at=datetime.utcnow(),
            )
            db.add(parent_mission)
            await db.commit()
            await db.refresh(parent_mission)

            await ws_manager.broadcast_all("mission:updated", {
                "mission_id": parent_mission.id,
                "title": parent_mission.title,
                "status": "Active",
            })

            # Write discussion overview file
            try:
                discussion_writer.write_mission_overview(
                    mission_id=parent_mission.id,
                    title=plan_summary,
                    user_message=user_message,
                    plan_summary=plan_summary,
                    tasks=tasks,
                )
            except Exception as dw_err:
                logger.warning(f"Failed to write discussion overview: {dw_err}")

            # Step 3: Create sub-missions and spawn sub-agents
            task_to_mission: dict[str, str] = {}  # task_id -> mission_id

            for task in tasks:
                files_scope = task.get("files_scope", [])

                sub_mission = Mission(
                    title=task["title"],
                    description=task["description"],
                    status="Queue",
                    priority=task.get("priority", "General"),
                    parent_mission_id=parent_mission.id,
                    files_scope=json.dumps(files_scope),
                )
                db.add(sub_mission)
                await db.commit()
                await db.refresh(sub_mission)

                task_to_mission[task["id"]] = sub_mission.id

                # Create dependencies
                for dep_id in task.get("depends_on", []):
                    if dep_id in task_to_mission:
                        dep = MissionDependency(
                            mission_id=sub_mission.id,
                            depends_on_id=task_to_mission[dep_id],
                        )
                        db.add(dep)

            await db.commit()

            # Step 4: Spawn sub-agents for tasks without dependencies
            await self._spawn_ready_agents(db, parent_mission.id, tasks, task_to_mission)

            # Step 5: Start monitoring loop
            monitor_task = asyncio.create_task(
                self._monitor_mission(parent_mission.id, session_id)
            )
            self._monitoring_tasks[parent_mission.id] = monitor_task

            # Build response message
            task_list = "\n".join(
                f"  • **{t['title']}** — {t['description'][:80]}..."
                if len(t['description']) > 80
                else f"  • **{t['title']}** — {t['description']}"
                for t in tasks
            )

            response = (
                f"**Plan:** {plan_summary}\n\n"
                f"I've decomposed your request into {len(tasks)} task(s):\n\n"
                f"{task_list}\n\n"
                f"Spawning sub-agents now. I'll report back when they complete."
            )

            jason.status = "active"
            jason.current_task = f"Monitoring {len(tasks)} sub-agents"
            await db.commit()

            return response

        except Exception as e:
            logger.error(f"Jason failed to process message: {e}", exc_info=True)
            jason.status = "active"
            jason.current_task = "Awaiting commands"
            await db.commit()
            return f"I encountered an error while processing your request: {str(e)}"

    async def _load_chat_history(
        self, db: AsyncSession, session_id: str, limit: int = 20
    ) -> list[dict]:
        """Load recent chat messages from the DB for multi-turn context."""
        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()
        # Reverse so oldest is first (chronological order)
        rows = list(reversed(rows))
        history = []
        for msg in rows:
            role = "assistant" if msg.role == "agent" else msg.role
            history.append({"role": role, "content": msg.content})
        return history

    async def _conversational_response(
        self, user_message: str, history: list[dict]
    ) -> str:
        """Conversational mode: Jason chats directly using chat history."""
        messages = [{"role": "system", "content": JASON_SYSTEM_PROMPT}]
        # Append recent history for multi-turn context
        messages.extend(history)
        # Append the current user message
        messages.append({"role": "user", "content": user_message})

        return await llm_client.chat(
            model=settings.JASON_MODEL,
            messages=messages,
            temperature=settings.JASON_TEMPERATURE,
            max_tokens=settings.JASON_MAX_TOKENS,
        )

    async def _direct_response(
        self, user_message: str, file_tree: str, history: list[dict]
    ) -> str:
        """For simple requests in orchestrator mode, Jason responds directly."""
        messages = [{"role": "system", "content": JASON_SYSTEM_PROMPT}]
        # Append recent history
        messages.extend(history)
        # Append current message with repo context
        messages.append({
            "role": "user",
            "content": f"Repository structure:\n```\n{file_tree}\n```\n\nUser request: {user_message}",
        })
        return await llm_client.chat(
            model=settings.JASON_MODEL,
            messages=messages,
            temperature=settings.JASON_TEMPERATURE,
            max_tokens=settings.JASON_MAX_TOKENS,
        )

    async def _spawn_ready_agents(
        self,
        db: AsyncSession,
        parent_mission_id: str,
        tasks: list[dict],
        task_to_mission: dict[str, str],
    ):
        """Spawn sub-agents for tasks whose dependencies are all met."""
        for task in tasks:
            mission_id = task_to_mission.get(task["id"])
            if not mission_id:
                continue

            mission = await db.get(Mission, mission_id)
            if not mission or mission.status != "Queue":
                continue

            # Check dependencies
            deps_met = True
            for dep_id in task.get("depends_on", []):
                dep_mission_id = task_to_mission.get(dep_id)
                if dep_mission_id:
                    dep_mission = await db.get(Mission, dep_mission_id)
                    if dep_mission and dep_mission.status != "Completed":
                        deps_met = False
                        break

            if not deps_met:
                continue

            # Spawn sub-agent
            await self._spawn_sub_agent(db, mission, task)

    async def _spawn_sub_agent(self, db: AsyncSession, mission: Mission, task: dict):
        """Spawn a single sub-agent for a mission."""
        files_scope = json.loads(mission.files_scope) if mission.files_scope else []
        branch_name = f"agent/task-{mission.id}"

        # Create git worktree
        worktree_path = None
        if settings.REPO_PATH:
            try:
                worktree_path = await git_manager.create_worktree(branch_name)
            except Exception as e:
                logger.warning(f"Failed to create worktree: {e}. Agent will work without isolation.")

        # Build system prompt
        system_prompt = await build_agent_prompt(task, files_scope)

        # Create agent record
        agent = Agent(
            name=f"Agent-{mission.id[:6]}",
            type="sub",
            status="active",
            parent_agent_id=self.jason_agent_id,
            model=settings.SUB_AGENT_MODEL,
            system_prompt=system_prompt,
            worktree_path=worktree_path,
            git_branch=branch_name,
            current_task=mission.title,
            load=50.0,
        )
        db.add(agent)
        await db.commit()
        await db.refresh(agent)

        # Assign agent to mission
        mission.assigned_agent_id = agent.id
        mission.git_branch = branch_name
        await db.commit()

        # Create chat session for agent
        session = ChatSession(
            type="agent",
            agent_id=agent.id,
            mission_id=mission.id,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

        await ws_manager.broadcast_all("agent:spawned", {
            "agent_id": agent.id,
            "name": agent.name,
            "task": agent.current_task,
        })

        # Launch async execution
        asyncio.create_task(
            self._run_sub_agent_with_session(agent.id, mission.id, session.id)
        )

    async def _run_sub_agent_with_session(
        self, agent_id: str, mission_id: str, session_id: str
    ):
        """Run sub-agent execution with its own DB session."""
        async with async_session() as db:
            await execute_sub_agent(db, agent_id, mission_id, session_id)

    async def _monitor_mission(self, parent_mission_id: str, chat_session_id: str):
        """Monitor a parent mission until all subtasks complete."""
        try:
            while True:
                await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)

                async with async_session() as db:
                    # Get all sub-missions
                    result = await db.execute(
                        select(Mission).where(
                            Mission.parent_mission_id == parent_mission_id
                        )
                    )
                    sub_missions = result.scalars().all()

                    if not sub_missions:
                        break

                    statuses = [m.status for m in sub_missions]

                    # All completed
                    if all(s == "Completed" for s in statuses):
                        await self._finalize_mission(db, parent_mission_id, chat_session_id)
                        break

                    # Any failed (and exhausted retries)
                    failed = [m for m in sub_missions if m.status == "Failed"]
                    for fm in failed:
                        agent = await db.get(Agent, fm.assigned_agent_id) if fm.assigned_agent_id else None
                        if agent and agent.retry_count >= settings.SUB_AGENT_MAX_RETRIES:
                            # Mission failed
                            parent = await db.get(Mission, parent_mission_id)
                            if parent:
                                parent.status = "Failed"
                                await db.commit()

                            # Notify user
                            fail_msg = ChatMessage(
                                session_id=chat_session_id,
                                role="agent",
                                sender_name="Jason",
                                content=f"Mission failed: Task '{fm.title}' could not be completed after {settings.SUB_AGENT_MAX_RETRIES} retries.",
                            )
                            db.add(fail_msg)
                            await db.commit()

                            await ws_manager.send_to_session(chat_session_id, "chat:message", {
                                "role": "agent",
                                "sender_name": "Jason",
                                "content": fail_msg.content,
                            })
                            return

                    # Check if any queued tasks can now be started (dependencies met)
                    queued = [m for m in sub_missions if m.status == "Queue"]
                    for qm in queued:
                        # Check dependencies
                        dep_result = await db.execute(
                            select(MissionDependency).where(
                                MissionDependency.mission_id == qm.id
                            )
                        )
                        deps = dep_result.scalars().all()
                        all_met = True
                        for dep in deps:
                            dep_mission = await db.get(Mission, dep.depends_on_id)
                            if dep_mission and dep_mission.status != "Completed":
                                all_met = False
                                break

                        if all_met:
                            task_data = {
                                "id": qm.id,
                                "title": qm.title,
                                "description": qm.description or "",
                                "files_scope": json.loads(qm.files_scope) if qm.files_scope else [],
                            }
                            await self._spawn_sub_agent(db, qm, task_data)

        except asyncio.CancelledError:
            logger.info(f"Monitoring cancelled for mission {parent_mission_id}")
        except Exception as e:
            logger.error(f"Monitor error for mission {parent_mission_id}: {e}", exc_info=True)
        finally:
            self._monitoring_tasks.pop(parent_mission_id, None)

    async def _finalize_mission(
        self, db: AsyncSession, parent_mission_id: str, chat_session_id: str
    ):
        """All subtasks completed — merge branches and report to user."""
        parent = await db.get(Mission, parent_mission_id)
        if not parent:
            return

        # Get all sub-missions and their agents
        result = await db.execute(
            select(Mission).where(Mission.parent_mission_id == parent_mission_id)
        )
        sub_missions = result.scalars().all()

        merge_results = []
        for sm in sub_missions:
            if sm.git_branch and settings.REPO_PATH:
                try:
                    success = await git_manager.merge_branch(
                        sm.git_branch,
                        f"Merge {sm.title} (agent/task-{sm.id})",
                    )
                    merge_results.append({"task": sm.title, "merged": success})

                    # Cleanup worktree
                    agent = await db.get(Agent, sm.assigned_agent_id) if sm.assigned_agent_id else None
                    if agent and agent.worktree_path:
                        await git_manager.remove_worktree(agent.worktree_path)
                        await git_manager.delete_branch(sm.git_branch)
                        agent.terminated_at = datetime.utcnow()

                except Exception as e:
                    logger.error(f"Failed to merge {sm.git_branch}: {e}")
                    merge_results.append({"task": sm.title, "merged": False, "error": str(e)})

        # Write discussion summary file
        try:
            duration = None
            if parent.started_at:
                duration = (datetime.utcnow() - parent.started_at).total_seconds()
            discussion_writer.write_mission_summary(
                mission_id=parent_mission_id,
                title=parent.title,
                merge_results=merge_results,
                duration_seconds=duration,
            )
        except Exception as dw_err:
            logger.warning(f"Failed to write discussion summary: {dw_err}")

        # Update parent mission
        parent.status = "Completed"
        parent.completed_at = datetime.utcnow()

        # Update Jason status
        jason = await self.ensure_jason_exists(db)
        jason.current_task = "Awaiting commands"
        await db.commit()

        # Build completion message
        completed_tasks = "\n".join(f"  ✓ {mr['task']}" for mr in merge_results if mr.get("merged"))
        failed_merges = "\n".join(
            f"  ✗ {mr['task']}: {mr.get('error', 'merge conflict')}"
            for mr in merge_results if not mr.get("merged")
        )

        completion_msg = f"**Mission Complete:** {parent.title}\n\n"
        if completed_tasks:
            completion_msg += f"Successfully merged:\n{completed_tasks}\n\n"
        if failed_merges:
            completion_msg += f"Failed to merge:\n{failed_merges}\n\n"
        if not merge_results:
            completion_msg += "All tasks completed (no git changes to merge).\n"

        # Post to chat
        msg = ChatMessage(
            session_id=chat_session_id,
            role="agent",
            sender_name="Jason",
            content=completion_msg,
        )
        db.add(msg)
        await db.commit()

        await ws_manager.send_to_session(chat_session_id, "chat:message", {
            "role": "agent",
            "sender_name": "Jason",
            "content": completion_msg,
        })

        await ws_manager.broadcast_all("mission:updated", {
            "mission_id": parent.id, "status": "Completed"
        })


# Singleton
jason_orchestrator = JasonOrchestrator()
