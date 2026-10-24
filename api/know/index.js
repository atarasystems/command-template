import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { refreshNews } from '../_lib/know-news.js';
import { aiJson } from '../_lib/ai.js';
import { BUCKET, acceptable, safePath, cardsFromFiles } from '../_lib/know-files.js';
import { founderSettings, knowledgeText } from '../_lib/founder-settings.js';

// Know it: the founder's facts to have ready (statistics, stakeholders). Practice moves each card along simple
// review boxes: a right answer waits longer before it comes back, a miss comes back soon.
const WAIT_DAYS = [0, 1, 3, 7, 14, 30];
export const DECKS = ['statistics', 'pitch', 'people', 'stakeholders'];
export const SETUP_SOURCE = 'Your Setup answers';

// One card the founder typed in. Prompt and answer stay short so they fit on a game tile.
export function cardFromInput(input = {}) {
  const deck = DECKS.includes(input.deck) ? input.deck : 'pitch';
  const prompt = String(input.prompt || '').trim().slice(0, 160);
  const answer = String(input.answer || '').trim().slice(0, 160);
  if (!prompt || !answer) throw Object.assign(new Error('Add a question and an answer.'), { status: 400, code: 'VALIDATION_ERROR' });
  return { deck, topic: String(input.topic || '').trim().slice(0, 60), prompt, answer, detail: String(input.detail || '').trim().slice(0, 600),
    source: String(input.source || '').trim().slice(0, 200) || null, status: 'current' };
}

export function setupCardsPrompt(knowledge) {
  return `You make study cards that help a founder know their own business by heart.
Use ONLY the facts below. Never add a number, name, date or claim that is not written there.
Write 8 to 16 cards. Each card has a short question and a short answer that fits on a small tile.
Decks: "pitch" (who they serve, the problem, what they offer, why it matters, their brands), "statistics" (only numbers written below; skip this deck when there are none), "stakeholders" (funders, partners or groups named below; skip when none).
Plain words. No dashes. Answers under 12 words. Questions under 14 words.

FACTS
${knowledge}

Return JSON only: {"cards":[{"deck":"pitch","topic":"2 or 3 words","prompt":"question","answer":"short answer","detail":"one sentence with more context"}]}`;
}

export function shapeSetupCards(parsed) {
  return (Array.isArray(parsed?.cards) ? parsed.cards : []).map((c) => {
    try { return { ...cardFromInput({ ...c, deck: ['pitch', 'statistics', 'stakeholders'].includes(c?.deck) ? c.deck : 'pitch' }), source: SETUP_SOURCE, note: 'Made from your Setup answers. Edit Setup or take out any card that feels off.' }; } catch { return null; }
  }).filter(Boolean).slice(0, 20);
}

export function nextReview(card, right, now = new Date()) {
  const box = right ? Math.min(WAIT_DAYS.length - 1, Number(card.box || 0) + 1) : 0;
  const due = new Date(now.getTime() + (right ? WAIT_DAYS[box] * 86400000 : 10 * 60000));
  return { box, due_at: due.toISOString(), times_seen: Number(card.times_seen || 0) + 1, times_right: Number(card.times_right || 0) + (right ? 1 : 0), updated_at: now.toISOString() };
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      let q = db.from('command_knowledge_cards').select('*').eq('status', 'current').order('deck').order('sort_order').order('created_at');
      if (req.query?.deck) q = q.eq('deck', String(req.query.deck));
      const rows = await q.limit(1000);
      if (rows.error) throw rows.error;
      return sendData(res, rows.data || []);
    }
    const body = bodyOf(req);
    if (body.action === 'answer') {
      const answers = Array.isArray(body.answers) ? body.answers : [{ id: body.id, right: body.right }];
      const ids = answers.map((a) => String(a.id || '')).filter(Boolean);
      if (!ids.length) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Nothing to save.' }, 400);
      const found = await db.from('command_knowledge_cards').select('id,box,times_seen,times_right').in('id', ids);
      if (found.error) throw found.error;
      const byId = new Map((found.data || []).map((c) => [c.id, c]));
      for (const a of answers) {
        const card = byId.get(String(a.id));
        if (!card) continue;
        const saved = await db.from('command_knowledge_cards').update(nextReview(card, a.right === true)).eq('id', card.id);
        if (saved.error) throw saved.error;
      }
      return sendData(res, { saved: ids.length });
    }
    // "Take this card out": it stops showing and stops coming up in games. Nothing is deleted.
    if (body.action === 'retire') {
      const id = String(body.id || '');
      if (!id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Which card?' }, 400);
      const saved = await db.from('command_knowledge_cards').update({ status: 'retired', updated_at: new Date().toISOString() }).eq('id', id);
      if (saved.error) throw saved.error;
      return sendData(res, { retired: id });
    }
    if (body.action === 'add') {
      const saved = await db.from('command_knowledge_cards').insert(cardFromInput(body.card)).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }
    // Cards made from Setup replace the last set made from Setup. Cards the founder typed stay.
    if (body.action === 'from_setup') {
      const knowledge = knowledgeText(await founderSettings(db));
      const made = shapeSetupCards(await aiJson({ prompt: setupCardsPrompt(knowledge), tier: 'write', maxTokens: 3000 }));
      if (!made.length) return sendError(res, { code: 'NOTHING_MADE', message: 'Add a few more Setup answers first, then try again.' }, 400);
      const old = await db.from('command_knowledge_cards').update({ status: 'retired', updated_at: new Date().toISOString() }).eq('source', SETUP_SOURCE).eq('status', 'current');
      if (old.error) throw old.error;
      const saved = await db.from('command_knowledge_cards').insert(made);
      if (saved.error) throw saved.error;
      return sendData(res, { added: made.length });
    }
    // Step 1 of adding files: a private one-time upload link for each file, so big decks skip the size limit here.
    if (body.action === 'upload_url') {
      const problem = acceptable(body.name, body.size);
      if (problem) return sendError(res, { code: 'VALIDATION_ERROR', message: problem }, 400);
      const made = await db.storage.from(BUCKET).createSignedUploadUrl(safePath(body.name));
      if (made.error) throw made.error;
      return sendData(res, { path: made.data.path, signed_url: made.data.signedUrl });
    }
    // Step 2: read the files, make cards, then remove the files. Cards from a file replace the last cards from that file.
    if (body.action === 'from_files') {
      const list = (Array.isArray(body.files) ? body.files : []).filter((f) => f && f.path && f.name).slice(0, 10);
      if (!list.length) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Add a file first.' }, 400);
      try {
        const files = [];
        for (const f of list) {
          const got = await db.storage.from(BUCKET).download(String(f.path));
          if (got.error) throw got.error;
          files.push({ name: String(f.name).slice(0, 120), buffer: Buffer.from(await got.data.arrayBuffer()) });
        }
        const made = await cardsFromFiles(files);
        if (!made.length) return sendError(res, { code: 'NOTHING_MADE', message: 'Command could not find facts in those files. Try a PDF of your deck or summary.' }, 400);
        const names = [...new Set(made.map((c) => c.source))];
        const old = await db.from('command_knowledge_cards').update({ status: 'retired', updated_at: new Date().toISOString() }).in('source', names).eq('status', 'current');
        if (old.error) throw old.error;
        const saved = await db.from('command_knowledge_cards').insert(made);
        if (saved.error) throw saved.error;
        return sendData(res, { added: made.length });
      } finally {
        await db.storage.from(BUCKET).remove(list.map((f) => String(f.path))).catch(() => {});
      }
    }
    if (body.action === 'refresh_news') return sendData(res, await refreshNews(db));
    return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown action.' }, 400);
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
