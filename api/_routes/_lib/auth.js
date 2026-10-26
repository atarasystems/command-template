import './google-env.js';
import { founderSettings } from './founder-settings.js';
import { getSupabase } from './supabase.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'atara_command_session';
const SESSION_VERSION = 1;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function configurationError(name) {
  const error = new Error(`${name} is not configured`);
  error.code = 'AUTH_NOT_CONFIGURED';
  return error;
}

function sessionSecret() {
  const value = process.env.COMMAND_SESSION_SECRET;
  if (!value) throw configurationError('Command session authentication');
  return value;
}

function digest(value, secret = sessionSecret()) {
  return createHmac('sha256', secret).update(value).digest();
}

function safeEqual(left, right) {
  const leftDigest = createHmac('sha256', 'atara-command-password-check').update(left).digest();
  const rightDigest = createHmac('sha256', 'atara-command-password-check').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function cookieValue(req) {
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return value.join('=');
  }
  return null;
}

function cookieAttributes(maxAge) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  return [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ];
}

export function verifyCommandPassword(candidate) {
  const expected = process.env.COMMAND_PASSWORD;
  if (!expected) throw configurationError('Command password');
  return typeof candidate === 'string' && safeEqual(candidate, expected);
}

export function createCommandSession(now = Date.now()) {
  const payload = encode(JSON.stringify({
    v: SESSION_VERSION,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  }));
  return `${payload}.${digest(payload).toString('base64url')}`;
}

export function verifyCommandSession(req, now = Date.now()) {
  try {
    const token = cookieValue(req);
    if (!token) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return false;
    const actual = Buffer.from(signature, 'base64url');
    const expected = digest(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const parsed = JSON.parse(decode(payload));
    return parsed.v === SESSION_VERSION
      && Number.isInteger(parsed.exp)
      && parsed.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function setCommandSessionCookie(res, token) {
  const attributes = cookieAttributes(SESSION_TTL_SECONDS);
  attributes[0] = `${COOKIE_NAME}=${token}`;
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function clearCommandSessionCookie(res) {
  const attributes = cookieAttributes(0);
  attributes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function sendUnauthorized(res) {
  return res.status(401).json({
    ok: false,
    error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
  });
}

export function withCommandAuth(handler) {
  return async function authenticatedHandler(req, res) {
    if (!verifyCommandSession(req)) return sendUnauthorized(res);
    // Load the founder's settings (cached) so their time zone and writing rules apply to everything on this request.
    try {
      // Cached for a minute; capped so a slow database never holds up the request.
      await Promise.race([founderSettings(getSupabase()), new Promise((resolve) => { const t = setTimeout(resolve, 1500); t.unref?.(); })]);
    } catch { /* first run: no database yet */ }
    return handler(req, res);
  };
}
