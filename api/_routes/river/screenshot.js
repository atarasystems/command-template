import { createHash } from 'node:crypto';
import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { createPendingCalendarAction } from '../_lib/river-calendar-action.js';
import { getGoogleAccessToken, listGoogleCalendarEvents } from '../_lib/google-calendar.js';
import { eventOverlaps } from '../_lib/calendar-email.js';
import { aiJson } from '../_lib/ai.js';
import { founderSettings, firstName, envTimeZone } from '../_lib/founder-settings.js';

const OPPORTUNITY_TYPES = ['grant', 'accelerator', 'pitch_competition', 'procurement', 'funding', 'fellowship', 'program', 'other'];
const PROGRAM_STATUSES = ['discovered', 'reviewing', 'apply', 'in_progress', 'submitted', 'awaiting_response', 'interview', 'final_decision', 'awarded', 'not_selected', 'archived'];

function clean(value, max = 6000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replace(/[\u2013\u2014]/g, '-');
  return text ? text.slice(0, max) : null;
}

function responseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => item.text || '')
    .join('');
}

function parseJson(text) {
  return JSON.parse(String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
}

function validImageData(value) {
  const text = String(value || '');
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(text)) return null;
  if (text.length > 4_200_000) return null;
  return text;
}

function explicitOpportunityWrite(text) {
  return /\b(add|save|log|put)\b[\s\S]{0,120}\b(opportunity|pipeline|program|accelerator|grant|funding)\b/i.test(String(text || ''));
}

function explicitCalendarWrite(text) {
  return /\b(add|save|put|log)\b[\s\S]{0,120}\b(date|dates|calendar|event|events|deadline|deadlines|meeting|meetings)\b/i.test(String(text || ''));
}

const SCREENSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    screenshot_text: { type: 'string' },
    opportunity: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            organization: { type: ['string', 'null'] },
            opportunity_type: { type: 'string', enum: OPPORTUNITY_TYPES },
            status: { type: 'string', enum: PROGRAM_STATUSES },
            amount_text: { type: ['string', 'null'] },
            deadline_at: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
          },
          required: ['title', 'organization', 'opportunity_type', 'status', 'amount_text', 'deadline_at', 'notes'],
        },
      ],
    },
    calendar_candidates: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          date: { type: 'string' },
          start_time: { type: ['string', 'null'] },
          end_time: { type: ['string', 'null'] },
          all_day: { type: 'boolean' },
          deadline: { type: 'boolean' },
          location: { type: ['string', 'null'] },
          meeting_url: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
        },
        required: ['title', 'date', 'start_time', 'end_time', 'all_day', 'deadline', 'location', 'meeting_url', 'description'],
      },
    },
  },
  required: ['summary', 'screenshot_text', 'opportunity', 'calendar_candidates'],
};

async function analyzeScreenshot(instruction, imageData) {
  const settings = await founderSettings(getSupabase());
  const name = firstName(settings);
  const assistantName = settings.assistant?.name || 'River';
  const prompt = `You are the screenshot-reading layer of ${assistantName}, the founder's assistant inside Command. Read the screenshot carefully and extract only facts that are actually visible. ${name}'s instruction is: ${clean(instruction, 3000) || 'Read this screenshot.'}

Rules:
- Never invent a deadline, amount, URL, organization, time, location, application status, or program detail.
- If the screenshot says an application was received/submitted, status may be submitted.
- If it is an accelerator, use opportunity_type accelerator. Use only the allowed opportunity types.
- For calendar candidates, include only dates/times actually visible in the screenshot. A season or month without a specific date is not a calendar candidate.
- If a date has no time, make it all_day true and start_time/end_time null.
- For a deadline, use a title that clearly says what the deadline is for.
- summary should be a short factual description of what River can see.
- screenshot_text should contain a concise transcription of the important visible text, not every decorative word.
- opportunity may be null if this is not a program/funding/application opportunity.
- calendar_candidates may be empty.

The local time zone is ${envTimeZone()}.\n\nReturn JSON only in this shape: ${JSON.stringify(SCREENSHOT_SCHEMA.properties)} with required keys ${SCREENSHOT_SCHEMA.required.join(', ')}.`;

  return aiJson({ prompt, images: [imageData], temperature: 0, maxTokens: 1800 });
}

