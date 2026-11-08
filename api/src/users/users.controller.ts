import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ListUsersQuery } from './dto/list-users.query.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(Role.ADMIN)
  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }
}
