const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ACCOUNT_TYPES = ['business', 'agency_partner', 'smb_support_org', 'referral_partner'];
export const PIPELINES = ['direct_audit', 'partner', 'institutional', 'referral'];
export const LEAD_SOURCES = ['google_ads', 'linkedin_launch', 'alignable', 'referral', 'warm_network', 'agency_outreach', 'organization_outreach', 'referral_partner_research', 'revenue_scout', 'manual', 'other'];
export const TRIGGERS = ['running_google_ads', 'new_website_launch', 'agency_partner_fit', 'smb_support_org', 'alignable_relationship', 'referral_partner_fit', 'warm_intro', 'other'];
export const OFFERS = ['seo_geo_audit', 'partner_pack_5', 'visibility_clinic', 'visibility_watch', 'referral_partnership', 'other'];
export const STAGES = ['new', 'researching', 'ready_for_review', 'approved_to_send', 'contacted', 'replied', 'interested', 'payment_sent', 'paid', 'audit_in_progress', 'delivered', 'follow_up', 'upsell', 'not_now', 'lost', 'do_not_contact'];
export const QUALIFICATION_GRADES = ['A', 'B', 'C'];
export const EVENT_STATUSES = ['pending', 'processing', 'completed', 'failed'];

export function fail(message, details) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  if (details) error.details = details;
  throw error;
}

export function requireUuid(value, name = 'id') {
  if (!UUID.test(value || '')) fail(`${name} must be a valid UUID`);
  return value;
}

export function optionalUuid(value, name) {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, name);
}

export function requiredText(value, name, max = 500) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) fail(`${name} is required`);
  if (result.length > max) fail(`${name} must be ${max} characters or fewer`);
  return result;
}

export function optionalText(value, name, max = 10000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(`${name} must be text`);
  const result = value.trim();
  if (result.length > max) fail(`${name} must be ${max} characters or fewer`);
  return result || null;
}

export function enumValue(value, name, allowed, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (!allowed.includes(value)) fail(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function emailValue(value, optional = true) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const email = requiredText(value, 'email', 320).toLowerCase();
  if (!EMAIL.test(email)) fail('email must be valid');
  return email;
}

export function moneyValue(value, name, optional = true) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 99999999.99) fail(`${name} must be a positive amount`);
  return Math.round(number * 100) / 100;
}

export function booleanValue(value, name) {
  if (typeof value !== 'boolean') fail(`${name} must be true or false`);
  return value;
}

export function integerValue(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) fail(`${name} must be a non-negative integer`);
  return number;
}

export function timestampValue(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${name} must be a valid date`);
  return date.toISOString();
}

export function dateValue(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(`${name} must be a valid date`);
  return value;
}

export function domainFromWebsite(website) {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    fail('website must be a valid URL or domain');
  }
}

export function pickDefined(input, schema) {
  const output = {};
  for (const [field, validate] of Object.entries(schema)) {
    if (Object.hasOwn(input, field)) output[field] = validate(input[field]);
  }
  return output;
}
