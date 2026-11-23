import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, TicketStatus } from '../generated/prisma/client.js';
import { AuthUser } from '../auth/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { TicketListQuery } from './dto/list-tickets.query.js';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto.js';
import { canComment } from './comment-access.js';
import {
  nextAction,
  transitionStatus,
  transitionToAssigned,
} from './ticket-status.js';

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

type PublicComment = {
  id: number;
  body: string;
  createdAt: string;
  author: { id: number; name: string };
};

type CommentThread = {
  comments: PublicComment[];
  canComment: boolean;
};

type StoredTicket = {
  id: number;
  title: string;
  description: string;
  location: string;
  priority: string;
  status: TicketStatus;
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

    return this.toPublicTicket(ticket, user);
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

    return this.toPublicTicket(updated, user);
  }

  async changeStatus(user: AuthUser, id: number, dto: UpdateTicketStatusDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        status: true,
        reporter: { select: person },
        assignee: { select: person },
      },
    });
    if (!ticket || !canSee(user, ticket)) {
      throw new NotFoundException('Ticket not found');
    }
    const toStatus = transitionStatus(
      {
        status: ticket.status,
        assigneeId: ticket.assignee?.id ?? null,
        creatorId: ticket.reporter.id,
      },
      user,
      dto.status,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.ticket.updateMany({
        where: { id, status: ticket.status },
        data: { status: toStatus },
      });
      if (changed.count !== 1) {
        throw new BadRequestException('That status change is not allowed');
      }
      await tx.statusHistory.create({
        data: {
          ticketId: id,
          fromStatus: ticket.status,
          toStatus,
          note: dto.note,
          changedById: user.userId,
        },
      });
      return tx.ticket.findUniqueOrThrow({
        where: { id },
        select: ticketSelect,
      });
    });

    return this.toPublicTicket(updated, user);
  }

  async list(user: AuthUser, query: TicketListQuery) {
    const where = {
      AND: [
        visibleWhere(user),
        {
          status: query.status,
          priority: query.priority,
          departmentId: query.departmentId,
          title: query.search
            ? { contains: query.search, mode: 'insensitive' as const }
            : undefined,
        },
      ],
    };
    const [total, tickets] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: ticketSelect,
      }),
    ]);
    return {
      tickets: await Promise.all(
        tickets.map((ticket) => this.toPublicTicket(ticket, user)),
      ),
      total,
    };
  }

  async comments(user: AuthUser, id: number): Promise<CommentThread> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        status: true,
        reporter: { select: person },
        assignee: { select: person },
        comments: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: person },
          },
        },
      },
    });
    if (!ticket || !canSee(user, ticket)) {
      throw new NotFoundException('Ticket not found');
    }

    return {
      comments: ticket.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
        author: comment.author,
      })),
      canComment: canComment(
        {
          status: ticket.status,
          creatorId: ticket.reporter.id,
          assigneeId: ticket.assignee?.id ?? null,
        },
        user,
      ),
    };
  }

  async addComment(
    user: AuthUser,
    id: number,
    dto: CreateCommentDto,
  ): Promise<PublicComment> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        status: true,
        reporter: { select: person },
        assignee: { select: person },
      },
    });
    if (!ticket || !canSee(user, ticket)) {
      throw new NotFoundException('Ticket not found');
    }
    if (
      !canComment(
        {
          status: ticket.status,
          creatorId: ticket.reporter.id,
          assigneeId: ticket.assignee?.id ?? null,
        },
        user,
      )
    ) {
      throw new BadRequestException('This ticket accepts no new comment');
    }

    const comment = await this.prisma.comment.create({
      data: {
        body: dto.body,
        ticketId: id,
        authorId: user.userId,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: person },
      },
    });

    return {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      author: comment.author,
    };
  }

  async findOne(user: AuthUser, id: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: ticketSelect,
    });
    if (!ticket || !canSee(user, ticket)) {
      throw new NotFoundException('Ticket not found');
    }
    return this.toPublicTicket(ticket, user);
  }

  private async toPublicTicket(ticket: StoredTicket, user: AuthUser) {
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
      nextAction: nextAction(
        {
          status: ticket.status,
          assigneeId: ticket.assignee?.id ?? null,
          creatorId: reporter.id,
        },
        user,
      ),
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

function visibleWhere(user: AuthUser) {
  if (user.role === Role.ADMIN) return {};
  if (user.role === Role.TECHNICIAN) return { assigneeId: user.userId };
  return { reporterId: user.userId };
}

function canSee(
  user: AuthUser,
  ticket: { reporter: Person; assignee: Person | null },
) {
  if (user.role === Role.ADMIN) return true;
  if (ticket.reporter.id === user.userId) return true;
  return ticket.assignee?.id === user.userId;
}
