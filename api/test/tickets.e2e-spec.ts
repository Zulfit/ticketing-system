import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '../src/generated/prisma/client.js';
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

describe('Tickets', () => {
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

  it('lets a reporter create an open ticket at medium priority with no assignee', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const token = login.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    expect(created.body).toEqual({
      id: expect.any(Number),
      title: 'Leaking tap',
      description: 'Drips all night',
      location: 'Block A kitchen',
      priority: 'MEDIUM',
      status: 'OPEN',
      assignee: null,
      department: { id: facilities.id, name: 'Facilities' },
      creator: { id: me.body.id, name: 'Riley Reporter' },
      history: [
        {
          id: expect.any(Number),
          fromStatus: null,
          toStatus: 'OPEN',
          note: null,
          createdAt: expect.any(String),
          changedBy: { id: me.body.id, name: 'Riley Reporter' },
        },
      ],
    });
    expect(Number.isNaN(Date.parse(created.body.history[0].createdAt))).toBe(
      false,
    );
  });

  it('keeps medium priority when the reporter tries to set one', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const token = login.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
        priority: 'URGENT',
      })
      .expect(201);

    expect(created.body.priority).toBe('MEDIUM');
  });

  it('refuses a person who is not signed in', async () => {
    await request(app.getHttpServer())
      .post('/api/tickets')
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: 1,
      })
      .expect(401);
  });

  it('refuses an admin or a technician who files a ticket', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporter.body.access_token}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    for (const email of ['admin@example.com', 'technician@example.com']) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'password' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send({
          title: 'Leaking tap',
          description: 'Drips all night',
          location: 'Block A kitchen',
          departmentId: facilities.id,
        })
        .expect(403);
    }
  });

  it('reports a missing department', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: 999999,
      })
      .expect(404);
  });

  it('lets the creator and an admin see the ticket, including who opened it', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);

    for (const token of [reporterToken, admin.body.access_token as string]) {
      const seen = await request(app.getHttpServer())
        .get(`/api/tickets/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(seen.body).toEqual(created.body);
      expect(seen.body.history).toEqual([
        {
          id: expect.any(Number),
          fromStatus: null,
          toStatus: 'OPEN',
          note: null,
          createdAt: created.body.history[0].createdAt,
          changedBy: { id: me.body.id, name: 'Riley Reporter' },
        },
      ]);
    }
  });

  it('hides the ticket from another reporter and from a technician who is not the assignee', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Other Reporter',
        email: 'other.reporter@example.com',
        password: 'password',
      })
      .expect(201);

    const other = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'other.reporter@example.com', password: 'password' })
      .expect(200);

    const technician = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'technician@example.com', password: 'password' })
      .expect(200);

    for (const token of [
      other.body.access_token as string,
      technician.body.access_token as string,
    ]) {
      await request(app.getHttpServer())
        .get(`/api/tickets/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    }

    const stillThere = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    expect(stillThere.body.id).toBe(created.body.id);
  });

  it('lets an admin assign a technician in the ticket department', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const creator = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    const technician = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'technician@example.com', password: 'password' })
      .expect(200);
    const technicianToken = technician.body.access_token as string;
    const assignee = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const adminToken = admin.body.access_token as string;
    const assigner = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const assigned = await request(app.getHttpServer())
      .patch(`/api/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: assignee.body.id })
      .expect(200);

    expect(assigned.body).toMatchObject({
      id: created.body.id,
      status: 'ASSIGNED',
      assignee: { id: assignee.body.id, name: 'Taylor Technician' },
      creator: { id: creator.body.id, name: 'Riley Reporter' },
    });
    expect(assigned.body.history).toEqual([
      created.body.history[0],
      {
        id: expect.any(Number),
        fromStatus: 'OPEN',
        toStatus: 'ASSIGNED',
        note: null,
        createdAt: expect.any(String),
        changedBy: { id: assigner.body.id, name: 'Avery Admin' },
      },
    ]);

    const seenByCreator = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    expect(seenByCreator.body).toEqual(assigned.body);

    const seenByAssignee = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    expect(seenByAssignee.body).toEqual(assigned.body);
  });

  it('refuses a technician from another department', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));
    const prisma = app.get(PrismaService);

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );
    const itDepartment = departments.body.find(
      (department: { name: string }) => department.name === 'IT',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    const outsider = await prisma.user.create({
      data: {
        name: 'Ian IT',
        email: 'ian.it@example.com',
        password: 'password',
        role: Role.TECHNICIAN,
        departmentId: itDepartment.id,
      },
    });

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${admin.body.access_token}`)
      .send({ assigneeId: outsider.id })
      .expect(400);

    const unchanged = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    expect(unchanged.body.status).toBe('OPEN');
    expect(unchanged.body.assignee).toBeNull();
  });

  it('refuses an admin as the assignee', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));
    const prisma = app.get(PrismaService);

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const adminUser = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${admin.body.access_token}`)
      .expect(200);

    await prisma.user.update({
      where: { id: adminUser.body.id },
      data: { departmentId: facilities.id },
    });

    await request(app.getHttpServer())
      .patch(`/api/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${admin.body.access_token}`)
      .send({ assigneeId: adminUser.body.id })
      .expect(400);

    const unchanged = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    expect(unchanged.body.status).toBe('OPEN');
    expect(unchanged.body.assignee).toBeNull();
  });

  it('refuses a reporter or a technician who assigns the ticket', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    const technician = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'technician@example.com', password: 'password' })
      .expect(200);
    const technicianUser = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${technician.body.access_token}`)
      .expect(200);

    for (const token of [
      reporterToken,
      technician.body.access_token as string,
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${created.body.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ assigneeId: technicianUser.body.id })
        .expect(403);
    }

    const unchanged = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    expect(unchanged.body.status).toBe('OPEN');
    expect(unchanged.body.assignee).toBeNull();
  });

  it('refuses to assign a ticket that is no longer open', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));
    const prisma = app.get(PrismaService);

    const reporter = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'reporter@example.com', password: 'password' })
      .expect(200);
    const reporterToken = reporter.body.access_token as string;

    const departments = await request(app.getHttpServer())
      .get('/api/departments')
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    const facilities = departments.body.find(
      (department: { name: string }) => department.name === 'Facilities',
    );

    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Leaking tap',
        description: 'Drips all night',
        location: 'Block A kitchen',
        departmentId: facilities.id,
      })
      .expect(201);

    const technician = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'technician@example.com', password: 'password' })
      .expect(200);
    const first = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${technician.body.access_token}`)
      .expect(200);

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);
    const adminToken = admin.body.access_token as string;

    await request(app.getHttpServer())
      .patch(`/api/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: first.body.id })
      .expect(200);

    const second = await prisma.user.create({
      data: {
        name: 'Sam Facilities',
        email: 'sam.facilities@example.com',
        password: 'password',
        role: Role.TECHNICIAN,
        departmentId: facilities.id,
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: second.id })
      .expect(400);

    const unchanged = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${reporterToken}`)
      .expect(200);
    expect(unchanged.body.status).toBe('ASSIGNED');
    expect(unchanged.body.assignee).toEqual({
      id: first.body.id,
      name: 'Taylor Technician',
    });
    expect(unchanged.body.history).toHaveLength(2);
  });

  it('reports a missing ticket as not found', async () => {
    const { seed } = await import('../prisma/seed.js');
    await seed(app.get(PrismaService));

    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/tickets/999999')
      .set('Authorization', `Bearer ${admin.body.access_token}`)
      .expect(404);
  });
});
