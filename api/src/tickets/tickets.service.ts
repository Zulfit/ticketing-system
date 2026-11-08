import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, TicketStatus } from '../generated/prisma/client.js';
import { AuthUser } from '../auth/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { transitionToAssigned } from './ticket-status.js';

const person = { id: true, name: true } as const;

const ticketSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  priority: true,
  status: true,
  assignee: { select: person },
  department: { select: { id: true, name: true } },
  reporter: { select: person },
  history: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      changedById: true,
    },
  },
} as const;

type Person = { id: number; name: string };

type StoredTicket = {
  id: number;
  title: string;
  description: string;
  location: string;
  priority: string;
  status: string;
  assignee: Person | null;
  department: { id: number; name: string };
  reporter: Person;
  history: {
    id: number;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: Date;
    changedById: number;
  }[];
};

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthUser, dto: CreateTicketDto) {
    const department = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
      select: { id: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    const ticket = await this.prisma.ticket.create({
      data: {
        title: dto.title,
        description: dto.description,
        location: dto.location,
        departmentId: dto.departmentId,
        reporterId: user.userId,
        history: {
          create: {
            toStatus: TicketStatus.OPEN,
            changedById: user.userId,
          },
        },
      },
      select: ticketSelect,
    });

    return this.toPublicTicket(ticket);
  }

  async assign(user: AuthUser, id: number, dto: AssignTicketDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { status: true, departmentId: true },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    const toStatus = transitionToAssigned(ticket.status);

    const assignee = await this.prisma.user.findUnique({
      where: { id: dto.assigneeId },
      select: { role: true, departmentId: true },
    });
    if (
      !assignee ||
      assignee.role !== Role.TECHNICIAN ||
      assignee.departmentId !== ticket.departmentId
    ) {
      throw new BadRequestException(
        "Assignee must be a technician in the ticket's department",
      );
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        assigneeId: dto.assigneeId,
        status: toStatus,
        history: {
          create: {
            fromStatus: ticket.status,
            toStatus,
            changedById: user.userId,
          },
        },
      },
      select: ticketSelect,
    });

    return this.toPublicTicket(updated);
  }

  async findOne(user: AuthUser, id: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: ticketSelect,
    });
    if (!ticket || !canSee(user, ticket)) {
      throw new NotFoundException('Ticket not found');
    }
    return this.toPublicTicket(ticket);
  }

  private async toPublicTicket(ticket: StoredTicket) {
    const ids = [...new Set(ticket.history.map((entry) => entry.changedById))];
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: person,
    });
    const byId = new Map(people.map((someone) => [someone.id, someone]));

    const { reporter, history, ...rest } = ticket;
    return {
      ...rest,
      creator: reporter,
      history: history.map((entry) => {
        const changedBy = byId.get(entry.changedById);
        if (!changedBy) {
          throw new NotFoundException('User not found');
        }
        return {
          id: entry.id,
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          note: entry.note,
          createdAt: entry.createdAt,
          changedBy,
        };
      }),
    };
  }
}

function canSee(
  user: AuthUser,
  ticket: { reporter: Person; assignee: Person | null },
) {
  if (user.role === Role.ADMIN) return true;
  if (ticket.reporter.id === user.userId) return true;
  return ticket.assignee?.id === user.userId;
}
