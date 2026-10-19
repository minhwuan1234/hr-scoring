# Sample BA brief: Agent Run History

Design exactly one Toolhub screen: Agent Run History. The user is a workspace admin who needs to inspect recent BA, UI/UX, and Developer agent runs and understand what happened without leaving the screen.

The screen must show a clear title, a compact list of recent runs, and a detail area for the selected run. Each list item shows the agent name, a short task title, status (Running, Completed, or Failed), and a time. The detail area shows the original request, the output or error, and the handoff destination when one exists. Provide a search field and a status filter. A failed run may be retried from its detail area; no other action is needed.

Use the existing Toolhub design language in DESIGN.md: white surfaces, subtle gray borders, dark text, compact controls, and a dotted canvas only where it helps orientation. Make keyboard focus visible. Include loading, empty, failed, and long-output states. On a narrow viewport, stack the list above the detail area.

Acceptance: one screen only; no invented navigation or backend data; use realistic sample run records; every visible UI label is English; the result can be represented as HTML, CSS, and JavaScript.
