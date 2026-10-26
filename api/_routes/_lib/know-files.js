// Know it from the founder's own files: a pitch deck, executive summary, business model canvas, one pagers.
// Files go to private storage, Command reads them once to make cards, then the files are removed.
import JSZip from 'jszip';
import { aiJson } from './ai.js';

export const BUCKET = 'know-docs';
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 18 * 1024 * 1024;
const DECKS = ['pitch', 'statistics', 'stakeholders', 'people'];

const NATIVE = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const TEXT = ['txt', 'md', 'csv'];
const OFFICE = ['docx', 'pptx'];
export const ACCEPTED = [...Object.keys(NATIVE), ...TEXT, ...OFFICE];

export function extOf(name = '') { return String(name).toLowerCase().split('.').pop(); }
export function acceptable(name, size) {
  const ext = extOf(name);
  if (!ACCEPTED.includes(ext)) return `Command reads PDF, Word (.docx), PowerPoint (.pptx), pictures and text files. Save ${name} as a PDF and add it again.`;
  if (Number(size) > MAX_FILE_BYTES) return `${name} is larger than 15 MB. Save a smaller PDF and add it again.`;
  return '';
}
export function safePath(name) {
  const clean = String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'file';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;
}

function xmlText(xml, paragraphTag) {
  return String(xml).replace(new RegExp(`</${paragraphTag}>`, 'g'), '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
// Word and PowerPoint files are zip folders of XML. Pull the words out in reading order.
export async function officeText(buffer, ext) {
  const zip = await JSZip.loadAsync(buffer);
  if (ext === 'docx') return xmlText(await zip.file('word/document.xml')?.async('string') || '', 'w:p');
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = [];
  for (const [i, f] of slides.entries()) out.push(`Slide ${i + 1}\n${xmlText(await zip.file(f).async('string'), 'a:p')}`);
  return out.join('\n\n');
}

// Turns each file into something the AI can read: PDFs and pictures as they are, everything else as words.
export async function readableParts(files) {
  const pictures = []; const texts = [];
  let total = 0;
  for (const f of files) {
    const ext = extOf(f.name);
    total += f.buffer.byteLength;
    if (NATIVE[ext]) pictures.push({ name: f.name, url: `data:${NATIVE[ext]};base64,${Buffer.from(f.buffer).toString('base64')}` });
    else if (OFFICE.includes(ext)) texts.push({ name: f.name, text: (await officeText(f.buffer, ext)).slice(0, 60000) });
    else texts.push({ name: f.name, text: Buffer.from(f.buffer).toString('utf8').slice(0, 60000) });
  }
  if (total > MAX_TOTAL_BYTES) throw Object.assign(new Error('Those files are more than 18 MB together. Add them a few at a time.'), { status: 400, code: 'TOO_LARGE' });
  return { pictures, texts };
}

export function filesPrompt({ names, texts }) {
  return `You make study cards that help a founder know their own business by heart, from their own documents.
The documents are attached in this order: ${names.map((n, i) => `${i + 1}. ${n}`).join('; ')}.
Use ONLY what the documents say. Copy numbers exactly as written. Never add a number, name, date or claim that is not in them.
Write 10 to 30 cards across these decks:
"pitch": who they serve, the problem, the solution, what makes them different, the business model, pricing, the ask.
"statistics": every important number (market size, customers, revenue, growth, costs). Put the number in the answer.
"stakeholders": customers groups, partners, funders, investors and channels named in the documents.
"people": named team members, advisors or contacts, with their role.
Each card: a short question and a short answer that fits on a small tile. Answers under 12 words, questions under 14 words. Plain words. No dashes.
"file" is the number of the document the card came from.
${texts.map((t) => `\nDOCUMENT: ${t.name}\n${t.text}\n`).join('')}
Return JSON only: {"cards":[{"deck":"pitch","topic":"2 or 3 words","prompt":"question","answer":"short answer","detail":"one sentence with more context","file":1}]}`;
}

export function shapeFileCards(parsed, names) {
  return (Array.isArray(parsed?.cards) ? parsed.cards : []).map((c) => {
    const prompt = String(c?.prompt || '').trim().slice(0, 160); const answer = String(c?.answer || '').trim().slice(0, 160);
    if (!prompt || !answer) return null;
    const name = names[Number(c?.file) - 1] || names[0] || 'Your files';
    return { deck: DECKS.includes(c?.deck) ? c.deck : 'pitch', topic: String(c?.topic || '').trim().slice(0, 60), prompt, answer,
      detail: String(c?.detail || '').trim().slice(0, 600), source: name, note: 'Made from your file. Take out any card that feels off.', status: 'current' };
  }).filter(Boolean).slice(0, 40);
}

export async function cardsFromFiles(files, { ai = aiJson } = {}) {
  const { pictures, texts } = await readableParts(files);
  const names = [...pictures.map((p) => p.name), ...texts.map((t) => t.name)];
  const parsed = await ai({ prompt: filesPrompt({ names, texts }), images: pictures.map((p) => p.url), tier: 'write', maxTokens: 8000 });
  return shapeFileCards(parsed, names);
}
