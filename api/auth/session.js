import { verifyCommandSession } from '../_lib/auth.js';
import { allowMethods, sendData } from '../_lib/http.js';

export default function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  return sendData(res, { authenticated: verifyCommandSession(req) });
}
