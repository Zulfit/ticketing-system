import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, TicketStatus } from '../generated/prisma/client.js';

export type TicketActor = {
  userId: number;
  role: Role;
};

export type TicketTransition = {
  status: TicketStatus;
  assigneeId: number | null;
  creatorId: number;
};

export type NextAction = {
  action: 'start' | 'resolve' | 'close';
  status: TicketStatus;
};

type Step = {
  to: TicketStatus;
  action: NextAction['action'];
  refusal: string;
  allowed: (ticket: TicketTransition, actor: TicketActor) => boolean;
};

const steps: Partial<Record<TicketStatus, Step>> = {
  [TicketStatus.ASSIGNED]: {
    to: TicketStatus.IN_PROGRESS,
    action: 'start',
    refusal: 'Only the assignee can move this ticket',
    allowed: (ticket, actor) => ticket.assigneeId === actor.userId,
  },
  [TicketStatus.IN_PROGRESS]: {
    to: TicketStatus.RESOLVED,
    action: 'resolve',
    refusal: 'Only the assignee can move this ticket',
    allowed: (ticket, actor) => ticket.assigneeId === actor.userId,
  },
  [TicketStatus.RESOLVED]: {
    to: TicketStatus.CLOSED,
    action: 'close',
    refusal: 'Only the creator or an admin can close this ticket',
    allowed: (ticket, actor) =>
      actor.role === Role.ADMIN || ticket.creatorId === actor.userId,
  },
};

export function transitionToAssigned(from: TicketStatus): TicketStatus {
  if (from !== TicketStatus.OPEN) {
    throw new BadRequestException('Only an open ticket can be assigned');
  }
  return TicketStatus.ASSIGNED;
}

export function transitionStatus(
  ticket: TicketTransition,
  actor: TicketActor,
  to: TicketStatus,
): TicketStatus {
  const step = steps[ticket.status];
  if (!step || step.to !== to) {
    throw new BadRequestException('That status change is not allowed');
  }
  if (!step.allowed(ticket, actor)) {
    throw new ForbiddenException(step.refusal);
  }
  return to;
}

export function nextAction(
  ticket: TicketTransition,
  actor: TicketActor,
): NextAction | null {
  const step = steps[ticket.status];
  if (!step || !step.allowed(ticket, actor)) return null;
  return { action: step.action, status: step.to };
}
