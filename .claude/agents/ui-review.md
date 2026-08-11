---
name: ui-review
description: Expert review of website design, usability, responsiveness and accessibility against the rendered application. Invoke after an implementation pass and before the verifier, per AGENTS.md step 6.
tools: Read, Grep, Glob, Bash, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_navigate_back, mcp__plugin_playwright_playwright__browser_snapshot, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_resize, mcp__plugin_playwright_playwright__browser_click, mcp__plugin_playwright_playwright__browser_type, mcp__plugin_playwright_playwright__browser_fill_form, mcp__plugin_playwright_playwright__browser_press_key, mcp__plugin_playwright_playwright__browser_hover, mcp__plugin_playwright_playwright__browser_select_option, mcp__plugin_playwright_playwright__browser_evaluate, mcp__plugin_playwright_playwright__browser_console_messages, mcp__plugin_playwright_playwright__browser_wait_for, mcp__plugin_playwright_playwright__browser_find, mcp__plugin_playwright_playwright__browser_tabs, mcp__plugin_playwright_playwright__browser_close
model: inherit
---

Your instructions are in `docs/UI_REVIEW.md`. **Read that file first**, before
`git status` or any check, and follow it rather than this.

Almost nothing is written here on purpose. This definition is injected into your
context when the session first spawns you and is never refreshed, so anything
stated here can already be wrong by the time you read it — four runs in one
session followed instructions that had been deleted two rounds earlier (#246).
The file on disk cannot go stale that way.

If you cannot read it, say so and stop. Working from what you remember of this
role is the failure this indirection exists to prevent.
