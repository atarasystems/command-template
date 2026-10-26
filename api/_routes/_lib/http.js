export function sendData(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

export function sendError(res, error, status) {
  const code = error?.code || 'INTERNAL_ERROR';
  // An error Command raised on purpose carries its own status and a plain message for the founder: show it.
  const chosen = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : null;
  const publicStatus = status || chosen || statusForCode(code);
  const message = publicStatus >= 500
    ? (error?.safeMessage || (chosen || code === 'CRM_NOT_CONFIGURED' ? error.message : 'Something went wrong on our side. Try again in a minute.'))
    : error.message;

  if (publicStatus >= 500 && code !== 'CRM_NOT_CONFIGURED') {
    console.error('[Revenue CRM]', error);
  }

  return res.status(publicStatus).json({
    ok: false,
    error: {
      code,
      message,
      ...(publicStatus < 500 && error?.details ? { details: error.details } : {}),
      ...(publicStatus >= 500 && error?.safeDetails ? { details: error.safeDetails } : {}),
    },
  });
}

export function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  sendError(res, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  return false;
}

export function bodyOf(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    const error = new Error('A JSON object is required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return req.body;
}

export function throwIfError(error) {
  if (error) throw error;
}

function statusForCode(code) {
  if (code === 'AUTH_NOT_CONFIGURED') return 500;
  if (code === 'VALIDATION_ERROR' || code === '22P02' || code === '22023') return 400;
  if (code === 'NOT_FOUND' || code === 'PGRST116') return 404;
  if (code === '23505') return 409;
  return 500;
}
