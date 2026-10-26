import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { insertRow, listRows } from '../_lib/records.js';
import { optionalText, optionalUuid, requiredText, timestampValue } from '../_lib/validation.js';

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      const opportunityId = optionalUuid(req.query.opportunity_id, 'opportunity_id');
      const contactId = optionalUuid(req.query.contact_id, 'contact_id');
      const accountId = optionalUuid(req.query.account_id, 'account_id');
      if (!opportunityId && !contactId && !accountId) throw Object.assign(new Error('opportunity_id, contact_id, or account_id is required'), { code: 'VALIDATION_ERROR' });
      return sendData(res, await listRows('crm_activities', req.query, {
        order: 'occurred_at',
        filters: [['opportunity_id', opportunityId], ['contact_id', contactId], ['account_id', accountId]],
      }));
    }
    const input = bodyOf(req);
    const values = {
      opportunity_id: optionalUuid(input.opportunity_id, 'opportunity_id'),
      account_id: optionalUuid(input.account_id, 'account_id'),
      contact_id: optionalUuid(input.contact_id, 'contact_id'),
      activity_type: requiredText(input.activity_type, 'activity_type', 100),
      subject: optionalText(input.subject, 'subject', 500),
      description: optionalText(input.description, 'description'),
      external_id: optionalText(input.external_id, 'external_id', 500),
      metadata: input.metadata ?? {},
      occurred_at: timestampValue(input.occurred_at, 'occurred_at') || new Date().toISOString(),
    };
    if (!values.metadata || typeof values.metadata !== 'object' || Array.isArray(values.metadata)) {
      throw Object.assign(new Error('metadata must be a JSON object'), { code: 'VALIDATION_ERROR' });
    }
    return sendData(res, await insertRow('crm_activities', values), 201);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
