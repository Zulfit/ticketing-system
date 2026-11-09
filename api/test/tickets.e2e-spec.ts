import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
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
      nextAction: null,
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
    expect(assigned.body.nextAction).toBeNull();
    expect(seenByCreator.body).toEqual(assigned.body);

    const seenByAssignee = await request(app.getHttpServer())
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    expect(seenByAssignee.body).toEqual({
      ...assigned.body,
      nextAction: { action: 'start', status: 'IN_PROGRESS' },
    });
  });

  it('lists an assigned ticket for that technician and leaves other tickets off the list', async () => {
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
      .post('/api/tickets')
      .set('Authorization', `Bearer ${reporterToken}`)
      .send({
        title: 'Broken light',
        description: 'Stays dark',
        location: 'Block A hall',
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

    await request(app.getHttpServer())
      .patch(`/api/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${admin.body.access_token}`)
      .send({ assigneeId: assignee.body.id })
      .expect(200);

    const listed = await request(app.getHttpServer())
      .get('/api/tickets')
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    expect(listed.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: 'Leaking tap',
        status: 'ASSIGNED',
        assignee: { id: assignee.body.id, name: 'Taylor Technician' },
      }),
    ]);
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

  it('lets the assignee move an assigned ticket to in progress', async () => {
    const { technician, admin, ticket } = await filedTicket(app);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);

    const started = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.nextAction).toEqual({
      action: 'resolve',
      status: 'RESOLVED',
    });
    expect(started.body.history.at(-1)).toEqual({
      id: expect.any(Number),
      fromStatus: 'ASSIGNED',
      toStatus: 'IN_PROGRESS',
      note: null,
      createdAt: expect.any(String),
      changedBy: { id: technician.user.id, name: 'Taylor Technician' },
    });
    expect(
      Number.isNaN(Date.parse(started.body.history.at(-1).createdAt)),
    ).toBe(false);

    const seen = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${technician.token}`)
      .expect(200);
    expect(seen.body).toEqual(started.body);
  });

  it('lets the assignee resolve an in-progress ticket and record a note', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const resolved = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'RESOLVED', note: 'Replaced the washer' })
      .expect(200);

    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.nextAction).toBeNull();
    expect(resolved.body.history.at(-1)).toEqual({
      id: expect.any(Number),
      fromStatus: 'IN_PROGRESS',
      toStatus: 'RESOLVED',
      note: 'Replaced the washer',
      createdAt: expect.any(String),
      changedBy: { id: technician.user.id, name: 'Taylor Technician' },
    });

    const seenByCreator = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(seenByCreator.body.nextAction).toEqual({
      action: 'close',
      status: 'CLOSED',
    });
  });

  it('lets the creator close a resolved ticket', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    const closed = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ status: 'CLOSED', note: 'The tap is fine now' })
      .expect(200);

    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.nextAction).toBeNull();
    expect(closed.body.history.at(-1)).toEqual({
      id: expect.any(Number),
      fromStatus: 'RESOLVED',
      toStatus: 'CLOSED',
      note: 'The tap is fine now',
      createdAt: expect.any(String),
      changedBy: { id: reporter.user.id, name: 'Riley Reporter' },
    });
  });

  it('refuses anyone except the assignee from moving the ticket to in progress or resolved', async () => {
    const { reporter, technician, admin, ticket, facilities } =
      await filedTicket(app);
    const prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        name: 'Sam Facilities',
        email: 'sam.facilities@example.com',
        password: await hash('password', 10),
        role: Role.TECHNICIAN,
        departmentId: facilities.id,
      },
    });
    const colleague = await signIn(app, 'sam.facilities@example.com');

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);

    for (const token of [reporter.token, admin.token]) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(403);
    }
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${colleague.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(404);

    const stillAssigned = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(stillAssigned.body.status).toBe('ASSIGNED');
    expect(stillAssigned.body.history).toHaveLength(2);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    for (const token of [reporter.token, admin.token]) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'RESOLVED' })
        .expect(403);
    }

    const stillWorking = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${technician.token}`)
      .expect(200);
    expect(stillWorking.body.status).toBe('IN_PROGRESS');
    expect(stillWorking.body.history).toHaveLength(3);
  });

  it('lets an admin close a resolved ticket', async () => {
    const { technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    const closed = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'CLOSED' })
      .expect(200);

    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.history.at(-1)).toMatchObject({
      fromStatus: 'RESOLVED',
      toStatus: 'CLOSED',
      note: null,
      changedBy: { id: admin.user.id, name: 'Avery Admin' },
    });
  });

  it('refuses anyone except the creator or an admin from closing a resolved ticket', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Other Reporter',
        email: 'other.reporter@example.com',
        password: 'password',
      })
      .expect(201);
    const other = await signIn(app, 'other.reporter@example.com');

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'CLOSED' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ status: 'CLOSED' })
      .expect(404);

    const stillResolved = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(stillResolved.body.status).toBe('RESOLVED');
    expect(stillResolved.body.history).toHaveLength(4);
  });

  it('refuses a status change that is not the next step', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);

    for (const status of ['IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ASSIGNED']) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/status`)
        .set('Authorization', `Bearer ${reporter.token}`)
        .send({ status })
        .expect(400);
    }

    const stillOpen = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(stillOpen.body.status).toBe('OPEN');
    expect(stillOpen.body.history).toHaveLength(1);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);

    for (const status of ['RESOLVED', 'CLOSED', 'OPEN']) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/status`)
        .set('Authorization', `Bearer ${technician.token}`)
        .send({ status })
        .expect(400);
    }

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    for (const status of ['CLOSED', 'ASSIGNED', 'OPEN']) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/status`)
        .set('Authorization', `Bearer ${technician.token}`)
        .send({ status })
        .expect(400);
    }

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'RESOLVED' })
      .expect(200);

    for (const status of ['IN_PROGRESS', 'ASSIGNED', 'OPEN']) {
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status })
        .expect(400);
    }

    const stillResolved = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(stillResolved.body.status).toBe('RESOLVED');
    expect(stillResolved.body.history).toHaveLength(4);
  });

  it('refuses any status change after the ticket is closed', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ status: 'CLOSED' })
      .expect(200);

    for (const token of [reporter.token, technician.token, admin.token]) {
      for (const status of [
        'OPEN',
        'ASSIGNED',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED',
      ]) {
        await request(app.getHttpServer())
          .patch(`/api/tickets/${ticket.id}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status })
          .expect(400);
      }
    }

    const closed = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.history).toHaveLength(5);
  });

  it('lets the creator, the assignee, and an admin read the status history', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'IN_PROGRESS', note: 'On the way' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'RESOLVED', note: 'Replaced the washer' })
      .expect(200);
    const closed = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ status: 'CLOSED' })
      .expect(200);

    for (const token of [reporter.token, technician.token, admin.token]) {
      const seen = await request(app.getHttpServer())
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(seen.body.history).toEqual(closed.body.history);
    }

    expect(
      closed.body.history.map((entry: { toStatus: string }) => entry.toStatus),
    ).toEqual(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
  });

  it('hides the status history from a person who cannot see the ticket', async () => {
    const { technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Other Reporter',
        email: 'other.reporter@example.com',
        password: 'password',
      })
      .expect(201);
    const other = await signIn(app, 'other.reporter@example.com');

    const itDepartment = (
      await request(app.getHttpServer())
        .get('/api/departments')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200)
    ).body.find((department: { name: string }) => department.name === 'IT');
    await app.get(PrismaService).user.create({
      data: {
        name: 'Ian IT',
        email: 'ian.it@example.com',
        password: await hash('password', 10),
        role: Role.TECHNICIAN,
        departmentId: itDepartment.id,
      },
    });
    const ian = await signIn(app, 'ian.it@example.com');

    for (const token of [other.token, ian.token]) {
      await request(app.getHttpServer())
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    }

    const stillThere = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${technician.token}`)
      .expect(200);
    expect(stillThere.body.history).toHaveLength(4);
  });

  it('does not apply a status change after the ticket has already moved on', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    const [first, second] = await overlapStatusReads(app, () =>
      Promise.all([
        request(app.getHttpServer())
          .patch(`/api/tickets/${ticket.id}/status`)
          .set('Authorization', `Bearer ${reporter.token}`)
          .send({ status: 'CLOSED' }),
        request(app.getHttpServer())
          .patch(`/api/tickets/${ticket.id}/status`)
          .set('Authorization', `Bearer ${reporter.token}`)
          .send({ status: 'CLOSED' }),
      ]),
    );

    expect([first.status, second.status].sort()).toEqual([200, 400]);

    const closed = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(
      closed.body.history.filter(
        (entry: { toStatus: string }) => entry.toStatus === 'CLOSED',
      ),
    ).toHaveLength(1);
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

    await request(app.getHttpServer())
      .patch('/api/tickets/999999/status')
      .set('Authorization', `Bearer ${admin.body.access_token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(404);
  });
});

