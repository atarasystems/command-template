import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { buildTransactionValues, summarizeFinance, TRANSACTION_FIELDS } from '../_lib/finance.js';

// GET  /api/finance                -> summary, months, recurring bills, recent transactions
// GET  /api/finance?view=transactions&month=YYYY-MM
// GET  /api/finance?view=documents&period=YYYY-MM
// POST /api/finance                -> add a transaction
// PATCH /api/finance               -> update a transaction ({ id, ...fields }) or a month close ({ month, ... })
async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH'])) return;
  try {
    const db = getSupabase();

    if (req.method === 'GET') {
      const view = req.query?.view || 'summary';
      if (view === 'transactions') {
        let query = db.from('command_finance_transactions').select('*').order('txn_date', { ascending: false }).limit(500);
        if (req.query?.month) query = query.eq('month', req.query.month);
        const result = await query;
        if (result.error) throw result.error;
        return sendData(res, result.data || []);
      }
      if (view === 'documents') {
        let query = db.from('command_finance_documents').select('*').order('period', { ascending: false }).limit(500);
        if (req.query?.period) query = query.eq('period', req.query.period);
        const result = await query;
        if (result.error) throw result.error;
        return sendData(res, result.data || []);
      }
      const [months, transactions, settings, recurring] = await Promise.all([
        db.from('command_finance_month_summary').select('*').order('month', { ascending: false }),
        db.from('command_finance_transactions').select('id,txn_date,description,vendor,amount,txn_type,category,evidence_status,reviewed,include_in_opex,notes').order('txn_date', { ascending: false }).limit(1000),
        db.from('command_finance_settings').select('*').maybeSingle(),
        db.from('command_finance_recurring_bills').select('*').order('vendor'),
      ]);
      for (const result of [months, transactions, settings, recurring]) if (result.error) throw result.error;
      const summary = summarizeFinance({ months: months.data || [], transactions: transactions.data || [], settings: settings.data || {}, recurring: recurring.data || [] });
      return sendData(res, {
        summary,
        months: months.data || [],
        recurring: recurring.data || [],
        recent: (transactions.data || []).slice(0, 25),
      });
    }

    const body = bodyOf(req);

    if (req.method === 'POST') {
      const values = buildTransactionValues(body);
      const result = await db.from('command_finance_transactions').insert(values).select().single();
      if (result.error) throw result.error;
      await db.from('command_finance_month_closes').upsert({ month: values.txn_date.slice(0, 7) }, { onConflict: 'month', ignoreDuplicates: true });
      return sendData(res, result.data, 201);
    }

    if (body.month && !body.id) {
      if (!/^\d{4}-\d{2}$/.test(body.month)) return sendError(res, { code: 'VALIDATION_ERROR', message: 'month must be YYYY-MM' });
      const changes = { month: body.month, updated_at: new Date().toISOString() };
      for (const key of ['statement_imported', 'statement_balance_checked']) if (typeof body[key] === 'boolean') changes[key] = body[key];
      if (typeof body.closed === 'boolean') changes.closed_at = body.closed ? new Date().toISOString() : null;
      if (typeof body.notes === 'string') changes.notes = body.notes;
      const result = await db.from('command_finance_month_closes').upsert(changes, { onConflict: 'month' }).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data);
    }

    if (!body.id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'id is required' });
    const changes = Object.fromEntries(TRANSACTION_FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
    if (!Object.keys(changes).length) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Nothing to update' });
    const result = await db.from('command_finance_transactions').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res, result.data);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
