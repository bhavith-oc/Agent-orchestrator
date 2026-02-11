"""
Discussion Writer Service
=========================

Writes markdown audit trail files for orchestrator-mode missions.
These files live in .agent/discussions/ and provide a human-readable
record of agent reasoning, changes, and results.

Storage layout:
    .agent/discussions/
        mission-{id}/
            overview.md           # Mission plan (created by Jason)
            agent-{name}.md       # Each sub-agent's work log
            summary.md            # Final summary after completion
"""

import os
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Base directory for discussion files (relative to project root)
DISCUSSIONS_BASE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".agent",
    "discussions",
)


def _ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


def _mission_dir(mission_id: str) -> str:
    d = os.path.join(DISCUSSIONS_BASE, f"mission-{mission_id[:8]}")
    _ensure_dir(d)
    return d


def write_mission_overview(
    mission_id: str,
    title: str,
    user_message: str,
    plan_summary: str,
    tasks: list[dict],
) -> str:
    """Write overview.md when Jason creates a mission plan. Returns file path."""
    path = os.path.join(_mission_dir(mission_id), "overview.md")
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    task_lines = []
    for t in tasks:
        task_lines.append(f"- [ ] **{t.get('title', '?')}** — {t.get('description', '')[:120]}")

    content = f"""# Mission: {title}
**Created:** {now}
**Requested by:** User
**Status:** Active

## Original Request
{user_message}

## Plan
{plan_summary}

## Tasks
{chr(10).join(task_lines)}
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"Discussion: wrote {path}")
    return path


def write_agent_log_header(
    mission_id: str,
    agent_name: str,
    task_title: str,
    task_description: str,
    model: str,
    git_branch: Optional[str],
    files_scope: list[str],
) -> str:
    """Write the header of an agent's discussion file. Returns file path."""
    path = os.path.join(_mission_dir(mission_id), f"agent-{agent_name}.md")
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    scope_lines = "\n".join(f"- `{f}`" for f in files_scope) if files_scope else "- (no specific files)"

    content = f"""# Agent: {agent_name}
**Task:** {task_title}
**Model:** {model}
**Branch:** {git_branch or 'N/A'}
**Started:** {now}

## Task Description
{task_description}

## Files in Scope
{scope_lines}

## Work Log

"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"Discussion: wrote header {path}")
    return path


def append_agent_log(
    mission_id: str,
    agent_name: str,
    heading: str,
    content: str,
):
    """Append a section to an agent's discussion file."""
    path = os.path.join(_mission_dir(mission_id), f"agent-{agent_name}.md")
    if not os.path.exists(path):
        # Create minimal file if header wasn't written
        _ensure_dir(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# Agent: {agent_name}\n\n## Work Log\n\n")

    with open(path, "a", encoding="utf-8") as f:
        f.write(f"### {heading}\n{content}\n\n")

    logger.debug(f"Discussion: appended to {path}")


def write_mission_summary(
    mission_id: str,
    title: str,
    merge_results: list[dict],
    duration_seconds: Optional[float] = None,
) -> str:
    """Write summary.md when a mission completes. Returns file path."""
    path = os.path.join(_mission_dir(mission_id), "summary.md")
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    duration_str = ""
    if duration_seconds is not None:
        mins = int(duration_seconds // 60)
        secs = int(duration_seconds % 60)
        duration_str = f"\n**Duration:** {mins}m {secs}s"

    result_lines = []
    for mr in merge_results:
        if mr.get("merged"):
            result_lines.append(f"- ✓ {mr['task']}: merged successfully")
        else:
            err = mr.get("error", "merge conflict")
            result_lines.append(f"- ✗ {mr['task']}: {err}")

    content = f"""# Mission Summary: {title}
**Completed:** {now}{duration_str}

## Results
{chr(10).join(result_lines) if result_lines else '- All tasks completed (no git changes to merge).'}
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"Discussion: wrote summary {path}")
    return path
