import { withCommandAuth } from '../_lib/auth.js';
import { sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { companyName, founderSettings } from '../_lib/founder-settings.js';

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function safeFile(value) { return String(value || 'Application Record').replace(/[^a-z0-9 _.-]/gi,'').replace(/\s+/g,' ').trim(); }
function lines(value) { return esc(value).replace(/\r?\n/g,'<br>'); }

async function handler(req, res) {
  if (req.method !== 'GET') return sendError(res, { code:'METHOD_NOT_ALLOWED', message:'Method not allowed' }, 405);
  try {
    const id = req.query?.id;
    if (!id) return sendError(res, { code:'VALIDATION_ERROR', message:'id is required' });
    const db = getSupabase();
    const [appResult, answersResult, docsResult] = await Promise.all([
      db.from('command_applications').select('*').eq('id', id).single(),
      db.from('command_application_answers').select('*').eq('application_id', id).order('question_order'),
      db.from('command_application_documents').select('*').eq('application_id', id).order('created_at'),
    ]);
    if (appResult.error) throw appResult.error;
    if (answersResult.error) throw answersResult.error;
    if (docsResult.error) throw docsResult.error;
    const app = appResult.data;
    const answerRows = (answersResult.data || []).map((row) => {
      const answer = row.submitted_answer_text || row.answer_text || '';
      return `<section class="qa"><h2>${row.question_order ? `${row.question_order}. ` : ''}${esc(row.question_text)}</h2><div class="answer">${lines(answer)}</div><div class="meta">Topic: ${esc(row.topic || 'general')} | Status: ${esc(row.answer_status || 'draft')}</div></section>`;
    }).join('');
    const docs = (docsResult.data || []).length ? `<h2>Documents submitted / attached</h2><ul>${docsResult.data.map((doc) => `<li><strong>${esc(doc.name)}</strong>${doc.document_type ? ` (${esc(doc.document_type)})` : ''}${doc.file_url ? ` | ${esc(doc.file_url)}` : ''}${doc.is_submitted ? ' | submitted' : ''}</li>`).join('')}</ul>` : '';
    const company = companyName(await founderSettings(db));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(app.title)}</title><style>body{font-family:Arial,sans-serif;color:#243247;font-size:11pt;line-height:1.45;margin:36pt}h1{font-size:22pt;margin-bottom:4pt}h2{font-size:13pt;margin:20pt 0 7pt}.sub{color:#64748b;margin-bottom:18pt}.summary{border:1px solid #dce3ea;background:#f7f9fb;padding:12pt;margin-bottom:22pt}.qa{page-break-inside:avoid;border-top:1px solid #dce3ea;padding-top:5pt}.answer{white-space:normal}.meta{font-size:9pt;color:#64748b;margin-top:7pt}ul{padding-left:20pt}li{margin-bottom:6pt}</style></head><body><h1>${esc(app.title)}</h1><div class="sub">${esc(company)} | Application Record</div><div class="summary"><strong>Organization:</strong> ${esc(app.organization || '')}<br><strong>Status:</strong> ${esc(app.status)}<br><strong>Application type:</strong> ${esc(app.application_type || '')}<br><strong>Deadline:</strong> ${esc(app.deadline_at || '')}<br><strong>Submitted:</strong> ${esc(app.submitted_at || '')}<br><strong>Application URL:</strong> ${esc(app.application_url || '')}</div>${answerRows || '<p>No answers saved.</p>'}${docs}</body></html>`;
    const filename = `${safeFile(`${company} ${app.title} Application Record`)}.doc`;
    res.setHeader('Content-Type','application/msword; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    return res.status(200).send(html);
  } catch (error) { return sendError(res, error); }
}
export default withCommandAuth(handler);
