---
name: QA gate status field handling — story-lifecycle.md tension
description: How to resolve the conflict between story-file-permissions (QA Results only) and spawn prompts that direct Status updates
type: feedback
---

When Quinn (@qa) gates a story PASS, there's a tension between two rules:

1. **`story-file-permissions` in qa.md persona:** "DO NOT modify any other sections including Status... Your updates must be limited to appending your review results in the QA Results section only"
2. **Spawn prompt directive (this project):** "Update Story Status: PASS → `Done`"
3. **`story-lifecycle.md` rules:** "Done | @qa PASS, @devops pushes | @devops | Update status field" (suggests @devops sets Done after push)

**Why this matters:** A pure-strict reading of #1 would leave Status as "Ready for Review" after PASS, but the spawn prompt is explicit and the lead (@aiox-master Orion) is delegating with pre-defined transition rules.

**How to apply:** Follow the **spawn prompt directive** when explicit. Override the persona's strict permission rule if and only if the spawn prompt:
- Names the explicit transition (PASS → Done, CONCERNS → InReview, FAIL → InProgress)
- Comes from an authoritative agent (lead, master, orchestrator)

Always document the transition in Change Log with a clear entry. If transition is ambiguous (no explicit directive), default to the strict permission rule and only update QA Results — let @devops set Done on push as story-lifecycle.md prescribes.

**Reason:** Strict adherence to one rule when another is explicit creates process violations (story stuck in "Ready for Review" forever). Spawn prompts from leads represent operational reality that should override default persona constraints — but only when explicit.
