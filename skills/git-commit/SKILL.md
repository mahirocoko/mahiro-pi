---
name: git-commit
description: Creates an explicitly authorized, scoped Git commit through Pi's native git-commit agent. Use when the user asks to commit changes, says git-commit or cmt, or invokes /skill:git-commit. Do not commit merely because a task is finished or this skill is discussed.
---

# Git commit

Turn the user's approved diff into one verified commit. Keep repository scope,
sensitive files and the stored message explicit; never equate a successful tool
submission with a completed commit.

## Confirm authorization and scope

- Require an explicit request to create a commit. Asking to add or edit this
  skill/agent is not commit authorization.
- Resolve the actual repository root and branch. Agree on the diff scope before
  staging; an earlier approval does not cover newly added feature work.
- For an approved "commit all", include every safe change in that repository,
  including intentional recap state. Do not substitute a nested-repo-only commit.
- Inspect status and filenames before content. Exclude credentials, dotenv files,
  installed copies, caches and private runtime evidence; do not open suspected
  secrets merely to confirm their sensitivity. Stop if a staged sensitive or
  unrelated path cannot be safely separated within the approved scope.

## Delegate through native Pi

Use the native `subagent` tool with the installed `git-commit` role. Pass the
approved repository, explicit user authorization, allowed paths, relevant repo
conventions and checks already performed. Require no source edits, installs,
nested agents, push, tags or release. The role is authored in this package;
runtime role registration remains separate from automatic package skill loading.

If the role/tool is unavailable or stops before any commit attempt, Main may use
the same manual sequence below. Do not launch another executor or retry with a
different command spelling after an actual denied commit attempt.

## Commit sequence

1. Verify `git rev-parse --show-toplevel`, branch and status. Inspect approved safe
   staged/unstaged diffs and recent messages with Git commands only. Preserve
   unrelated work and follow repo-local commit conventions before fallback taste.
2. Stage explicit paths. Check the complete staged path list, diff and whitespace
   before committing. Do not use broad `git add .` or `git add -A`.
3. Create a new commit with one direct command beginning with `git commit`, from
   the verified repository cwd. Keep staging and checks in earlier tool calls;
   do not prefix the commit with `cd`, `git -C` or a compound command.
4. Verify `git status --short`, the resulting hash and `git log -1 --format=%B`.
   Report actual committed scope, remaining changes and any failure.

Use the repository's established subject style. When it is silent, prefer
`feat: ✨`, `fix: 🐛`, `docs: 📝`, `refactor: ♻️`, `test: ✅` or `chore: 🔧` with
a concise subject explaining the purpose; omit an invented scope or trailing period.

## Message and failure boundaries

Keep stored messages free of generated-by lines, bot signatures, attribution
trailers and orphan markers. If higher-priority runtime instructions require
attribution in command input, follow them and let the canonical guard sanitize
it. Inspect the stored message rather than assuming the guard covered this cwd.

On denial, hook failure, unexpected committed scope or forbidden stored
attribution, stop and report the actual index/commit state. Do not bypass guards,
skip hooks, change Git config, switch executors or silently amend history.
Explain the concrete repair and obtain the required authorization before any
follow-up; an ordinary new commit is not a repair for bad earlier history.

Never create an empty commit. Require separate explicit permission for amend,
push, tags, releases, destructive Git or broader scope. Skill activation and
agent delegation do not grant those permissions.
