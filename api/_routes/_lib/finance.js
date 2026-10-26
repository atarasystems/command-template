// Finance (bookkeeping) logic for Command. Source of truth: command_finance_* tables,
// imported from the founder's bookkeeping workbook.

export const TXN_TYPES = ['expense', 'income', 'personal_transfer', 'owner_contribution'];
export const EVIDENCE_STATUSES = ['matched', 'missing', 'not_needed'];

export const TRANSACTION_FIELDS = ['txn_date', 'description', 'vendor', 'amount', 'txn_type', 'category', 'account_label', 'evidence_status', 'reviewed', 'include_in_opex', 'notes'];

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Normalize a new transaction. Expenses are stored as negative amounts, income as positive.
export function buildTransactionValues(input, now = new Date()) {
  const txnType = TXN_TYPES.includes(input.txn_type) ? input.txn_type : null;
  if (!txnType) throw Object.assign(new Error('txn_type must be expense, income, personal_transfer, or owner_contribution'), { code: 'VALIDATION_ERROR' });
  const date = String(input.txn_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('txn_date must be YYYY-MM-DD'), { code: 'VALIDATION_ERROR' });
  const raw = Number(input.amount);
  if (!Number.isFinite(raw) || raw === 0) throw Object.assign(new Error('amount must be a non-zero number'), { code: 'VALIDATION_ERROR' });
  const description = String(input.description || input.vendor || '').trim();
  if (!description) throw Object.assign(new Error('description is required'), { code: 'VALIDATION_ERROR' });
  const amount = txnType === 'expense' ? -Math.abs(raw) : txnType === 'income' ? Math.abs(raw) : raw;
  return {
    external_key: input.external_key || `manual:${date}:${description}:${amount}:${now.getTime()}`,
    txn_date: date,
    description,
    vendor: input.vendor ? String(input.vendor).trim() : null,
    amount: round2(amount),
    txn_type: txnType,
    category: input.category ? String(input.category).trim() : (txnType === 'income' ? 'Business income' : 'Needs review'),
    account_label: input.account_label || null,
    source: input.source || 'manual',
    evidence_status: EVIDENCE_STATUSES.includes(input.evidence_status) ? input.evidence_status : (txnType === 'expense' ? 'missing' : 'not_needed'),
    reviewed: input.reviewed === true,
    include_in_opex: typeof input.include_in_opex === 'boolean' ? input.include_in_opex : txnType === 'expense',
    notes: input.notes || null,
  };
}

// Burn uses the average business expenses of the last three months that have activity,
// leaving out the current month while it is still in progress.
export function summarizeFinance({ months = [], transactions = [], settings = {}, recurring = [], now = new Date() }) {
  const currentMonth = now.toISOString().slice(0, 7);
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const complete = sorted.filter((row) => row.month < currentMonth && Number(row.business_opex) > 0);
  const recent = complete.slice(-3);
  const burn = recent.length ? round2(recent.reduce((sum, row) => sum + Number(row.business_opex || 0), 0) / recent.length) : 0;
  const cash = round2(Number(settings.starting_cash || 0) + transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const lastTransactionDate = transactions.reduce((latest, row) => (row.txn_date > latest ? row.txn_date : latest), '');
  const committedMonthly = round2(recurring.filter((row) => row.status === 'active' && row.expected_amount != null && /monthly/i.test(row.cadence || '')).reduce((sum, row) => sum + Number(row.expected_amount), 0));
  const totals = sorted.reduce((acc, row) => ({
    income: acc.income + Number(row.business_income || 0),
    opex: acc.opex + Number(row.business_opex || 0),
    missing: acc.missing + Number(row.missing_evidence || 0),
    unreviewed: acc.unreviewed + Number(row.unreviewed || 0),
    needs_review: acc.needs_review + Number(row.needs_review || 0),
  }), { income: 0, opex: 0, missing: 0, unreviewed: 0, needs_review: 0 });
  return {
    cash_position: cash,
    cash_as_of: lastTransactionDate || null,
    monthly_burn: burn,
    burn_months: recent.map((row) => row.month),
    runway_months: burn > 0 ? Math.round((cash / burn) * 10) / 10 : null,
    committed_monthly: committedMonthly,
    ytd_income: round2(totals.income),
    ytd_opex: round2(totals.opex),
    missing_evidence: totals.missing,
    unreviewed: totals.unreviewed,
    needs_review: totals.needs_review,
    open_months: sorted.filter((row) => !row.closed_at).map((row) => row.month),
  };
}
