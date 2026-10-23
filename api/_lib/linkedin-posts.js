// LinkedIn for the founder's personal profile. Three posts a week (the Triple R mix):
// first post day a contrarian take (reach), second a framework or a real behind-the-scenes lesson (value),
// third a newsjack or a relationship builder that invites DMs (revenue). Topics rotate across the founder's brands
// and their founder story. Command writes drafts; the founder approves, copies and posts them.
import { aiText } from './ai.js';
import { DEFAULT_SETTINGS, founderSettings, firstName, knowledgeText, linkedinBrainDefault, linkedinTopics } from './founder-settings.js';

export const BRAIN_KEY = 'linkedin_brain';

// Starting point for the "LinkedIn brain", built from the Who you serve section of setup. The founder edits it on
// the LinkedIn card; their version wins.
export function defaultBrain(settings = DEFAULT_SETTINGS) { return linkedinBrainDefault(settings); }

export const POST_TYPES = {
  contrarian: { pillar: 'reach', label: 'Contrarian take', how: 'Open with a bold statement against a common belief. Explain why the usual wisdom falls short. Give her alternative view. Hooks that work: "Everyone says X, but here is why that is backwards." / "The biggest myth in [field] is..."' },
  framework: { pillar: 'value', label: 'Framework', how: 'Give the method a memorable name, then 3 to 5 clear steps, one short explanation each. Make it something a reader can use today.' },
  behind_scenes: { pillar: 'value', label: 'Behind the scenes', how: 'What happened, what she did right or wrong, the key takeaway, one piece of advice. Use ONLY the real events given below. Mistakes and turning points are welcome.' },
  newsjack: { pillar: 'reach', label: 'Newsjack', how: 'What happened in the news, what most people are missing, what it means for her readers, one takeaway. Use only the news given below.' },
  relationship: { pillar: 'revenue', label: 'Relationship builder', how: 'Share a direct point of view or offer, then end with one open question that invites the reader to name a real problem, or a clear DM trigger from the offers list.' },
};

function key(d) { return d.toISOString().slice(0, 10); }
function addDays(k, n) { const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return key(d); }
export function mondayOf(k) { const d = new Date(`${k}T12:00:00Z`); const back = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - back); return key(d); }

// The week's three posts, on the founder's post days (Monday, Wednesday, Friday unless setup says otherwise).
// Topics rotate each week so every brand gets every slot over time.
export function planWeek(monday, { hasStory = false, hasNews = false, settings = DEFAULT_SETTINGS } = {}) {
  const week = Math.floor(new Date(`${monday}T12:00:00Z`).getTime() / (7 * 86400000));
  const order = Object.keys(linkedinTopics(settings));
  const brand = (i) => order[(week + i) % order.length];
  const days = (settings?.schedule?.linkedin_post_days || [1, 3, 5]).map(Number).filter((d) => d >= 0 && d <= 6).slice(0, 3);
  while (days.length < 3) days.push([1, 3, 5][days.length]);
  const offset = (d) => (d + 6) % 7; // days after Monday
  const third = hasNews && week % 2 === 0 ? 'newsjack' : 'relationship';
  return [
    { post_date: addDays(monday, offset(days[0])), post_type: 'contrarian', topic: brand(0) },
    { post_date: addDays(monday, offset(days[1])), post_type: hasStory ? 'behind_scenes' : 'framework', topic: brand(1) },
    { post_date: addDays(monday, offset(days[2])), post_type: third, topic: brand(2) },
  ];
}

function rules(settings) {
  const name = firstName(settings);
  return `HOW THE LINKEDIN POSTS READ
- Short, punchy lines. A line break after almost every sentence. Blank lines between ideas.
- Plain words. No hashtags beyond 2 at the very end, or none.
- First line is the hook and must stand alone. 120 to 220 words in total.
- Sounds like ${name} talking, warm and direct. No hype, no buzzwords, no emojis.
- Never invent stories, clients, numbers or results. Use only what is given. If a detail is missing, leave a [square bracket] for ${name} to fill in.
- Value posts never pitch. Only the relationship builder may include an offer or DM trigger.
- Describe products at the level of feeling and benefit, never how they are built.`;
}

