import { createCommandSession, setCommandSessionCookie, verifyCommandPassword } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';

export default function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    const { password } = bodyOf(req);
    if (!verifyCommandPassword(password)) {
      return res.status(401).json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      });
    }
    setCommandSessionCookie(res, createCommandSession());
    return sendData(res, { authenticated: true });
  } catch (error) {
    return sendError(res, error);
  }
}
