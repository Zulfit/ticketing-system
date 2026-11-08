import { BadRequestException } from '@nestjs/common';
import { TicketStatus } from '../generated/prisma/client.js';

const nextStatus: Partial<Record<TicketStatus, TicketStatus>> = {
  [TicketStatus.ASSIGNED]: TicketStatus.IN_PROGRESS,
  [TicketStatus.IN_PROGRESS]: TicketStatus.RESOLVED,
  [TicketStatus.RESOLVED]: TicketStatus.CLOSED,
};

export function transitionToAssigned(from: TicketStatus): TicketStatus {
  if (from !== TicketStatus.OPEN) {
    throw new BadRequestException('Only an open ticket can be assigned');
  }
  return TicketStatus.ASSIGNED;
}

export function transitionStatus(
  from: TicketStatus,
  to: TicketStatus,
): TicketStatus {
  if (nextStatus[from] !== to) {
    throw new BadRequestException('That status change is not allowed');
  }
  return to;
}
