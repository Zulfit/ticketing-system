import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

async function resetDatabase(prisma: PrismaService) {
  await prisma.statusHistory.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
}

describe('Users', () => {
  let app: INestApplication;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: process.env,
      shell: process.env.ComSpec ?? '/bin/sh',
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an admin list the technicians in one department', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const token = admin.body.access_token as string;

    const technician = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'technician@example.com', password: 'password' })
      .expect(200);
    const assignee = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${technician.body.access_token}`)
      .expect(200);

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const listed = await request(app.getHttpServer())
      .get('/api/users')
      .query({ role: 'TECHNICIAN', departmentId: facilities.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listed.body).toEqual([
      {
        id: assignee.body.id,
        name: 'Taylor Technician',
        email: 'technician@example.com',
        role: 'TECHNICIAN',
        department: { id: facilities.id, name: 'Facilities' },
      },
    ]);
  });

  it('refuses a reporter or a technician who lists users', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    for (const email of ['reporter@example.com', 'technician@example.com']) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'password' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(403);
    }
  });
});
