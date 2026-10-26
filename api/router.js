// One server function for all of Command. Vercel's free plan allows 12 functions per deployment, so every
// /api/... address comes here (see the rewrite in vercel.json) and is handed to its file in api/_routes.
export const ROUTES = {
  'ai/business-development': () => import('./_routes/ai/business-development.js'),
  'ai/ceo-briefing': () => import('./_routes/ai/ceo-briefing.js'),
  'ai/communications': () => import('./_routes/ai/communications.js'),
  'ai/email-draft-variants': () => import('./_routes/ai/email-draft-variants.js'),
  'ai/message-help': () => import('./_routes/ai/message-help.js'),
  'ai/team': () => import('./_routes/ai/team.js'),
  'applications': () => import('./_routes/applications/index.js'),
  'applications/answers': () => import('./_routes/applications/answers.js'),
  'applications/documents': () => import('./_routes/applications/documents.js'),
  'applications/download': () => import('./_routes/applications/download.js'),
  'applications/draft': () => import('./_routes/applications/draft.js'),
  'applications/export': () => import('./_routes/applications/export.js'),
  'applications/facts': () => import('./_routes/applications/facts.js'),
  'applications/response-search': () => import('./_routes/applications/response-search.js'),
  'applications/responses': () => import('./_routes/applications/responses.js'),
  'applications/submit': () => import('./_routes/applications/submit.js'),
  'applications/upload': () => import('./_routes/applications/upload.js'),
  'auth/login': () => import('./_routes/auth/login.js'),
  'auth/logout': () => import('./_routes/auth/logout.js'),
  'auth/session': () => import('./_routes/auth/session.js'),
  'calendar': () => import('./_routes/calendar.js'),
  'calendar/delete-event': () => import('./_routes/calendar/delete-event.js'),
  'calendar/river-approve': () => import('./_routes/calendar/river-approve.js'),
  'create-event': () => import('./_routes/create-event.js'),
  'crm/accounts': () => import('./_routes/crm/accounts.js'),
  'crm/activities': () => import('./_routes/crm/activities.js'),
  'crm/card-extract': () => import('./_routes/crm/card-extract.js'),
  'crm/contact-roles': () => import('./_routes/crm/contact-roles.js'),
  'crm/contacts': () => import('./_routes/crm/contacts.js'),
  'crm/email-drafts': () => import('./_routes/crm/email-drafts.js'),
  'crm/newsletter-audience': () => import('./_routes/crm/newsletter-audience.js'),
  'crm/opportunities': () => import('./_routes/crm/opportunities.js'),
  'crm/opportunity-hub': () => import('./_routes/crm/opportunity-hub.js'),
  'crm/suppressions': () => import('./_routes/crm/suppressions.js'),
  'cron/email-triage': () => import('./_routes/cron/email-triage.js'),
  'cron/funding': () => import('./_routes/cron/funding.js'),
  'cron/know-news': () => import('./_routes/cron/know-news.js'),
  'cron/linkedin-week': () => import('./_routes/cron/linkedin-week.js'),
  'cron/reviews': () => import('./_routes/cron/reviews.js'),
  'email': () => import('./_routes/email/index.js'),
  'finance': () => import('./_routes/finance/index.js'),
  'gmail-scan': () => import('./_routes/gmail-scan.js'),
  'gmail/action': () => import('./_routes/gmail/action.js'),
  'gmail/calendar-candidates': () => import('./_routes/gmail/calendar-candidates.js'),
  'gmail/intelligence': () => import('./_routes/gmail/intelligence.js'),
  'gmail/labels': () => import('./_routes/gmail/labels.js'),
  'gmail/message': () => import('./_routes/gmail/message.js'),
  'gmail/read': () => import('./_routes/gmail/read.js'),
  'gmail/reply-context': () => import('./_routes/gmail/reply-context.js'),
  'gmail/weekly-review': () => import('./_routes/gmail/weekly-review.js'),
  'heads-up': () => import('./_routes/heads-up/index.js'),
  'intelligence/radar': () => import('./_routes/intelligence/radar.js'),
  'know': () => import('./_routes/know/index.js'),
  'knowledge': () => import('./_routes/knowledge/index.js'),
  'linkedin': () => import('./_routes/linkedin/index.js'),
  'milestones': () => import('./_routes/milestones/index.js'),
  'newsletter/signup': () => import('./_routes/newsletter/signup.js'),
  'opportunities/kit': () => import('./_routes/opportunities/kit.js'),
  'opportunities/programs': () => import('./_routes/opportunities/programs.js'),
  'opportunities/quick-add': () => import('./_routes/opportunities/quick-add.js'),
  'opportunities/research': () => import('./_routes/opportunities/research.js'),
  'opportunities/watch': () => import('./_routes/opportunities/watch.js'),
  'river': () => import('./_routes/river.js'),
  'river-action': () => import('./_routes/river-action.js'),
  'river-tts': () => import('./_routes/river-tts.js'),
  'river/relationship': () => import('./_routes/river/relationship.js'),
  'river/screenshot': () => import('./_routes/river/screenshot.js'),
  'send-email': () => import('./_routes/send-email.js'),
  'settings': () => import('./_routes/settings/index.js'),
  'setup/database': () => import('./_routes/setup/database.js'),
  'today/hidden': () => import('./_routes/today/hidden.js'),
  'updates': () => import('./_routes/updates/index.js'),
  'work/items': () => import('./_routes/work/items.js'),
  'work/phases': () => import('./_routes/work/phases.js'),
  'work/projects': () => import('./_routes/work/projects.js'),
  'work/today': () => import('./_routes/work/today.js'),
};

export function routeFor(req) {
  const fromQuery = req.query?.__route;
  const raw = Array.isArray(fromQuery) ? fromQuery.join('/') : fromQuery;
  const fromUrl = String(req.url || '').split('?')[0].replace(/^\/api\//, '');
  return String(raw || fromUrl || '').replace(/^\/+|\/+$/g, '');
}

export default async function handler(req, res) {
  const route = routeFor(req);
  if (req.query) delete req.query.__route;
  const load = Object.prototype.hasOwnProperty.call(ROUTES, route) ? ROUTES[route] : null;
  if (!load) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'That page of Command does not exist.' } });
  const mod = await load();
  return mod.default(req, res);
}
