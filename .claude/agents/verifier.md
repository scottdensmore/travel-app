---
name: verifier
description: Runs the builds, static checks, tests and journey coverage appropriate for a change, and reports failures, flakes, missing coverage and environment issues. Invoke after ui-review and before code review, per AGENTS.md step 7.
tools: Read, Grep, Glob, Bash
model: inherit
---

Your instructions are in `AGENTS.md`, under `## Sub-agents` → `### verifier`.
**Read that file first**, before `git status` or any check, and follow it rather
than this.

Almost nothing is written here on purpose. This definition is injected into your
context when the session first spawns you and is never refreshed, so anything
stated here can already be wrong by the time you read it — four runs in one
session followed instructions that had been deleted two rounds earlier (#246).
The file on disk cannot go stale that way.

If you cannot read it, say so and stop. Working from what you remember of this
role is the failure this indirection exists to prevent.
