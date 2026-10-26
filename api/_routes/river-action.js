// api/river-action.js
// Executes write actions that River requests. Writes go to Supabase (work, finance, CRM, programs, milestones).
// River outputs a <RIVER_ACTION> JSON block; the dashboard calls this endpoint.
import { withCommandAuth } from './_lib/auth.js';
import { getSupabase } from './_lib/supabase.js';
import { runRiverAction } from './_lib/river-actions.js';
import { routeAi, aiKey } from './_lib/ai.js';
import { companyName, firstName, founderSettings } from './_lib/founder-settings.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SECRET_KEY = process.env.SECRET_KEY;
  const ANTHROPIC_API_KEY = aiKey();

  // Handle sendMorningBrief separately.
  if (req.body?.action === 'sendMorningBrief') {
    return handleSendMorningBrief(
      req,
      res,
      ANTHROPIC_API_KEY,
      SECRET_KEY
    );
  }

  const { tool, payload } = req.body || {};

  if (!tool || !payload) {
    return res.status(400).json({
      error: 'tool and payload required',
    });
  }

  // River's writes land in Supabase, the same data Command shows.
  try {
    const result = await runRiverAction(getSupabase(), tool, payload);
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    const status = error?.code === 'VALIDATION_ERROR' ? 400 : 500;
    if (status === 500) console.error('[River action]', error);
    return res.status(status).json({ ok: false, error: error?.message || 'River action failed' });
  }
}

async function handleSendMorningBrief(
  req,
  res,
  ANTHROPIC_API_KEY,
  SECRET_KEY
) {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'AI is not connected. Add GEMINI_API_KEY in Vercel.',
    });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    return res.status(500).json({
      error: 'RESEND_API_KEY not configured',
    });
  }

  const dashboardContext = req.body.dashboardContext || '';
  let settings;
  try { settings = await founderSettings(getSupabase()); } catch { settings = null; }
  const name = firstName(settings);
  const company = companyName(settings);
  const assistant = settings?.assistant?.name || 'River';
  const toEmail = settings?.founder?.email || process.env.COMMAND_OWNER_EMAIL || '';
  if (!toEmail) {
    return res.status(400).json({ ok: false, error: { code: 'NO_EMAIL', message: 'Add your email address in setup (About you) first.' } });
  }

  try {
    const aiRes = await routeAi(fetch)(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',

          // Increased so Claude has enough room to complete
          // all article categories, recommendation, and footer.
          max_tokens: 6000,

          system: `
You are ${assistant}, ${name}'s personal AI assistant at ${company}.

Generate a complete morning briefing email in clean HTML with inline styles that work in Gmail and other email clients.

Use these colors:

Dark navy: #1C2B2B
Teal: #3D7A72
Light teal background: #F2F7F6
Light gray border: #D9E2E0
Main text: #263737

${settings?.voice?.no_dashes ? 'Do not use em dashes.\n' : ''}Do not use emojis.
Use positive, calm, professional language.
Output only raw HTML.
Do not include markdown.
Do not include triple backticks.
Do not include code fences.
Do not explain the email before or after the HTML.

The email must use a centered container with a maximum width of approximately 650 pixels.

Structure the email in this exact order:

HEADER

Create a dark navy header with generous padding.

Include:

"${company.toUpperCase()}" in small teal uppercase letters with wide letter spacing.

"Morning Briefing" as the large white headline.

Today's full date.

"PREPARED BY RIVER" in small teal uppercase text.

TOP PRIORITIES

Use the dashboard context to identify any overdue or due-today action items.

For every item, include the task name, owner, category, and due date when available.

Do not invent dashboard action items.

If there are no overdue or due-today items, say:

"The slate is clear for today. No action items are overdue and nothing is due today. A clean start to the day."

CONTACTS DUE FOR FOLLOW-UP

List every contact whose follow-up date is today or overdue.

Include the person's name, organization, reason for follow-up, and due date when available.

Do not invent contacts.

If none are due, say:

"No contacts are scheduled for follow-up today."

TICKLER ITEMS

List every tickler item scheduled for today or overdue.

Include the item and associated project when available.

Do not invent tickler items.

If none are due, say:

"Nothing has been tickled for today."

THIS WEEK

List the next two or three upcoming milestones found in the dashboard context.

Include the milestone name, date, project, and number of days remaining when available.

Do not replace real dashboard milestones with general advice.

If there are no upcoming milestones in the dashboard context, say:

"No upcoming milestones are currently logged in the dashboard. This is a great opportunity to map out the next targets and get them on the calendar."

CURATED ARTICLES

Include exactly three article categories.

The categories must be:

AI & TECH

${(settings?.audience?.news_topics || [])[0] ? String(settings.audience.news_topics[0]).toUpperCase() : 'YOUR INDUSTRY'}

SMALL BUSINESS & FOUNDERS

Include exactly two articles beneath each category.

That means there must be six articles total.

Each article must contain:

A bold article headline.

A one-sentence summary under 20 words.

A teal "READ MORE" link.

The link href must be:

https://www.google.com/search?q=

followed by the article headline encoded for use in a URL.

The articles should focus on timely, useful developments relevant to ${name} and ${company}.

Do not claim that ${assistant} personally verified or read an article unless that information appears in the supplied context.

Do not use fake publication names or fake URLs.

Use the Google search links as instructed.

${assistant.toUpperCase()}'S RECOMMENDATION

Add a dark navy box near the bottom.

Include a small teal heading:

"${assistant.toUpperCase()}'S RECOMMENDATION"

Under it, include one bold white sentence identifying the single most important action ${name} should take today.

The recommendation should be based primarily on the dashboard context.

If the dashboard has no urgent tasks, recommend one practical step connected to the nearest milestone or business priority.

FOOTER

End with centered text:

"Prepared by ${assistant}, ${name}'s Personal AI Assistant | ${company}"

Important completion rule:

You must finish all six articles, the recommendation, and the footer before ending your response.

Keep the HTML compact enough to fit within the output limit.

Do not stop after the first article category.

Do not leave any category empty.

Do not output partial HTML.
          `.trim(),

          messages: [
            {
              role: 'user',
              content:
                'Generate my complete morning briefing email using the dashboard information below.\n\n' +
                dashboardContext,
            },
          ],
        }),
      }
    );

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      const message =
        aiData?.error?.message ||
        'Anthropic request failed';

      return res.status(502).json({
        error: message,
      });
    }

    let briefingHtml =
      aiData.content
        ?.filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('') ||
      'River could not generate the briefing.';

    // Remove markdown fences if Claude adds them anyway.
    briefingHtml = briefingHtml
      .replace(/```html\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const emailRes = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Bearer ' + RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || `${assistant} <onboarding@resend.dev>`,

          to: [toEmail],

          subject:
            `Good morning ${name}: ` +
            new Date().toLocaleDateString(
              'en-US',
              {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              }
            ),

          html: briefingHtml,
        }),
      }
    );

    const emailData = await emailRes.json();

    if (!emailRes.ok || emailData.error) {
      return res.status(502).json({
        ok: false,
        error:
          emailData?.error?.message ||
          emailData?.message ||
          'Resend failed to send the email.',
      });
    }

    return res.status(200).json({
      ok: true,
      id: emailData.id,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
}

export default withCommandAuth(handler);

export const config = {
  maxDuration: 60,
};
