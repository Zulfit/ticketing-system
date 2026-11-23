import { Role, TicketStatus } from '../generated/prisma/client.js';
import { canComment } from './comment-access.js';

const creator = { userId: 1, role: Role.REPORTER };
const assignee = { userId: 2, role: Role.TECHNICIAN };
const admin = { userId: 3, role: Role.ADMIN };

const workable = [
  TicketStatus.OPEN,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
] as const;

const finished = [
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
  TicketStatus.REJECTED,
] as const;

describe('canComment', () => {
  it('is true for the creator, the assignee, and an admin while the ticket is open, assigned, or in progress', () => {
    for (const status of workable) {
      const ticket = {
        status,
        creatorId: creator.userId,
        assigneeId: assignee.userId,
      };
      expect(canComment(ticket, creator)).toBe(true);
      expect(canComment(ticket, assignee)).toBe(true);
      expect(canComment(ticket, admin)).toBe(true);
    }
  });

  it('is false for the creator, the assignee, and an admin when the ticket is resolved, closed, or rejected', () => {
    for (const status of finished) {
      const ticket = {
        status,
        creatorId: creator.userId,
        assigneeId: assignee.userId,
      };
      expect(canComment(ticket, creator)).toBe(false);
      expect(canComment(ticket, assignee)).toBe(false);
      expect(canComment(ticket, admin)).toBe(false);
    }
  });

  it('is false for a technician who is not the assignee on an open ticket', () => {
    expect(
      canComment(
        {
          status: TicketStatus.OPEN,
          creatorId: creator.userId,
          assigneeId: assignee.userId,
        },
        { userId: 4, role: Role.TECHNICIAN },
      ),
    ).toBe(false);
  });
});
