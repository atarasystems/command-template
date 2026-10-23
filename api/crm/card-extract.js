import { withCommandAuth } from '../_lib/auth.js';
import { aiJson } from '../_lib/ai.js';

const MAX_IMAGE_CHARS = 8 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,[A-Za-z0-9+/=\s]+$/;
const FIELDS = ['name', 'company', 'title', 'email', 'phone', 'website'];

function errorResponse(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

export const CARD_PROMPT = 'Read this business card. Return JSON only with these optional string fields: name, company, title, email, phone, website. Include only information visibly printed on the image. Do not infer, normalize into new facts, or fill missing fields. Use empty strings for fields not visible.';

export function cardFields(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The AI returned an invalid card');
  return Object.fromEntries(FIELDS.map(field => [field, typeof parsed[field] === 'string' ? parsed[field].trim() : '']).filter(([, value]) => value));
}

async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const imageData = req.body?.image_data;
  if (typeof imageData !== 'string' || imageData.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(imageData)) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'image_data must be a supported base64 image');
  }
  try {
    return res.status(200).json({ ok: true, data: { fields: cardFields(await aiJson({ prompt: CARD_PROMPT, images: [imageData], tier: 'fast', temperature: 0, maxTokens: 500 })) } });
  } catch (error) {
    console.error('[Card extraction]', error);
    if (error?.code === 'AI_NOT_CONFIGURED') return errorResponse(res, 503, error.code, error.message);
    return errorResponse(res, 502, 'CARD_READ_FAILED', 'The card could not be read. Try a clearer photo.');
  }
}

export default withCommandAuth(handler);
