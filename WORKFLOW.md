---
github:
  owner: ianneub
  repo: symphony
  label: agent
polling:
  interval_seconds: 30
workspace:
  root: ./workspaces
agent:
  timeout_seconds: 600
  max_continuation_turns: 5
concurrency:
  max_sessions: 1
---

You are working on issue #{{issue.number}}: {{issue.title}}

## Issue Description

{{issue.body}}

## Instructions

1. Read the issue carefully and understand what needs to be done.
2. Explore the codebase to understand the relevant code.
3. Make the necessary changes to address the issue.
4. Commit your changes with a clear commit message.
5. Push your branch and open a pull request.
6. When your work is complete, remove the `agent` label from the issue by running: `gh issue edit {{issue.number}} --remove-label agent`

This is attempt {{attempt}}, continuation turn {{turn}}.
