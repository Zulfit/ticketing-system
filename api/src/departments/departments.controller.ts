import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
