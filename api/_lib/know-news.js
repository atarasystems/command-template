import { canonicalPublicUrl } from './web-search.js';
import { aiText } from './ai.js';
import { DEFAULT_SETTINGS, founderSettings, newsQueries } from './founder-settings.js';

// Know it news: once a week, a small batch of fresh news on the founder's topics becomes practice cards.
// Each card is written only from that article's own headline and summary, and links to the article.
// A card whose numbers are not in the article summary is left out. News cards retire after 60 days.

const SERPER_NEWS = 'https://google.serper.dev/news';
const PER_QUERY = 2;
const KEEP_DAYS = 60;

export async function searchNews(q, { apiKey = process.env.SERPER_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error('News search is not set up.'), { code: 'SERPER_NOT_CONFIGURED' });
  const r = await fetchImpl(SERPER_NEWS, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey }, body: JSON.stringify({ q, num: 10, tbs: 'qdr:w', gl: 'us', hl: 'en' }) });
  if (!r.ok) throw new Error(`News search returned ${r.status}`);
  const p = await r.json();
  return (p.news || []).map((n) => { let url = null; try { url = canonicalPublicUrl(n.link); } catch { return null; } return { title: String(n.title || '').trim(), snippet: String(n.snippet || '').trim(), url, source: String(n.source || '').trim(), date: n.date || '' }; }).filter((n) => n && n.title && n.snippet);
}

function numbersIn(text) { return (String(text).match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, '')); }
// Every number on the card has to be in the article's own words.
export function numbersMatch(card, article) {
  const have = new Set(numbersIn(`${article.title} ${article.snippet}`));
  return numbersIn(`${card.prompt} ${card.answer} ${card.detail}`).every((n) => have.has(n));
}

function systemFor(settings = DEFAULT_SETTINGS) {
  const what = settings?.company?.one_liner ? `the founder of ${settings.company.name || 'a company'} (${settings.company.one_liner})` : 'a founder';
  const level = settings?.voice?.reading_level ? `${settings.voice.reading_level} reading level` : 'an easy reading level';
  return `You turn one news article into one practice card for ${what}.
Use ONLY facts stated in the headline and summary given. Add nothing from memory. Never guess.
Plain words, ${level}.${settings?.voice?.no_dashes ? ' No em dashes or en dashes.' : ''}
Reply with JSON only: {"keep":true|false,"prompt":"a short question, under 16 words","answer":"the answer, under 8 words","detail":"one or two plain sentences with the key fact"}
Set keep to false when the article is an ad, a listicle, an opinion piece, a personal story with no news, about children only, or when the summary is too thin to make a clear fact.`;
}

export async function cardFromArticle(article, topic, { ai = aiText, settings = DEFAULT_SETTINGS } = {}) {
  const raw = await ai({ system: systemFor(settings), user: `Headline: ${article.title}\nSummary: ${article.snippet}\nOutlet: ${article.source}`, tier: 'fast', maxTokens: 400, temperature: 0.2 });
  let card;
  try { card = JSON.parse(String(raw).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch { return null; }
  if (!card || card.keep !== true || !card.prompt || !card.answer) return null;
  const clean = (s, max) => String(s || '').replace(/[–—]/g, ',').trim().slice(0, max);
  const out = { deck: 'news', topic, prompt: clean(card.prompt, 160), answer: clean(card.answer, 80), detail: clean(card.detail, 400) };
  if (!numbersMatch(out, article)) return null;
  return out;
}

export async function refreshNews(db, { now = new Date(), search = searchNews, ai = aiText, settings = null } = {}) {
  settings = settings || await founderSettings(db);
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  const retired = await db.from('command_knowledge_cards').update({ status: 'retired', updated_at: now.toISOString() }).eq('deck', 'news').eq('status', 'current').lt('created_at', cutoff).select('id');
  const seen = await db.from('command_knowledge_cards').select('source_url').eq('deck', 'news');
  const known = new Set((seen.data || []).map((r) => r.source_url));
  const today = now.toISOString().slice(0, 10);
  const added = [];
  for (const { topic, q } of newsQueries(settings)) {
    let articles = [];
    try { articles = await search(q); } catch (error) { console.error('[Know news search]', q, error.message); continue; }
    let kept = 0;
    for (const a of articles) {
      if (kept >= PER_QUERY) break;
      if (known.has(a.url)) continue;
      known.add(a.url);
      let card = null;
      try { card = await cardFromArticle(a, topic, { ai, settings }); } catch (error) { console.error('[Know news card]', error.message); }
      if (!card) continue;
      const row = { ...card, who: '', source: a.source || new URL(a.url).hostname, source_url: a.url, source_year: now.getUTCFullYear(), note: 'Written from the article summary. Open the link for the full story.', last_checked: today, sort_order: 0 };
      const ins = await db.from('command_knowledge_cards').insert(row);
      if (ins.error) { console.error('[Know news insert]', ins.error.message); continue; }
      kept += 1; added.push(card.prompt);
    }
  }
  return { added: added.length, retired: (retired.data || []).length };
}