export function buildPrompt({ post, brain, stories = [], news = [], note = '', settings = DEFAULT_SETTINGS }) {
  const type = POST_TYPES[post.post_type] || POST_TYPES.framework;
  const name = firstName(settings);
  return {
    system: `${knowledgeText(settings)}\n\nTHE LINKEDIN BRAIN\n${brain}\n\n${rules(settings)}`,
    user: `Write one LinkedIn post for ${name}'s personal profile.
Post type: ${type.label} (${type.pillar}). ${type.how}
Topic: ${linkedinTopics(settings)[post.topic] || post.topic}.
${stories.length ? `REAL EVENTS FROM HER UPDATES (use only these for a story):\n${stories.map((s) => `- ${s}`).join('\n')}\n` : ''}${news.length ? `RECENT NEWS (use only these for a newsjack):\n${news.map((n) => `- ${n}`).join('\n')}\n` : ''}${note ? `${name.toUpperCase()}'S NOTE FOR THIS DRAFT: ${note}\n` : ''}
Before you answer, ask: "Would someone pay $1,000 for this insight?" If not, make it sharper and more specific until it would.
Return JSON only: {"body": "the post", "filter_pass": true or false, "filter_note": "one sentence on why it is worth $1,000, or what would make it stronger"}`,
  };
}

function cleanBody(text, settings = DEFAULT_SETTINGS) {
  const out = String(text || '').trim();
  return settings?.voice?.no_dashes ? out.replace(/\s*[—–]\s*/g, ', ').replace(/\s--\s/g, ', ') : out;
}

export async function writePost(args, { ai = aiText } = {}) {
  const prompt = buildPrompt(args);
  const run = async (extra = '') => {
    const raw = await ai({ system: prompt.system, user: prompt.user + extra, tier: 'write', maxTokens: 1200, temperature: 0.6 });
    return JSON.parse(String(raw || '').replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
  };
  let out = await run();
  if (out.filter_pass === false) out = await run(`\n\nYour last draft did not pass the $1,000 filter: ${out.filter_note || ''}. Write a sharper one.`);
  return { body: cleanBody(out.body, args.settings), filter_note: cleanBody(out.filter_note, args.settings).slice(0, 400) };
}

export async function readBrain(db, settings = null) {
  const row = await db.from('command_notes').select('body').eq('note_key', BRAIN_KEY).maybeSingle();
  return row.data?.body?.trim() || defaultBrain(settings || await founderSettings(db));
}

async function material(db) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [updates, news] = await Promise.all([
    db.from('command_updates').select('body,entry_date').is('deleted_at', null).gte('created_at', since).order('created_at', { ascending: false }).limit(8),
    db.from('command_knowledge_cards').select('prompt,answer,detail').eq('deck', 'news').eq('status', 'current').order('created_at', { ascending: false }).limit(5),
  ]);
  return {
    stories: (updates.data || []).map((u) => String(u.body || '').slice(0, 600)).filter(Boolean),
    news: (news.data || []).map((n) => [n.prompt, n.answer, n.detail].filter(Boolean).join(' ').slice(0, 500)),
  };
}

// Writes any missing drafts for the week starting on that Monday, and puts each post day on Today.
export async function ensureWeek(db, monday, { ai = aiText } = {}) {
  const existing = await db.from('command_linkedin_posts').select('post_date').gte('post_date', monday).lte('post_date', addDays(monday, 6));
  if (existing.error) throw existing.error;
  const have = new Set((existing.data || []).map((r) => r.post_date));
  const settings = await founderSettings(db);
  const brain = await readBrain(db, settings);
  const { stories, news } = await material(db);
  const plan = planWeek(monday, { hasStory: stories.length > 0, hasNews: news.length > 0, settings });
  const summary = { written: 0, failed: 0 };
  for (const post of plan) {
    if (have.has(post.post_date)) continue;
    try {
      const out = await writePost({ post, brain, settings, stories: post.post_type === 'behind_scenes' ? stories : [], news: post.post_type === 'newsjack' ? news : [] }, { ai });
      const saved = await db.from('command_linkedin_posts').insert({ ...post, pillar: POST_TYPES[post.post_type].pillar, body: out.body, filter_note: out.filter_note, status: 'draft' });
      if (saved.error) throw saved.error;
      await db.from('command_heads_up').upsert({
        source: 'linkedin', source_id: `linkedin:${post.post_date}`, source_updated: 'draft', title: `Post on LinkedIn: ${POST_TYPES[post.post_type].label}`,
        starts_at: `${post.post_date}T13:00:00Z`, all_day: false, location: null, join_link: null,
        heads_up: 'Your LinkedIn post is ready on the LinkedIn card in Work. Read it, approve it, then copy and post it.',
        prep: [{ text: 'Open Work and find today\'s LinkedIn post', done: false }, { text: 'Copy it and post it on LinkedIn', done: false }, { text: 'Reply to comments, then move good ones to a DM', done: false }],
        has_news: true, updated_at: new Date().toISOString(),
      }, { onConflict: 'source_id' });
      summary.written += 1;
    } catch (error) { summary.failed += 1; console.error('[LinkedIn]', error.message); }
  }
  return summary;
}

export async function rewritePost(db, id, note, { ai = aiText } = {}) {
  const row = await db.from('command_linkedin_posts').select('*').eq('id', id).single();
  if (row.error) throw row.error;
  const settings = await founderSettings(db);
  const brain = await readBrain(db, settings);
  const { stories, news } = await material(db);
  const post = row.data;
  const out = await writePost({ post, brain, settings, stories: post.post_type === 'behind_scenes' ? stories : [], news: post.post_type === 'newsjack' ? news : [], note }, { ai });
  const saved = await db.from('command_linkedin_posts').update({ body: out.body, filter_note: out.filter_note, status: 'draft', updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (saved.error) throw saved.error;
  return saved.data;
}
