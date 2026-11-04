import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DepartmentsController } from './departments.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [DepartmentsController],
})
export class DepartmentsModule {}
