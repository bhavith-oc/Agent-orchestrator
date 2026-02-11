import asyncio
import os
import shutil
from typing import Optional
from config import settings


class GitManager:
    """Manages git worktrees for sub-agent isolation."""

    def __init__(self):
        self.repo_path = settings.REPO_PATH
        self.worktree_base = settings.WORKTREE_BASE_PATH

    async def _run_git(self, *args: str, cwd: Optional[str] = None) -> str:
        """Run a git command and return stdout."""
        work_dir = cwd or self.repo_path
        proc = await asyncio.create_subprocess_exec(
            "git", *args,
            cwd=work_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode().strip()
            raise RuntimeError(f"Git command failed: git {' '.join(args)}\n{error_msg}")
        return stdout.decode().strip()

    async def create_worktree(self, branch_name: str) -> str:
        """Create a new git worktree on a new branch. Returns the worktree path."""
        worktree_path = os.path.join(self.worktree_base, branch_name.replace("/", "-"))
        os.makedirs(self.worktree_base, exist_ok=True)

        # Create worktree with a new branch
        await self._run_git("worktree", "add", worktree_path, "-b", branch_name)
        return worktree_path

    async def remove_worktree(self, worktree_path: str) -> None:
        """Remove a git worktree."""
        try:
            await self._run_git("worktree", "remove", worktree_path, "--force")
        except RuntimeError:
            # If git worktree remove fails, force-clean the directory
            if os.path.exists(worktree_path):
                shutil.rmtree(worktree_path)
            await self._run_git("worktree", "prune")

    async def delete_branch(self, branch_name: str) -> None:
        """Delete a git branch."""
        try:
            await self._run_git("branch", "-D", branch_name)
        except RuntimeError:
            pass  # Branch may already be deleted

    async def commit_changes(self, worktree_path: str, message: str) -> Optional[str]:
        """Stage all changes and commit in a worktree. Returns commit hash or None if nothing to commit."""
        # Stage all changes
        await self._run_git("add", ".", cwd=worktree_path)

        # Check if there are changes to commit
        try:
            await self._run_git("diff", "--cached", "--quiet", cwd=worktree_path)
            return None  # No changes
        except RuntimeError:
            pass  # There are changes (diff --quiet returns non-zero when there are diffs)

        # Commit
        await self._run_git("commit", "-m", message, cwd=worktree_path)
        commit_hash = await self._run_git("rev-parse", "HEAD", cwd=worktree_path)
        return commit_hash

    async def merge_branch(self, branch_name: str, message: Optional[str] = None) -> bool:
        """Merge a branch into the current branch (main). Returns True if successful."""
        msg = message or f"Merge {branch_name}"
        try:
            await self._run_git("merge", branch_name, "-m", msg)
            return True
        except RuntimeError:
            # Merge conflict — abort
            await self._run_git("merge", "--abort")
            return False

    async def get_diff(self, branch_name: str) -> str:
        """Get the diff between a branch and main."""
        try:
            return await self._run_git("diff", "main", branch_name)
        except RuntimeError:
            return ""

    async def list_worktrees(self) -> list[dict]:
        """List all active worktrees."""
        output = await self._run_git("worktree", "list", "--porcelain")
        worktrees = []
        current = {}
        for line in output.split("\n"):
            if line.startswith("worktree "):
                if current:
                    worktrees.append(current)
                current = {"path": line.split(" ", 1)[1]}
            elif line.startswith("HEAD "):
                current["head"] = line.split(" ", 1)[1]
            elif line.startswith("branch "):
                current["branch"] = line.split(" ", 1)[1]
            elif line == "bare":
                current["bare"] = True
        if current:
            worktrees.append(current)
        return worktrees

    async def get_file_tree(self, path: Optional[str] = None, max_depth: int = 3) -> str:
        """Get a file tree string for a directory."""
        target = path or self.repo_path
        result = []
        await self._walk_tree(target, result, "", max_depth, 0)
        return "\n".join(result)

    async def _walk_tree(self, path: str, result: list, prefix: str, max_depth: int, depth: int):
        """Recursively walk directory tree."""
        if depth >= max_depth:
            return
        try:
            entries = sorted(os.listdir(path))
        except PermissionError:
            return

        # Filter out hidden dirs and common ignores
        skip = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", ".next"}
        entries = [e for e in entries if e not in skip]

        for i, entry in enumerate(entries):
            full_path = os.path.join(path, entry)
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            result.append(f"{prefix}{connector}{entry}")
            if os.path.isdir(full_path):
                extension = "    " if is_last else "│   "
                await self._walk_tree(full_path, result, prefix + extension, max_depth, depth + 1)

    def read_files(self, worktree_path: str, file_paths: list[str]) -> str:
        """Read contents of specific files from a worktree."""
        contents = []
        for fp in file_paths:
            full_path = os.path.join(worktree_path, fp)
            if os.path.exists(full_path):
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                contents.append(f"--- {fp} ---\n{content}")
            else:
                contents.append(f"--- {fp} --- [FILE NOT FOUND]")
        return "\n\n".join(contents)

    def write_file(self, worktree_path: str, file_path: str, content: str) -> None:
        """Write content to a file in a worktree."""
        full_path = os.path.join(worktree_path, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)


git_manager = GitManager()
