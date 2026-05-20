---
name: atlas-agents
description: Use when deciding which sub-agent to delegate Atlas work to, or when the user asks "which agent should I use for X?". Maps tasks to recommended agents — Frontend Developer, Backend Architect, Database Optimizer, Software Architect, Security Engineer, Code Reviewer, Technical Writer, Git Workflow Master, Reality Checker, Accessibility Auditor — and shows invocation phrasing.
---

# Atlas — Agents

Sub-agents are installed at the **user scope** (`~/.claude/agents/`), shared across all projects on this machine. There is no project-scoped `.claude/agents/` directory in this repo — if a future need calls for a truly Atlas-specific agent, add `.claude/agents/<name>.md` and document it in the repo's main `CLAUDE.md`.

## Recommended agents for this project

| Agent                 | When to invoke                                                     |
| --------------------- | ------------------------------------------------------------------ |
| Frontend Developer    | React/Next.js component work, UI features                          |
| Backend Architect     | API design, server actions, data flow design                       |
| Database Optimizer    | Schema design, indexing, query tuning                              |
| Software Architect    | New module/aggregate, cross-cutting design, ADR drafting           |
| Security Engineer     | Auth changes, file upload paths, anything touching secrets/PII     |
| Code Reviewer         | Pre-merge review on any non-trivial PR                             |
| Technical Writer      | Updating docs/, ADRs, README                                       |
| Git Workflow Master   | Branching strategy, commit hygiene, history cleanup                |
| Reality Checker       | "Is this actually production-ready?" gate before tagging a release |
| Accessibility Auditor | New UI surfaces, before considering a feature complete             |

## Invocation

Reference the agent by name in a Claude Code session:

> "Use the Backend Architect agent to design the segment import flow."
> "Have the Security Engineer review this file upload code."
> "Run the Reality Checker before I tag v0.1."
