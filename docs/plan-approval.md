# Plan approval

When the agent returns a plan requiring approval, r3to.os records it as `pending` and opens the review dialog. The plan cannot execute from that state.

- **Approve** atomically changes the plan to `approved`, claims it for execution, and runs the agent once.
- **Revise** changes the plan to `rejected`; rejected plans cannot execute. Feedback is sent as a new request so the agent may propose a replacement plan.
- Duplicate approvals, duplicate execution, cross-session IDs, stale IDs, and invalid transitions return an error without running actions.
- Execution moves through `executing` to `executed`. Failures become `failed` and are not retried implicitly, preventing accidental duplicate side effects.

The approval state lives in the Electron main process, not the renderer. Renderer IPC calls carry both the session ID and opaque plan ID, and the main-process state machine validates both before execution.
