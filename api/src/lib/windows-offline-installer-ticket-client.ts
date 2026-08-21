export interface OpenPathEnrollmentTicketRequest {
  openpathUrl: string;
  classroomId: string;
  expiresIn: string;
  accessToken: string;
}

export interface OpenPathEnrollmentTicket {
  enrollmentToken: string;
  expiresAt: string;
  classroomId: string;
  classroomName: string;
}

interface TicketResponseBody {
  success?: boolean;
  error?: string;
  enrollmentToken?: unknown;
  expiresAt?: unknown;
  classroomId?: unknown;
  classroomName?: unknown;
}

/**
 * Calls the generic OpenPath enrollment-ticket REST endpoint with an explicit
 * TTL. ClassroomPath never sees OpenPath's JWT secret; it only forwards the
 * teacher's access token and receives a signed ticket.
 */
export async function callOpenPathEnrollmentTicket(
  request: OpenPathEnrollmentTicketRequest
): Promise<OpenPathEnrollmentTicket> {
  const base = request.openpathUrl.replace(/\/+$/, '');
  const url = `${base}/api/enroll/${encodeURIComponent(request.classroomId)}/ticket`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${request.accessToken}`,
    },
    body: JSON.stringify({ expiresIn: request.expiresIn }),
  });

  let body: TicketResponseBody = {};
  try {
    body = (await response.json()) as TicketResponseBody;
  } catch {
    // fall through to status handling
  }

  if (!response.ok) {
    throw new Error(
      `OpenPath enrollment ticket request failed (${response.status}): ${body.error ?? 'unknown error'}`
    );
  }

  if (
    typeof body.enrollmentToken !== 'string' ||
    body.enrollmentToken.length === 0 ||
    typeof body.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(body.expiresAt))
  ) {
    throw new Error('OpenPath returned an incomplete enrollment ticket');
  }

  return {
    enrollmentToken: body.enrollmentToken,
    expiresAt: body.expiresAt,
    classroomId: typeof body.classroomId === 'string' ? body.classroomId : request.classroomId,
    classroomName: typeof body.classroomName === 'string' ? body.classroomName : '',
  };
}
