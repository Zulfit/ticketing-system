# Maintenance ticketing

Staff report a maintenance problem. An admin assigns one technician from the department that owns that kind of work, and that technician works the ticket until it is resolved.

## People

**Admin**:
A user who can see every ticket, manage users and departments, assign technicians, and reject work that is not valid. An admin has no department and is never an assignee.
_Avoid_: dispatcher, manager

**Technician**:
A user who belongs to one department and can see only the tickets assigned to them. Only a technician has a department.
_Avoid_: engineer, worker

**Reporter**:
A user whose role is to create tickets and follow the tickets they created. A user is a reporter, a technician, or an admin, and only one of these. A reporter has no department.
_Avoid_: staff, requester, end user

**Creator**:
The user who filed a ticket. The creator stays on that ticket even if their role later changes.
_Avoid_: reporter

**Assignee**:
The technician currently responsible for a ticket. A ticket has at most one.
_Avoid_: owner, handler

## Work

**Ticket**:
One reported maintenance problem. It has one creator, one department, and at most one assignee.
_Avoid_: job, work order, request

**Department**:
The group responsible for one category of maintenance. A ticket is routed to one department, and only a technician in that department may be assigned to it. Other technicians in the department do not see the ticket. Moving a ticket to another department also names the new assignee.
_Avoid_: team, queue

**Comment**:
A remark on a ticket by the creator, the current assignee, or an admin, while the ticket is open, assigned, or in progress.
_Avoid_: note, message

**Photo**:
An image the current assignee adds while the ticket is assigned, in progress, or resolved. An admin may remove one in any state.
_Avoid_: attachment, file

**Priority**:
How urgent an admin says the ticket is. It does not decide who works the ticket, and it does not set a deadline.
_Avoid_: severity, SLA

## Outcomes

**Open**:
The ticket has not been assigned or rejected.

**Assigned**:
The ticket has an assignee who has not started, or it has just been given to a different assignee.

**In progress**:
The assignee is working the ticket.

**Resolved**:
The assignee has finished the work. The ticket can still be closed, or sent back to in progress with the same assignee.
_Avoid_: fixed, completed

**Closed**:
The creator or an admin has accepted the resolution. This is final. The same problem coming back is a new ticket.
_Avoid_: done, archived

**Rejected**:
An admin has refused an open ticket as not valid work. The creator or an admin may send it back to open.
_Avoid_: cancelled, declined, reopen

**Reopen**:
Sending a resolved ticket back to in progress. The assignee stays, and the recorded resolution is cleared. Undoing a rejection is not a reopen.
_Avoid_: appeal
