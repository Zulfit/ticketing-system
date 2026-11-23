import { Role, TicketStatus } from '../generated/prisma/client.js';

export function canComment(
  ticket: {
    status: TicketStatus;
    creatorId: number;
    assigneeId: number | null;
  },
  actor: { userId: number; role: Role },
): boolean {
  const open =
    ticket.status === TicketStatus.OPEN ||
    ticket.status === TicketStatus.ASSIGNED ||
    ticket.status === TicketStatus.IN_PROGRESS;
  const allowed =
    actor.role === Role.ADMIN ||
    actor.userId === ticket.creatorId ||
    actor.userId === ticket.assigneeId;
  return open && allowed;
}
