import json
from services.llm_client import llm_client
from config import settings

PLANNING_SYSTEM_PROMPT = """You are Jason, an AI orchestrator agent. Your job is to analyze a user's request about a code repository and decompose it into independent subtasks that can be executed by separate sub-agents.

Rules:
- Each task should have a clear, non-overlapping file scope when possible
- Identify dependencies between tasks (task B depends on task A completing first)
- Assign priority: "Urgent" for blocking/critical tasks, "General" for others
- Keep tasks granular — one concern per task
- If the request is simple (single file change, question, etc.), create just one task
- Each task description should be detailed enough for an agent to execute without further context
- Output ONLY valid JSON matching the schema below, no other text

Output JSON Schema:
{
  "plan_summary": "Brief summary of the overall plan",
  "tasks": [
    {
      "id": "task-001",
      "title": "Short task title",
      "description": "Detailed description of what the agent should do",
      "files_scope": ["path/to/file1.py", "path/to/file2.py"],
      "depends_on": [],
      "priority": "General"
    }
  ]
}"""


async def create_task_plan(user_message: str, repo_file_tree: str) -> dict:
    """Use LLM to decompose a user request into a structured task plan."""
    messages = [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Repository structure:\n```\n{repo_file_tree}\n```\n\nUser request:\n{user_message}",
        },
    ]

    plan = await llm_client.chat_json(
        model=settings.JASON_MODEL,
        messages=messages,
        temperature=settings.JASON_TEMPERATURE,
        max_tokens=settings.JASON_MAX_TOKENS,
    )

    # Validate structure
    if "plan_summary" not in plan or "tasks" not in plan:
        raise ValueError(f"Invalid plan structure from LLM: {json.dumps(plan)[:200]}")

    return plan
