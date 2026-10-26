import { aiJson } from '../_lib/ai.js';
import { founderSettings, firstName, companyName, knowledgeText, cleanText } from '../_lib/founder-settings.js';
import { withCommandAuth } from '../_lib/auth.js';
import { sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';


async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, { code:'METHOD_NOT_ALLOWED', message:'Method not allowed' }, 405);
  try {
    const { application_id, question_text, topic = 'general', max_characters = null, tone_note = '' } = req.body || {};
    if (!application_id || !question_text) return sendError(res, { code:'VALIDATION_ERROR', message:'application_id and question_text are required' });
    const db = getSupabase();
    const [appResult, factsResult, priorResult] = await Promise.all([
      db.from('command_applications').select('*').eq('id', application_id).single(),
      db.from('command_company_facts').select('fact_key,label,category,value_text,status,source_note,last_verified_at').eq('status','current').order('category'),
      db.from('command_application_answers').select('question_text,topic,answer_text,submitted_answer_text,answer_status,command_applications(title,organization,submitted_at)').in('answer_status',['approved','submitted']).order('updated_at',{ascending:false}).limit(40),
    ]);
    if (appResult.error) throw appResult.error;
    if (factsResult.error) throw factsResult.error;
    if (priorResult.error) throw priorResult.error;
    const prior = (priorResult.data || []).filter((row) => row.topic === topic || topic === 'general').slice(0, 8).map((row) => ({
      question: row.question_text,
      answer: row.submitted_answer_text || row.answer_text,
      source_application: row.command_applications?.title || null,
      source_status: row.answer_status,
    }));
    const maxInstruction = max_characters ? `Hard character limit: ${Number(max_characters)} characters including spaces. Stay safely under it.` : 'No explicit character limit was supplied.';
    const settings = await founderSettings(db);
    const prompt = `You are preparing one application answer for ${companyName(settings)}. This is founder-review preparation only. Do not submit anything or change records.\n\n${knowledgeText(settings)}\n\nWrite in ${firstName(settings)}'s application voice: human, vivid, specific, confident without hype, emotionally clear when useful, and easy to scan. Do not sound like generic startup copy. Avoid inflated claims, investor jargon, fake certainty, and AI filler.\n\nGrounding rules:\n1. Use current company facts as the factual source of truth.\n2. Prior answers are style and context references, not automatically current facts. If a prior answer conflicts with current facts, current facts win.\n3. Never invent traction, customers, revenue, validation, partnerships, clinical outcomes, patents, pricing, market figures, dates, credentials, or product capabilities.\n4. If the question asks for something unsupported, say what is known without pretending.\n5. ${maxInstruction}\n\nApplication: ${appResult.data.title}\nOrganization: ${appResult.data.organization || ''}\nQuestion topic: ${topic}\nQuestion: ${question_text}\n${tone_note ? `Extra founder direction: ${tone_note}\n` : ''}\nCURRENT COMPANY FACTS:\n${JSON.stringify(factsResult.data || [])}\n\nRELEVANT PRIOR APPROVED OR SUBMITTED ANSWERS:\n${JSON.stringify(prior)}\n\nReturn JSON only with exactly these fields:\n{\n  "answer": "ready-for-founder-review answer",\n  "cautions": ["anything the founder should verify before using"],\n  "reused_from": ["source application names if prior wording materially informed the draft"]\n}`;
    const parsed = await aiJson({ prompt, temperature: 0.25, maxTokens: 1300 });
    parsed.answer = String(parsed.answer || '');
    parsed.cautions = Array.isArray(parsed.cautions) ? parsed.cautions : [];
    parsed.reused_from = Array.isArray(parsed.reused_from) ? parsed.reused_from : [];
    parsed.answer = cleanText(settings, parsed.answer);
    if (max_characters && parsed.answer.length > Number(max_characters)) return sendError(res, { code:'CHARACTER_LIMIT', message:'Draft exceeded the requested character limit. Try again with a shorter direction.' }, 400);
    return sendData(res, parsed);
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
