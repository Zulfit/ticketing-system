import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DepartmentNameDto } from './dto/department-name.dto.js';

const publicDepartment = { id: true, name: true } as const;

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: DepartmentNameDto) {
    try {
      return await this.prisma.department.create({
        data: { name: dto.name },
        select: publicDepartment,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Department name already exists');
      }
      throw error;
    }
  }

  async rename(id: number, dto: DepartmentNameDto) {
    try {
      return await this.prisma.department.update({
        where: { id },
        data: { name: dto.name },
        select: publicDepartment,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Department name already exists');
      }
      if (isMissingRecord(error)) {
        throw new NotFoundException('Department not found');
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function isMissingRecord(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2025'
  );
}
