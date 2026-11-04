import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import 'dotenv/config';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';

const demoPassword = 'password';

export async function seed(prisma: PrismaClient) {
  const password = await hash(demoPassword, 10);

  const facilities = await prisma.department.upsert({
    where: { name: 'Facilities' },
    update: {},
    create: { name: 'Facilities' },
  });
  await prisma.department.upsert({
    where: { name: 'IT' },
    update: {},
    create: { name: 'IT' },
  });
  await prisma.department.upsert({
    where: { name: 'Electrical' },
    update: {},
    create: { name: 'Electrical' },
  });

  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { name: 'Avery Admin', password, role: Role.ADMIN, departmentId: null },
    create: {
      name: 'Avery Admin',
      email: 'admin@example.com',
      password,
      role: Role.ADMIN,
    },
  });
  await prisma.user.upsert({
    where: { email: 'reporter@example.com' },
    update: {
      name: 'Riley Reporter',
      password,
      role: Role.REPORTER,
      departmentId: null,
    },
    create: {
      name: 'Riley Reporter',
      email: 'reporter@example.com',
      password,
      role: Role.REPORTER,
    },
  });
  await prisma.user.upsert({
    where: { email: 'technician@example.com' },
    update: {
      name: 'Taylor Technician',
      password,
      role: Role.TECHNICIAN,
      departmentId: facilities.id,
    },
    create: {
      name: 'Taylor Technician',
      email: 'technician@example.com',
      password,
      role: Role.TECHNICIAN,
      departmentId: facilities.id,
    },
  });
}

const ranDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (ranDirectly) {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