async function upsertOpportunity(analysis, screenshotHash) {
  const opportunity = analysis?.opportunity;
  if (!opportunity?.title) return null;

  const db = getSupabase();
  let query = db.from('crm_program_opportunities').select('*').ilike('title', opportunity.title).limit(1);
  if (opportunity.organization) query = query.ilike('organization', opportunity.organization);
  const existing = await query.maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { row: existing.data, created: false };

  let deadlineAt = null;
  if (opportunity.deadline_at) {
    const parsed = new Date(opportunity.deadline_at);
    if (!Number.isNaN(parsed.getTime())) deadlineAt = parsed.toISOString();
  }

  const values = {
    opportunity_type: OPPORTUNITY_TYPES.includes(opportunity.opportunity_type) ? opportunity.opportunity_type : 'other',
    title: clean(opportunity.title, 500),
    organization: clean(opportunity.organization, 500),
    source_type: 'river_screenshot',
    source_id: `screenshot:${screenshotHash.slice(0, 32)}`,
    amount_text: clean(opportunity.amount_text, 500),
    status: PROGRAM_STATUSES.includes(opportunity.status) ? opportunity.status : 'discovered',
    deadline_at: deadlineAt,
    submitted_at: opportunity.status === 'submitted' ? new Date().toISOString() : null,
    notes: [
      clean(opportunity.notes, 3000),
      clean(analysis.screenshot_text, 3000),
      'Captured by River from a screenshot. The screenshot image itself is not stored in Command.',
    ].filter(Boolean).join('\n\n'),
  };

  const created = await db.from('crm_program_opportunities').insert(values).select('*').single();
  if (created.error) throw created.error;
  return { row: created.data, created: true };
}

async function prepareCalendar(req, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return { candidates: [], action_token: null };

  let calendarToken = null;
  try {
    calendarToken = await getGoogleAccessToken();
  } catch (_) {}

  const enriched = [];
  for (const raw of candidates) {
    const candidate = {
      title: clean(raw.title, 500) || 'Calendar item',
      date: clean(raw.date, 20),
      start_time: clean(raw.start_time, 10),
      end_time: clean(raw.end_time, 10),
      all_day: raw.all_day === true,
      deadline: raw.deadline === true,
      location: clean(raw.location, 500),
      meeting_url: clean(raw.meeting_url, 1000),
      description: clean(raw.description, 3000),
      source_sender: 'River screenshot',
    };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.date || '')) continue;

    let duplicate = false;
    if (calendarToken) {
      try {
        const next = new Date(`${candidate.date}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        const existing = await listGoogleCalendarEvents(
          calendarToken,
          `${candidate.date}T00:00:00-04:00`,
          `${next.toISOString().slice(0, 10)}T00:00:00-04:00`,
        );
        duplicate = existing.some((event) => eventOverlaps(candidate, event));
      } catch (_) {}
    }

    enriched.push({ ...candidate, duplicate });
  }

  return {
    candidates: enriched,
    action_token: enriched.length ? createPendingCalendarAction(req, enriched) : null,
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  }

  try {
    const instruction = clean(req.body?.instruction, 3000) || 'Read this screenshot.';
    const imageData = validImageData(req.body?.image_data);
    if (!imageData) {
      return res.status(400).json({ ok: false, error: { message: 'Attach a PNG, JPEG, or WebP screenshot under the size limit.' } });
    }

    const analysis = await analyzeScreenshot(instruction, imageData);
    const hash = createHash('sha256').update(imageData).digest('hex');
    const wantsOpportunity = explicitOpportunityWrite(instruction);
    const wantsCalendar = explicitCalendarWrite(instruction);

    const opportunityResult = wantsOpportunity && analysis.opportunity
      ? await upsertOpportunity(analysis, hash)
      : null;

    const calendar = wantsCalendar
      ? await prepareCalendar(req, analysis.calendar_candidates || [])
      : { candidates: analysis.calendar_candidates || [], action_token: null };

    return res.status(200).json({
      ok: true,
      data: {
        summary: clean(analysis.summary, 2000),
        screenshot_text: clean(analysis.screenshot_text, 4000),
        opportunity: analysis.opportunity || null,
        opportunity_result: opportunityResult
          ? {
              id: opportunityResult.row.id,
              title: opportunityResult.row.title,
              organization: opportunityResult.row.organization,
              status: opportunityResult.row.status,
              created: opportunityResult.created,
            }
          : null,
        calendar_candidates: calendar.candidates,
        calendar_action_token: calendar.action_token,
        requested: { opportunity: wantsOpportunity, calendar: wantsCalendar },
      },
    });
  } catch (error) {
    const status = error?.code === 'AI_NOT_CONFIGURED' ? 503 : 500;
    console.error('[River Screenshot]', error.message);
    return res.status(status).json({ ok: false, error: { message: error.message || 'River could not read this screenshot.' } });
  }
}

export default withCommandAuth(handler);
export const config = { maxDuration: 60 };
