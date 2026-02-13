# Git Conflict Resolution Guide

> How merge conflicts were resolved in this project, and how to handle them safely in the future.

---

## What Happened (Feb 13, 2026)

### The Situation

1. **Server (VPS)** had uncommitted local changes (landing page, Nginx config, Dashboard button, docs updates, etc.)
2. **Local machine** pushed new commits to `origin/main` (OrchestratePanel, Zap icon, allowedHosts change, etc.)
3. On the server, `git pull --rebase --autostash` was run:
   - Git **stashed** the uncommitted local changes
   - Git **rebased** the local branch on top of the new upstream commits (fast-forward, no local commits to replay)
   - Git **popped the stash** — but two files had changes in both the stash and the upstream commits → **conflict**

### Files with Conflicts

| File | Upstream (local push) | Stashed (server changes) | Resolution |
|------|----------------------|--------------------------|------------|
| `ui/src/App.tsx` | Added `Zap`, `OrchestratePanel`, removed `Activity`/`FileText`, changed sidebar div class | Added `Activity`, `FileText`, Docs button, `shrink-0` sidebar | **Merged both**: kept all icons (`Zap` + `Activity` + `FileText`), kept `OrchestratePanel`, used `shrink-0` styling |
| `ui/vite.config.js` | `allowedHosts: true` (permit all) | `allowedHosts: [specific domains]` | **Kept upstream**: `true` is simpler and more permissive |

---

## How Conflicts Were Resolved

### Step 1: Identify Conflicted Files

```bash
git status
```

Look for files listed under **"Unmerged paths"** with `both modified:`.

### Step 2: Open Each Conflicted File

Conflict markers look like this:

```
<<<<<<< Updated upstream
// Code from the upstream (remote) commits
=======
// Code from your stashed (local) changes
>>>>>>> Stashed changes
```

- **`Updated upstream`** = what came from `origin/main` (your local push)
- **`Stashed changes`** = what was in your working directory on this machine

### Step 3: Decide What to Keep

For each conflict block, choose one of:

| Strategy | When to Use |
|----------|-------------|
| **Keep upstream** | The remote version is correct/newer |
| **Keep stashed** | Your local changes are what you want |
| **Merge both** | Both sides have valuable changes that don't contradict |

**Delete the conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`) and leave only the final code.

### Step 4: Stage and Commit

```bash
# Stage the resolved files
git add <file1> <file2>

# Add any new untracked files
git add <new-files>

# Commit
git commit -m "resolve merge conflicts and add local changes"

# Push
git push origin main
```

---

## How to Avoid Conflicts in the Future

### Option A: Commit Before Pulling (Recommended)

Always commit your server changes **before** pulling:

```bash
# On the server, BEFORE pulling
git add -A
git commit -m "wip: server changes"

# Now pull with rebase
git pull --rebase origin main

# If conflicts occur, resolve them, then:
git add <resolved-files>
git rebase --continue
```

This is safer because rebase replays your commits one at a time, making conflicts easier to isolate.

### Option B: Stash Manually with Inspection

```bash
# Stash your changes
git stash

# Pull the latest
git pull origin main

# Inspect what changed vs your stash
git stash show -p

# Apply stash (will show conflicts if any)
git stash pop

# Resolve conflicts if needed, then commit
```

### Option C: Work on a Branch

Best for larger changes:

```bash
# Create a branch for server work
git checkout -b server-changes

# Make your changes and commit
git add -A && git commit -m "server: landing page, nginx, etc."

# Switch back and pull
git checkout main
git pull origin main

# Merge your branch
git merge server-changes

# Resolve any conflicts, then push
git push origin main

# Clean up
git branch -d server-changes
```

### Option D: Prevent the Problem Entirely

If you're working on **both** local and server simultaneously:

1. **Coordinate**: Don't edit the same files in both places
2. **Push frequently**: Small, frequent commits reduce conflict surface area
3. **Pull before editing**: Always `git pull` before starting work on either machine
4. **Use feature branches**: Each machine works on a separate branch, merge when ready

---

## Quick Reference: Conflict Resolution Commands

```bash
# Check status during conflict
git status

# See what's conflicted
git diff --name-only --diff-filter=U

# After resolving all conflicts
git add <files>

# If in a rebase
git rebase --continue

# If in a merge
git commit

# Abort if things go wrong
git rebase --abort   # undo rebase
git merge --abort    # undo merge
git stash drop       # discard stash if not needed

# Nuclear option: reset to remote state (LOSES local changes)
git reset --hard origin/main
```

---

## Key Takeaway

> **Always commit or stash your work on one machine before pushing from another.**
> The safest workflow: `commit → pull --rebase → resolve → push`.
