import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

const TABLES = {
  decisions: 'command_decisions',
  docs: 'command_living_docs',
  exports: 'command_export_documents',
  prompts: 'command_prompts',
};

// These are the columns in the already-applied create_command_knowledge_layer migration.
const FIELDS = {
  decisions: ['decision_date', 'decision', 'why', 'areas_affected', 'docs_affected', 'work_created', 'update_status'],
  docs: ['name', 'document_type', 'business_area', 'canonical_live_link', 'purpose', 'is_canonical', 'owner', 'last_reviewed_at', 'last_materially_updated_at', 'needs_update', 'needs_update_reason', 'related_project_product', 'revision_change_notes'],
  exports: ['living_doc_id', 'name', 'export_type', 'file_url', 'is_current', 'exported_at', 'notes'],
  prompts: ['name', 'purpose', 'use_in', 'prompt_text', 'favorite', 'show_today', 'recurring_use_label', 'last_copied_at'],
};

function values(kind, body) {
  return Object.fromEntries((FIELDS[kind] || []).filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  try {
    const db = getSupabase();
    const kind = req.query?.kind || 'all';

    if (req.method === 'GET') {
      const kinds = kind === 'all' ? Object.keys(TABLES) : [kind];
      if (!kinds.every((item) => TABLES[item])) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown knowledge type' });
      const rows = await Promise.all(kinds.map(async (item) => {
        const orderBy = item === 'decisions' ? 'decision_date' : item === 'exports' ? 'exported_at' : 'updated_at';
        const result = await db.from(TABLES[item]).select('*').order(orderBy, { ascending: false, nullsFirst: false });
        if (result.error) throw result.error;
        return [item, result.data || []];
      }));
      return sendData(res, Object.fromEntries(rows));
    }

    const body = bodyOf(req);
    const item = body.kind || kind;
    if (!TABLES[item]) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown knowledge type' });

    if (req.method === 'POST') {
      const input = values(item, body);
      if ((item === 'decisions' && !input.decision) || (item !== 'decisions' && !input.name)) return sendError(res, { code: 'VALIDATION_ERROR', message: item === 'decisions' ? 'decision is required' : 'name is required' });
      if (item === 'prompts' && !input.prompt_text) return sendError(res, { code: 'VALIDATION_ERROR', message: 'prompt_text is required' });
      if (item === 'exports' && (!input.export_type || !input.file_url)) return sendError(res, { code: 'VALIDATION_ERROR', message: 'export_type and file_url are required' });
      if (item === 'prompts' && !input.use_in) input.use_in = 'Other';
      const result = await db.from(TABLES[item]).insert(input).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data, 201);
    }

    if (!body.id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'id is required' });
    if (req.method === 'DELETE') {
      const result = await db.from(TABLES[item]).delete().eq('id', body.id).select().single();
      if (result.error) throw result.error;
      return sendData(res, { deleted: true, item: result.data });
    }

    const input = values(item, body);
    if (item === 'prompts' && !input.use_in) delete input.use_in;
    const result = await db.from(TABLES[item]).update({ ...input, updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res, result.data);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
