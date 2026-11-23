import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { Role, TicketStatus } from '../src/generated/prisma/client.js';
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

    expect(listed.body.tickets).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: 'Leaking tap',
        status: 'ASSIGNED',
        assignee: { id: assignee.body.id, name: 'Taylor Technician' },
      }),
    ]);
    expect(listed.body.total).toBe(1);
  });

  it('lists the first ten tickets, newest first, with the total of every visible ticket', async () => {
    const { reporter, ids } = await elevenTickets(app);

    const listed = await request(app.getHttpServer())
      .get('/api/tickets')
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(
      listed.body.tickets.map((ticket: { id: number }) => ticket.id),
    ).toEqual(ids.slice(1).reverse());
    expect(listed.body.total).toBe(11);
  });

  it('lists the oldest of eleven tickets on the second page of ten', async () => {
    const { reporter, ids } = await elevenTickets(app);

    const listed = await request(app.getHttpServer())
      .get('/api/tickets?page=2&limit=10')
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(
      listed.body.tickets.map((ticket: { id: number }) => ticket.id),
    ).toEqual([ids[0]]);
    expect(listed.body.total).toBe(11);
  });

  it('lists the newer of two tickets first', async () => {
    const { reporter, facilities, ticket: older } = await filedTicket(app);
    const newer = await fileTicket(app, reporter.token, facilities.id);

    const listed = await request(app.getHttpServer())
      .get('/api/tickets')
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(
      listed.body.tickets.map((ticket: { id: number }) => ticket.id),
    ).toEqual([newer.body.id, older.id]);
    expect(listed.body.tickets[0]).toEqual(newer.body);
  });

  it('refuses page zero', async () => {
    const { reporter } = await filedTicket(app);

    await request(app.getHttpServer())
      .get('/api/tickets?page=0')
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(400);
  });

  it('lists only their own tickets for a reporter and every ticket for an admin', async () => {
    const { reporter, admin, facilities, ticket } = await filedTicket(app);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Other Reporter',
        email: 'other.reporter@example.com',
        password: 'password',
      })
      .expect(201);
    const other = await signIn(app, 'other.reporter@example.com');
    const theirs = await fileTicket(app, other.token, facilities.id);

    expect(await listIds(app, reporter.token)).toEqual({
      ids: [ticket.id],
      total: 1,
    });
    expect(await listIds(app, other.token)).toEqual({
      ids: [theirs.body.id],
      total: 1,
    });
    expect(await listIds(app, admin.token)).toEqual({
      ids: [theirs.body.id, ticket.id],
      total: 2,
    });
  });

  it('keeps an unassigned ticket off the list of a technician who filters to its department', async () => {
    const { reporter, technician, admin, facilities, ticket } =
      await filedTicket(app);
    await fileTicket(app, reporter.token, facilities.id);
    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);

    expect(
      await listIds(app, technician.token, `?departmentId=${facilities.id}`),
    ).toEqual({ ids: [ticket.id], total: 1 });
  });

  it('drops a ticket that fails the status, priority, or department filter', async () => {
    const { reporter, technician, admin, facilities, ticket } =
      await filedTicket(app);
    const itDepartment = (
      await request(app.getHttpServer())
        .get('/api/departments')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200)
    ).body.find((department: { name: string }) => department.name === 'IT');
    const assigned = await fileTicket(app, reporter.token, facilities.id);
    await request(app.getHttpServer())
      .patch(`/api/tickets/${assigned.body.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);
    const urgent = await fileTicket(app, reporter.token, facilities.id);
    await app.get(PrismaService).ticket.update({
      where: { id: urgent.body.id },
      data: { priority: 'URGENT' },
    });
    const inIt = await fileTicket(app, reporter.token, itDepartment.id);

    expect(await listIds(app, admin.token, '?status=OPEN')).toEqual({
      ids: [inIt.body.id, urgent.body.id, ticket.id],
      total: 3,
    });
    expect(await listIds(app, admin.token, '?priority=MEDIUM')).toEqual({
      ids: [inIt.body.id, assigned.body.id, ticket.id],
      total: 3,
    });
    expect(
      await listIds(app, admin.token, `?departmentId=${facilities.id}`),
    ).toEqual({
      ids: [urgent.body.id, assigned.body.id, ticket.id],
      total: 3,
    });
  });

  it('searches titles without matching a description', async () => {
    const { reporter, facilities, ticket } = await filedTicket(app);
    await fileTicket(app, reporter.token, facilities.id, {
      title: 'Broken light',
      description: 'A leak behind the fitting',
    });

    expect(await listIds(app, reporter.token, '?search=leak')).toEqual({
      ids: [ticket.id],
      total: 1,
    });
  });

  it('refuses an unknown status', async () => {
    const { reporter } = await filedTicket(app);

    await request(app.getHttpServer())
      .get('/api/tickets?status=LOST')
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(400);
  });

  it('treats an empty search as no search', async () => {
    const { reporter, facilities } = await filedTicket(app);
    await fileTicket(app, reporter.token, facilities.id, {
      title: 'Broken light',
    });

    const unfiltered = await listIds(app, reporter.token);
    expect(unfiltered.total).toBe(2);
    expect(await listIds(app, reporter.token, '?search=')).toEqual(unfiltered);
    expect(await listIds(app, reporter.token, '?search=%20%20')).toEqual(
      unfiltered,
    );
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

  it('returns an empty comment thread for the creator of an open ticket', async () => {
    const { reporter, ticket } = await filedTicket(app);

    const thread = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(thread.body).toEqual({ comments: [], canComment: true });
  });

  it('hides the comment thread from a technician who is not the assignee', async () => {
    const { technician, ticket } = await filedTicket(app);

    const hidden = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${technician.token}`)
      .expect(404);

    expect(hidden.body.message).toBe('Ticket not found');
  });

  it('hides the comment thread from a reporter who did not create the ticket', async () => {
    const { ticket } = await filedTicket(app);

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Other Reporter',
        email: 'other.reporter@example.com',
        password: 'password',
      })
      .expect(201);
    const other = await signIn(app, 'other.reporter@example.com');

    const hidden = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    expect(hidden.body.message).toBe('Ticket not found');
  });

  it('returns the thread with canComment false after the ticket is resolved', async () => {
    const { reporter, technician, admin, ticket } = await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    const thread = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(thread.body).toEqual({ comments: [], canComment: false });
  });

  it('refuses a comment thread request with no token', async () => {
    const { ticket } = await filedTicket(app);

    await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .expect(401);
  });

  it('lets the creator, the assignee, and an admin comment while the ticket is open, assigned, or in progress', async () => {
    const { reporter, technician, admin, facilities, ticket } =
      await filedTicket(app);
    const posted: { id: number }[] = [];

    const first = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'Still dripping' })
      .expect(201);
    expect(first.body).toEqual({
      id: expect.any(Number),
      body: 'Still dripping',
      createdAt: expect.any(String),
      author: { id: reporter.user.id, name: 'Riley Reporter' },
    });
    expect(Number.isNaN(Date.parse(first.body.createdAt))).toBe(false);
    posted.push(first.body);

    const second = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'Still dripping tonight' })
      .expect(201);
    posted.push(second.body);

    const adminOnOpen = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ body: 'I will send someone' })
      .expect(201);
    expect(adminOnOpen.body.author).toEqual({
      id: admin.user.id,
      name: 'Avery Admin',
    });
    posted.push(adminOnOpen.body);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assigneeId: technician.user.id })
      .expect(200);

    const assigned = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ body: 'On my way' })
      .expect(201);
    expect(assigned.body.author).toEqual({
      id: technician.user.id,
      name: 'Taylor Technician',
    });
    posted.push(assigned.body);

    const creatorOnAssigned = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'The drip is worse' })
      .expect(201);
    posted.push(creatorOnAssigned.body);

    const adminOnAssigned = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ body: 'Keep me posted' })
      .expect(201);
    posted.push(adminOnAssigned.body);

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const creatorWorking = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'Any update' })
      .expect(201);
    posted.push(creatorWorking.body);

    const assigneeWorking = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ body: 'Replacing the washer' })
      .expect(201);
    posted.push(assigneeWorking.body);

    const adminWorking = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ body: 'Thanks' })
      .expect(201);
    posted.push(adminWorking.body);

    const other = await fileTicket(app, reporter.token, facilities.id, {
      title: 'Broken light',
    });
    const elsewhere = await request(app.getHttpServer())
      .post(`/api/tickets/${other.body.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'This one stays dark' })
      .expect(201);

    const thread = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(thread.body.canComment).toBe(true);
    expect(thread.body.comments).toEqual(posted);
    expect(thread.body.comments[1].id).toBe(second.body.id);
    for (const comment of thread.body.comments) {
      expect(comment.author.name).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(comment.createdAt))).toBe(false);
    }
    expect(
      thread.body.comments.map((comment: { id: number }) => comment.id),
    ).not.toContain(elsewhere.body.id);
  });

  it('hides comment creation from a technician who is not the assignee', async () => {
    const { technician, ticket } = await filedTicket(app);

    const hidden = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${technician.token}`)
      .send({ body: 'I can see this' })
      .expect(404);

    expect(hidden.body.message).toBe('Ticket not found');
  });

  it('refuses a comment once the ticket is resolved, closed, or rejected', async () => {
    const { reporter, technician, admin, facilities, ticket } =
      await filedTicket(app);
    await assignAndResolve(app, ticket.id, {
      adminToken: admin.token,
      technicianToken: technician.token,
      assigneeId: technician.user.id,
    });

    const resolved = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'Too late' })
      .expect(400);
    expect(resolved.body.message).toBe('This ticket accepts no new comment');

    const resolvedThread = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(resolvedThread.body).toEqual({
      comments: [],
      canComment: false,
    });

    await request(app.getHttpServer())
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ status: 'CLOSED' })
      .expect(200);

    const closed = await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'Too late' })
      .expect(400);
    expect(closed.body.message).toBe('This ticket accepts no new comment');

    const closedThread = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(closedThread.body).toEqual({
      comments: [],
      canComment: false,
    });

    const rejectedTicket = await fileTicket(
      app,
      reporter.token,
      facilities.id,
      { title: 'Broken light' },
    );
    await app.get(PrismaService).ticket.update({
      where: { id: rejectedTicket.body.id },
      data: { status: TicketStatus.REJECTED },
    });

    const rejected = await request(app.getHttpServer())
      .post(`/api/tickets/${rejectedTicket.body.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: 'Too late' })
      .expect(400);
    expect(rejected.body.message).toBe('This ticket accepts no new comment');

    const rejectedThread = await request(app.getHttpServer())
      .get(`/api/tickets/${rejectedTicket.body.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);
    expect(rejectedThread.body).toEqual({
      comments: [],
      canComment: false,
    });
  });

  it('refuses a comment that is only whitespace', async () => {
    const { reporter, ticket } = await filedTicket(app);

    const before = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ body: '   ' })
      .expect(400);

    const after = await request(app.getHttpServer())
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(200);

    expect(after.body).toEqual(before.body);
  });

  it('refuses a comment with no token', async () => {
    const { ticket } = await filedTicket(app);

    await request(app.getHttpServer())
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'Still dripping' })
      .expect(401);
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

async function elevenTickets(app: INestApplication) {
  const { seed } = await import('../prisma/seed.js');
  await seed(app.get(PrismaService));
  const reporter = await signIn(app, 'reporter@example.com');
  const facilities = await facilitiesDepartment(app, reporter.token);
  const ids: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const created = await fileTicket(app, reporter.token, facilities.id);
    ids.push(created.body.id);
  }
  return { reporter, ids };
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
  fields: { title?: string; description?: string } = {},
) {
  return request(app.getHttpServer())
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Leaking tap',
      description: 'Drips all night',
      location: 'Block A kitchen',
      departmentId,
      ...fields,
    })
    .expect(201);
}

async function listIds(app: INestApplication, token: string, query = '') {
  const listed = await request(app.getHttpServer())
    .get(`/api/tickets${query}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return {
    ids: listed.body.tickets.map((ticket: { id: number }) => ticket.id),
    total: listed.body.total as number,
  };
}
