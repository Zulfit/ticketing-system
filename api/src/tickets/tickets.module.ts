import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';

@Module({
  controllers: [TicketsController],
})
export class TicketsModule {}
