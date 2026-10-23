import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'atara_command_session';

function cookieValue(req) {
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return value.join('=');
  }
  return '';
}

function encode(value) { return Buffer.from(value, 'utf8').toString('base64url'); }
function decode(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function secret() { if (!process.env.COMMAND_SESSION_SECRET) throw new Error('Command session authentication is not configured'); return process.env.COMMAND_SESSION_SECRET; }
function binding(req) { return createHash('sha256').update(cookieValue(req)).digest('base64url'); }
function signature(payload) { return createHmac('sha256', secret()).update(payload).digest('base64url'); }
function validSignature(supplied, expected) { const left = Buffer.from(String(supplied || ''), 'base64url'); const right = Buffer.from(expected, 'base64url'); return left.length === right.length && timingSafeEqual(left, right); }

export function createPendingCalendarAction(req, candidates) {
  const payload = encode(JSON.stringify({ v: 1, exp: Date.now() + TOKEN_TTL_MS, binding: binding(req), candidates }));
  return `${payload}.${signature(payload)}`;
}

export function createPendingSenderResolution(req, requested, candidates) {
  const payload = encode(JSON.stringify({ v: 1, kind: 'sender-resolution', exp: Date.now() + TOKEN_TTL_MS, binding: binding(req), requested, candidates }));
  return `${payload}.${signature(payload)}`;
}

export function createPendingEmailRead(req, message) {
  const payload = encode(JSON.stringify({ v: 1, kind: 'email-read', exp: Date.now() + TOKEN_TTL_MS, binding: binding(req), message }));
  return `${payload}.${signature(payload)}`;
}

export function verifyPendingCalendarAction(req, token) {
  try {
    const [payload, supplied, extra] = String(token || '').split('.');
    if (!payload || !supplied || extra || !validSignature(supplied, signature(payload))) return null;
    const data = JSON.parse(decode(payload));
    if (data.v !== 1 || data.exp <= Date.now() || data.binding !== binding(req) || !Array.isArray(data.candidates)) return null;
    return { ...data, tokenHash: createHash('sha256').update(String(token)).digest('hex') };
  } catch (_) { return null; }
}

export function verifyPendingSenderResolution(req, token) {
  try {
    const [payload, supplied, extra] = String(token || '').split('.');
    if (!payload || !supplied || extra || !validSignature(supplied, signature(payload))) return null;
    const data = JSON.parse(decode(payload));
    if (data.v !== 1 || data.kind !== 'sender-resolution' || data.exp <= Date.now() || data.binding !== binding(req) || !Array.isArray(data.candidates)) return null;
    return data;
  } catch (_) { return null; }
}

export function verifyPendingEmailRead(req, token) {
  try {
    const [payload, supplied, extra] = String(token || '').split('.');
    if (!payload || !supplied || extra || !validSignature(supplied, signature(payload))) return null;
    const data = JSON.parse(decode(payload));
    if (data.v !== 1 || data.kind !== 'email-read' || data.exp <= Date.now() || data.binding !== binding(req) || !data.message?.message_id) return null;
    return data;
  } catch (_) { return null; }
}

export function calendarEventId(tokenHash, index) {
  return createHash('sha256').update(`${tokenHash}:${index}`).digest('hex').slice(0, 26);
}

export const pendingCalendarActionTtlMs = TOKEN_TTL_MS;