async function signIn(app: INestApplication, email: string) {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'password' })
    .expect(200);
  const token = login.body.access_token as string;
  const me = await request(app.getHttpServer())
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return {
    token,
    user: me.body as { id: number; name: string },
  };
}

async function facilitiesDepartment(app: INestApplication, token: string) {
  const departments = await request(app.getHttpServer())
    .get('/api/departments')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return departments.body.find(
    (department: { name: string }) => department.name === 'Facilities',
  ) as { id: number; name: string };
}

async function filedTicket(app: INestApplication) {
  const { seed } = await import('../prisma/seed.js');
  await seed(app.get(PrismaService));
  const reporter = await signIn(app, 'reporter@example.com');
  const facilities = await facilitiesDepartment(app, reporter.token);
  const created = await fileTicket(app, reporter.token, facilities.id);
  const technician = await signIn(app, 'technician@example.com');
  const admin = await signIn(app, 'admin@example.com');
  return {
    reporter,
    technician,
    admin,
    facilities,
    ticket: created.body as { id: number },
  };
}

async function overlapStatusReads<T>(
  app: INestApplication,
  run: () => Promise<T>,
): Promise<T> {
  const ticket = app.get(PrismaService).ticket;
  const original = ticket.findUnique.bind(ticket);
  let waiting = 0;
  let openGate: () => void = () => {};
  const bothRead = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  ticket.findUnique = (async (args: unknown) => {
    const row = await original(args as never);
    const select = (args as { select?: Record<string, unknown> }).select;
    const isStatusRead = Boolean(
      select && 'status' in select && !('title' in select),
    );
    if (!isStatusRead) return row;
    waiting += 1;
    if (waiting === 2) openGate();
    else await bothRead;
    return row;
  }) as typeof ticket.findUnique;

  try {
    const result = await run();
    if (waiting !== 2) {
      throw new Error(`expected two status reads, saw ${waiting}`);
    }
    return result;
  } finally {
    ticket.findUnique = original;
  }
}

async function assignAndResolve(
  app: INestApplication,
  ticketId: number,
  actors: { adminToken: string; technicianToken: string; assigneeId: number },
) {
  await request(app.getHttpServer())
    .patch(`/api/tickets/${ticketId}/assign`)
    .set('Authorization', `Bearer ${actors.adminToken}`)
    .send({ assigneeId: actors.assigneeId })
    .expect(200);
  await request(app.getHttpServer())
    .patch(`/api/tickets/${ticketId}/status`)
    .set('Authorization', `Bearer ${actors.technicianToken}`)
    .send({ status: 'IN_PROGRESS' })
    .expect(200);
  await request(app.getHttpServer())
    .patch(`/api/tickets/${ticketId}/status`)
    .set('Authorization', `Bearer ${actors.technicianToken}`)
    .send({ status: 'RESOLVED' })
    .expect(200);
}

function fileTicket(
  app: INestApplication,
  token: string,
  departmentId: number,
) {
  return request(app.getHttpServer())
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Leaking tap',
      description: 'Drips all night',
      location: 'Block A kitchen',
      departmentId,
    })
    .expect(201);
}
