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

describe('Departments', () => {
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

  it('lets an admin add a department with a unique name', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/departments')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ name: 'Plumbing' })
      .expect(201);

    expect(created.body).toEqual({
      id: expect.any(Number),
      name: 'Plumbing',
    });

    const listed = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);

    expect(listed.body).toContainEqual({
      id: created.body.id,
      name: 'Plumbing',
    });
  });

  it('lets an admin rename a department', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const token = login.body.access_token as string;

    const created = await request(app.getHttpServer())
      .post('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Plumbing' })
      .expect(201);

    const renamed = await request(app.getHttpServer())
      .patch(`/api/departments/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Grounds' })
      .expect(200);

    expect(renamed.body).toEqual({
      id: created.body.id,
      name: 'Grounds',
    });

    const listed = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listed.body).toContainEqual({
      id: created.body.id,
      name: 'Grounds',
    });
    expect(listed.body).not.toContainEqual({
      id: created.body.id,
      name: 'Plumbing',
    });
  });

  it('refuses a second department with the same name', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const token = login.body.access_token as string;

    await request(app.getHttpServer())
      .post('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Plumbing' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Plumbing' })
      .expect(409);

    const listed = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const plumbing = listed.body.filter(
      (department: { name: string }) => department.name === 'Plumbing',
    );
    expect(plumbing).toHaveLength(1);
  });

  it('refuses a rename that would share another department name', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const token = login.body.access_token as string;

    const created = await request(app.getHttpServer())
      .post('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Plumbing' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/departments/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Facilities' })
      .expect(409);

    const listed = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listed.body).toContainEqual({
      id: created.body.id,
      name: 'Plumbing',
    });
  });

  it('lets any signed-in user see the departments', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    for (const email of [
      'admin@example.com',
      'reporter@example.com',
      'technician@example.com',
    ]) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'password' })
        .expect(200);

      const listed = await request(app.getHttpServer())
        .get('/api/departments')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);

      const names = listed.body
        .map((department: { name: string }) => department.name)
        .sort();
      expect(names).toEqual(['Electrical', 'Facilities', 'IT']);
    }
  });

  it('refuses a reporter or a technician who adds or renames a department', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const adminToken = admin.body.access_token as string;

    const before = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const facilities = before.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    for (const email of ['reporter@example.com', 'technician@example.com']) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'password' })
        .expect(200);
      const token = login.body.access_token as string;

      await request(app.getHttpServer())
        .post('/api/departments')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Plumbing' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/departments/${facilities.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Grounds' })
        .expect(403);
    }

    const after = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const names = after.body
      .map((department: { name: string }) => department.name)
      .sort();
    expect(names).toEqual(['Electrical', 'Facilities', 'IT']);
  });

  it('reports a missing department when an admin renames one that does not exist', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/departments/999999')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ name: 'Grounds' })
      .expect(404);
  });
});
