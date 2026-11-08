import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListUsersQuery } from './dto/list-users.query.js';

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: { select: { id: true, name: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ListUsersQuery) {
    return this.prisma.user.findMany({
      where: {
        role: query.role,
        departmentId: query.departmentId,
      },
      select: publicUser,
      orderBy: { name: 'asc' },
    });
  }
}
