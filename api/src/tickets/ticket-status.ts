import { BadRequestException } from '@nestjs/common';
import { TicketStatus } from '../generated/prisma/client.js';

export function transitionToAssigned(from: TicketStatus): TicketStatus {
  if (from !== TicketStatus.OPEN) {
    throw new BadRequestException('Only an open ticket can be assigned');
  }
  return TicketStatus.ASSIGNED;
}
