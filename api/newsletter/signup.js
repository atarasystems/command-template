import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { assertExplicitConsent, assertPublicSource, silentPublicBlock, upsertExplicitSubscription } from '../_lib/newsletter.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) throw Object.assign(new Error('JSON request required'), { code: 'VALIDATION_ERROR' });
    if (Number(req.headers?.['content-length'] || 0) > 32000) throw Object.assign(new Error('Request is too large'), { code: 'VALIDATION_ERROR' });
    const input = bodyOf(req);
    if (typeof input.website === 'string' && input.website.trim()) throw Object.assign(new Error('Request could not be accepted'), { code: 'VALIDATION_ERROR' });
    assertExplicitConsent(input.explicit_consent);
    const consentSource = assertPublicSource(input.consent_source);
    if (!Array.isArray(input.segment_keys) || input.segment_keys.length < 1 || input.segment_keys.length > 3) throw Object.assign(new Error('Choose between one and three audiences'), { code: 'VALIDATION_ERROR' });
    const result = await upsertExplicitSubscription({ email: input.email, fullName: input.full_name, segmentKeys: input.segment_keys, consentSource, publicRequest: true });
    return sendData(res, { accepted: true }, 201);
  } catch (error) {
    if (error?.code === 'NEWSLETTER_SILENT_ACCEPT') return sendData(res, { accepted: true }, 202);
    return sendError(res, error);
  }
}
