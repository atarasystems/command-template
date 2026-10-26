import { clearCommandSessionCookie } from '../_lib/auth.js';
import { allowMethods, sendData } from '../_lib/http.js';

export default function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  clearCommandSessionCookie(res);
  return sendData(res, { authenticated: false });
}
