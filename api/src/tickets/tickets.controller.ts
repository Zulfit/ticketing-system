import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { TicketListQuery } from './dto/list-tickets.query.js';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto.js';
import { TicketsService } from './tickets.service.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: TicketListQuery) {
    return this.tickets.list(user, query);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
  ) {
    return this.tickets.assign(user, id, dto);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.tickets.changeStatus(user, id, dto);
    
  }

  @Get(':id/comments')
  comments(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tickets.comments(user, id);
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tickets.addComment(user, id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tickets.findOne(user, id);
  }

  @Roles(Role.REPORTER)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user, dto);
  }
}
