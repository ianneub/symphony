---
github:
  owner: testorg
  repo: testrepo
  label: agent
polling:
  interval_seconds: 15
workspace:
  root: ./workspaces
agent:
  timeout_seconds: 300
  max_continuation_turns: 3
concurrency:
  max_sessions: 2
---

You are working on issue #{{issue.number}}: {{issue.title}}

{{issue.body}}

Create a branch, make changes, commit, and open a PR when done.
