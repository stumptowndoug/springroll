import type { ChatDetailDto } from "../shared.ts";

type ChatStatusDetail = {
  readonly session: Pick<ChatDetailDto["session"], "activeTurnId" | "status">;
  readonly turns: readonly Pick<ChatDetailDto["turns"][number], "status">[];
};

export function chatStatusInfo(
  detail: ChatStatusDetail | undefined,
  working: boolean,
): { label: string; className: string } {
  if (working || (detail && Boolean(detail.session.activeTurnId))) {
    return { label: "Running", className: "status-running" };
  }
  if (!detail) {
    return { label: "Waiting", className: "status-quiet" };
  }
  const lastTurn = detail.turns.at(-1);
  if (lastTurn?.status === "failed" || detail.session.status === "archived") {
    return { label: "Failed", className: "status-failed" };
  }
  if (lastTurn?.status === "waiting_for_user") {
    return { label: "Waiting for approval", className: "status-needs-you" };
  }
  if (lastTurn?.status === "cancelled") {
    return { label: "Stopped", className: "status-quiet" };
  }
  if (detail.turns.length > 0) {
    return { label: "Finished", className: "status-good" };
  }
  return { label: "Ready", className: "status-good" };
}
