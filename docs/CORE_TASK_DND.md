# Core task drag-and-drop

This implementation adds persistent manual task ordering to the Inbox and project views.

## Included

- Native drag-and-drop in list view
- Native drag-and-drop in board view
- Moving tasks between project sections
- Persistent numeric task positions
- Optimistic UI updates with rollback on API failure
- Transactional `/api/tasks/reorder` endpoint
- Workspace, project, and section validation
- Project and section controls in the task drawer

## Current limits

Manual ordering is intentionally disabled in Today, Upcoming, Completed, label, and filter views because those views can combine tasks from multiple projects and sorting contexts. Those views will receive explicit sorting and grouping controls in a later phase.
