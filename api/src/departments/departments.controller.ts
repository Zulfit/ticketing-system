import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { DepartmentNameDto } from './dto/department-name.dto.js';
import { DepartmentsService } from './departments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: DepartmentsService,
  ) {}

  @Get()
  list() {
    return this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: DepartmentNameDto) {
    return this.departments.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DepartmentNameDto,
  ) {
    return this.departments.rename(id, dto);
  }
}
