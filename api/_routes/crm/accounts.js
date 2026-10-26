import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { getRow, insertRow, listRows, updateRow } from '../_lib/records.js';
import { ACCOUNT_TYPES, enumValue, optionalText, pickDefined, requiredText } from '../_lib/validation.js';

const editable = {
  name: value => requiredText(value, 'name', 300),
  website: value => optionalText(value, 'website', 2000),
  domain: value => optionalText(value, 'domain', 253)?.toLowerCase(),
  account_type: value => enumValue(value, 'account_type', ACCOUNT_TYPES),
  industry: value => optionalText(value, 'industry', 200),
  city: value => optionalText(value, 'city', 200),
  state: value => optionalText(value, 'state', 100),
  notes: value => optionalText(value, 'notes'),
};

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH'])) return;
  try {
    if (req.method === 'GET') {
      return sendData(res, req.query.id
        ? await getRow('crm_accounts', req.query.id)
        : await listRows('crm_accounts', req.query, { order: 'name', ascending: true }));
    }
    const input = bodyOf(req);
    const values = pickDefined(input, editable);
    if (req.method === 'POST') {
      values.name = requiredText(input.name, 'name', 300);
      values.account_type = enumValue(input.account_type, 'account_type', ACCOUNT_TYPES);
      return sendData(res, await insertRow('crm_accounts', values), 201);
    }
    return sendData(res, await updateRow('crm_accounts', req.query.id, values));
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
