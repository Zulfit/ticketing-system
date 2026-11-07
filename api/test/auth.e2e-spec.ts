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

describe('Auth', () => {
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

  it('registers a reporter even when another role is requested, then that person can see their name and role', async () => {
    const email = 'new.person@example.com';

    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'New Person',
        email,
        password: 'password',
        role: 'ADMIN',
      })
      .expect(201);

    expect(registered.body).toMatchObject({
      name: 'New Person',
      email,
      role: 'REPORTER',
    });
    expect(registered.body.password).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);

    expect(me.body).toMatchObject({
      name: 'New Person',
      email,
      role: 'REPORTER',
      department: null,
    });
  });

  it('refuses tickets, departments, and users when nobody is signed in', async () => {
    await request(app.getHttpServer()).get('/api/tickets').expect(401);
    await request(app.getHttpServer()).get('/api/departments').expect(401);
    await request(app.getHttpServer()).get('/api/users').expect(401);
  });

  it('signs in the seeded admin, reporter, and Facilities technician', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const people = [
      {
        email: 'admin@example.com',
        name: 'Avery Admin',
        role: 'ADMIN',
        department: null,
      },
      {
        email: 'reporter@example.com',
        name: 'Riley Reporter',
        role: 'REPORTER',
        department: null,
      },
      {
        email: 'technician@example.com',
        name: 'Taylor Technician',
        role: 'TECHNICIAN',
        department: { name: 'Facilities' },
      },
    ];

    let adminToken = '';
    for (const person of people) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: person.email, password: 'password' })
        .expect(200);

      if (person.role === 'ADMIN') {
        adminToken = login.body.access_token;
      }

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);

      expect(me.body).toMatchObject({
        name: person.name,
        email: person.email,
        role: person.role,
        department: person.department,
      });
    }

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const names = departments.body
      .map((department: { name: string }) => department.name)
      .sort();
    expect(names).toEqual(['Electrical', 'Facilities', 'IT']);
  });
});
