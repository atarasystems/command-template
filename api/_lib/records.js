import { getSupabase } from './supabase.js';
import { fail, requireUuid } from './validation.js';
import { throwIfError } from './http.js';

export async function listRows(table, query, { select = '*', order = 'created_at', ascending = false, filters = [], isNull = [] } = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 250);
  let request = getSupabase().from(table).select(select).order(order, { ascending }).limit(limit);
  for (const [column, value] of filters) if (value) request = request.eq(column, value);
  for (const column of isNull) request = request.is(column, null);
  const { data, error } = await request;
  throwIfError(error);
  return data;
}

export async function getRow(table, id, select = '*') {
  requireUuid(id);
  const { data, error } = await getSupabase().from(table).select(select).eq('id', id).single();
  throwIfError(error);
  return data;
}

export async function insertRow(table, values, select = '*') {
  const { data, error } = await getSupabase().from(table).insert(values).select(select).single();
  throwIfError(error);
  return data;
}

export async function updateRow(table, id, values, select = '*') {
  requireUuid(id);
  if (!Object.keys(values).length) fail('At least one field is required');
  const { data, error } = await getSupabase().from(table).update(values).eq('id', id).select(select).single();
  throwIfError(error);
  return data;
}
