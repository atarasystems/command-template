import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { aiJson } from '../_lib/ai.js';
import { DEFAULT_SETTINGS, founderSettings, firstName, knowledgeText } from '../_lib/founder-settings.js';

function cleanText(value, max = 50000) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

function normalizeVersions(value) {
  const raw = Array.isArray(value) ? value : value?.versions;
  if (!Array.isArray(raw) || raw.length < 3) throw new Error('AI did not return three draft versions');
  const labels = ['Professional', 'Warm', 'Direct'];
  return raw.slice(0, 3).map((item, index) => ({
    label: cleanText(item?.label || labels[index], 80) || labels[index],
    subject: cleanText(item?.subject, 500),
    body: cleanText(item?.body, 50000),
  })).map(item => {
    if (!item.subject || !item.body) throw new Error('AI returned an incomplete draft');
    return item;
  });
}

async function loadContact(contactId, fallback = {}) {
  if (!contactId) return fallback || {};
  const db = getSupabase();
  const result = await db.from('crm_contacts')
    .select('id,full_name,first_name,last_name,email,job_title,notes,areas,interest,next_action,account:crm_accounts(name)')
    .eq('id', contactId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || fallback || {};
}

function draftPrompt(instruction, contact, settings = DEFAULT_SETTINGS) {
  const contactName = contact?.full_name || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null;
  const context = {
    name: contactName,
    email: contact?.email || null,
    title: contact?.job_title || contact?.title || null,
    company: contact?.account?.name || contact?.company || null,
    notes: contact?.notes || null,
    areas: contact?.areas || null,
    interest: contact?.interest || null,
    next_action: contact?.next_action || null,
  };

  const name = firstName(settings);
  return `You draft emails for ${name} to review and send.

${knowledgeText(settings)}

EXTRA RULES
- Do not invent facts, prior conversations, needs, results, credentials, or relationship history.
- If this is a warm introduction, name the referrer when the instruction or saved context provides one.
- Make each version fully ready to send${settings?.founder?.signoff ? `, signed "${settings.founder.signoff}"` : ''}.
- The three versions should differ meaningfully in tone while keeping the same facts.

${name.toUpperCase()}'S REQUEST:
${cleanText(instruction, 5000)}

SAVED CONTACT CONTEXT:
${JSON.stringify(context)}

Return exactly three versions labeled Professional, Warm, and Direct, as JSON: {"versions":[{"label":"Professional","subject":"...","body":"..."},{"label":"Warm","subject":"...","body":"..."},{"label":"Direct","subject":"...","body":"..."}]}`;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  try {
    const instruction = cleanText(req.body?.prompt, 5000);
    if (!instruction) return res.status(400).json({ ok: false, error: { message: 'Describe what you want the email to say.' } });
    const contact = await loadContact(req.body?.contact_id, req.body?.contact || {});
    const prompt = draftPrompt(instruction, contact, await founderSettings(getSupabase()));
    const versions = normalizeVersions(await aiJson({ prompt, temperature: 0.35, maxTokens: 2200 }));
    return res.status(200).json({ ok: true, data: { versions } });
  } catch (error) {
    console.error('[Email Draft Variants]', error.message);
    return res.status(500).json({ ok: false, error: { message: error.message || 'Draft generation failed' } });
  }
}

export default withCommandAuth(handler);
export const config = { maxDuration: 60 };
