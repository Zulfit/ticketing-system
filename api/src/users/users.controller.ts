import { Controller, Get } from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('users')
export class UsersController {
  @Roles(Role.ADMIN)
  @Get()
  list() {
    return [];
  }
}
