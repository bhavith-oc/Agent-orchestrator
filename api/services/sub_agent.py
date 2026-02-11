import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.agent import Agent
from models.mission import Mission
from models.chat import ChatSession, ChatMessage
from services.llm_client import llm_client
from services.git_manager import git_manager
from services import discussion_writer
from websocket.manager import ws_manager

logger = logging.getLogger(__name__)

SUB_AGENT_SYSTEM_PROMPT_TEMPLATE = """You are a specialized AI coding agent working on a specific task within a larger project.

Your task: {task_title}
Description: {task_description}

You are working in an isolated git branch. You have access ONLY to the files listed in your scope.
When you need to make changes, output them in the following JSON format:

{{
  "analysis": "Brief analysis of what needs to be done",
  "changes": [
    {{
      "file_path": "relative/path/to/file.py",
      "action": "modify",
      "content": "The complete new file content"
    }},
    {{
      "file_path": "relative/path/to/new_file.py",
      "action": "create",
      "content": "The complete file content"
    }}
  ],
  "summary": "Summary of changes made"
}}

Rules:
- Only modify files within your assigned scope: {files_scope}
- Output ONLY valid JSON, no other text
- For "modify" actions, provide the COMPLETE new file content
- For "create" actions, provide the full file content
- Be precise and make minimal, focused changes
- Do not add unnecessary comments or modifications outside the task scope"""


async def build_agent_prompt(task: dict, files_scope: list[str]) -> str:
    """Build a scoped system prompt for a sub-agent."""
    return SUB_AGENT_SYSTEM_PROMPT_TEMPLATE.format(
        task_title=task.get("title", ""),
        task_description=task.get("description", ""),
        files_scope=json.dumps(files_scope),
    )


async def execute_sub_agent(
    db: AsyncSession,
    agent_id: str,
    mission_id: str,
    session_id: str,
):
    """Execute a sub-agent's task in its isolated worktree."""
    try:
        # Fetch agent and mission from DB
        agent = await db.get(Agent, agent_id)
        mission = await db.get(Mission, mission_id)
        if not agent or not mission:
            logger.error(f"Agent {agent_id} or Mission {mission_id} not found")
            return

        # Update status
        agent.status = "busy"
        mission.status = "Active"
        mission.started_at = datetime.utcnow()
        await db.commit()

        await ws_manager.broadcast_all("agent:status", {
            "agent_id": agent.id, "status": "busy", "task": agent.current_task
        })

        # Read relevant files from worktree
        files_scope = json.loads(mission.files_scope) if mission.files_scope else []
        file_contents = ""
        if agent.worktree_path and files_scope:
            file_contents = git_manager.read_files(agent.worktree_path, files_scope)

        # Write discussion file header
        parent_mission_id = mission.parent_mission_id or mission_id
        try:
            discussion_writer.write_agent_log_header(
                mission_id=parent_mission_id,
                agent_name=agent.name,
                task_title=mission.title,
                task_description=mission.description or "",
                model=agent.model or settings.SUB_AGENT_MODEL,
                git_branch=agent.git_branch,
                files_scope=files_scope,
            )
        except Exception as dw_err:
            logger.warning(f"Failed to write discussion header: {dw_err}")

        # Build messages for LLM
        messages = [
            {"role": "system", "content": agent.system_prompt or "You are a helpful coding agent."},
            {
                "role": "user",
                "content": f"Execute the following task:\n\n{mission.description}\n\nRelevant files:\n{file_contents}",
            },
        ]

        # Log the request in chat
        user_msg = ChatMessage(
            session_id=session_id,
            role="system",
            sender_name="Jason",
            content=f"Assigned task: {mission.title}\n{mission.description}",
        )
        db.add(user_msg)
        await db.commit()

        # Call LLM
        response_text = await llm_client.chat(
            model=agent.model or settings.SUB_AGENT_MODEL,
            messages=messages,
            temperature=settings.SUB_AGENT_TEMPERATURE,
            max_tokens=settings.SUB_AGENT_MAX_TOKENS,
        )

        # Log the response in chat
        agent_msg = ChatMessage(
            session_id=session_id,
            role="agent",
            sender_name=agent.name,
            content=response_text,
        )
        db.add(agent_msg)
        await db.commit()

        # Log agent analysis to discussion file
        try:
            discussion_writer.append_agent_log(
                mission_id=parent_mission_id,
                agent_name=agent.name,
                heading="LLM Response",
                content=f"```\n{response_text[:2000]}\n```",
            )
        except Exception:
            pass

        # Parse response and apply changes
        changes_applied = await _apply_agent_changes(agent, response_text)

        # Commit changes to git
        commit_hash = None
        if changes_applied and agent.worktree_path:
            commit_hash = await git_manager.commit_changes(
                agent.worktree_path,
                f"[{agent.name}] {mission.title}",
            )
            if commit_hash:
                logger.info(f"Agent {agent.name} committed: {commit_hash}")

        # Log completion to discussion file
        try:
            summary = f"Changes applied: {changes_applied}"
            if commit_hash:
                summary += f"\nCommit: `{commit_hash}`"
            discussion_writer.append_agent_log(
                mission_id=parent_mission_id,
                agent_name=agent.name,
                heading="Result",
                content=f"{summary}\n\n**Status:** Completed\n**Completed:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            )
        except Exception:
            pass

        # Update status to completed
        agent.status = "completed"
        agent.load = 0.0
        mission.status = "Completed"
        mission.completed_at = datetime.utcnow()
        await db.commit()

        await ws_manager.broadcast_all("agent:status", {
            "agent_id": agent.id, "status": "completed", "task": agent.current_task
        })
        await ws_manager.broadcast_all("mission:updated", {
            "mission_id": mission.id, "status": "Completed"
        })

    except Exception as e:
        logger.error(f"Sub-agent {agent_id} failed: {e}", exc_info=True)
        # Update status to failed
        try:
            agent = await db.get(Agent, agent_id)
            mission = await db.get(Mission, mission_id)
            if agent:
                agent.status = "failed"
                agent.retry_count += 1
            if mission:
                mission.status = "Failed"
            await db.commit()

            await ws_manager.broadcast_all("agent:status", {
                "agent_id": agent_id, "status": "failed", "error": str(e)
            })
        except Exception:
            logger.error("Failed to update failure status", exc_info=True)


async def _apply_agent_changes(agent: Agent, response_text: str) -> bool:
    """Parse LLM response and apply file changes to the worktree."""
    if not agent.worktree_path:
        return False

    try:
        # Try to parse as JSON
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        data = json.loads(cleaned)
        changes = data.get("changes", [])

        for change in changes:
            file_path = change.get("file_path", "")
            action = change.get("action", "modify")
            content = change.get("content", "")

            if not file_path or not content:
                continue

            git_manager.write_file(agent.worktree_path, file_path, content)
            logger.info(f"Agent {agent.name}: {action} {file_path}")

        return len(changes) > 0

    except (json.JSONDecodeError, KeyError) as e:
        logger.warning(f"Could not parse agent response as JSON: {e}")
        return False
