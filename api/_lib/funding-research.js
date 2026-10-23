import { canonicalPublicUrl, searchWeb } from './web-search.js';
import { fundingSearch } from './google-search.js';
import { findOpportunityMatch, normalizeIdentity } from './funding-watch.js';

const MAX_PAGE_BYTES = 400000;
const RESEARCH_TIMEOUT = 9000;

function validation(message) { return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' }); }
function readable(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function titleFrom(html) { return String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''; }
function metaDescription(html) { return String(html || '').match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim() || ''; }
async function fetchPage(url, fetchImpl = fetch) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT);
  try { const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml' } }); if (!response.ok) throw Object.assign(new Error(`Official page returned ${response.status}`), { code: 'RESEARCH_SOURCE_UNAVAILABLE' }); const text = await response.text(); return text.slice(0, MAX_PAGE_BYTES); }
  catch (error) { if (error.code) throw error; throw Object.assign(new Error('Opportunity page could not be accessed'), { code: 'RESEARCH_SOURCE_UNAVAILABLE' }); }
  finally { clearTimeout(timer); }
}

export async function researchFundingOpportunity({ input = {}, searchImpl = (args) => fundingSearch(args, { tavily: searchWeb }), fetchImpl = fetch } = {}) {
  const url = input.url ? canonicalPublicUrl(input.url) : null;
  const programName = String(input.program_name || '').trim().slice(0, 300);
  const organization = String(input.organization || '').trim().slice(0, 300);
  if (!url && !programName && !organization && !input.notes) throw validation('Provide a URL, program name, organization, or note to research.');
  let sourceUrl = url; let sourceTitle = programName; let sourceText = ''; const sources = [];
  if (url) {
    const html = await fetchPage(url, fetchImpl); sourceTitle = sourceTitle || titleFrom(html); sourceText = `${metaDescription(html)} ${readable(html)}`.slice(0, 12000); sources.push({ url, title: sourceTitle || url, source_type: 'official_url' });
  } else if (programName || organization) {
    const results = await searchImpl({ query: `${programName} ${organization} official funding program`.trim(), maxResults: 5 });
    const result = results.find((item) => organization && normalizeIdentity(item.title).includes(normalizeIdentity(organization))) || results[0];
    if (result) { sourceUrl = result.url; sourceTitle = sourceTitle || result.title; sourceText = result.snippet || ''; sources.push(...results.slice(0, 3).map((item) => ({ url: item.url, title: item.title, source_type: 'search_result' }))); }
  }
  const title = programName || sourceTitle || 'Unidentified funding opportunity';
  const preview = { title, organization: organization || null, source_url: sourceUrl, opportunity_type: 'program', amount_text: null, funding_value_text: null, funding_structure: null, is_non_dilutive: null, equity_percent: null, equity_terms_text: null, deadline_at: null, eligibility: null, fit_label: 'investigate', fit_rationale: 'Research preview needs a review against your current company facts.', priority_label: 'INVESTIGATE', priority_rank: null, effort_min_hours: null, effort_max_hours: null, effort_level: null, effort_rationale: null, reuse_level: null, application_requirements_json: null, required_partners: null, notes: input.notes ? String(input.notes).trim().slice(0, 2000) : null, source_verified_at: new Date().toISOString(), source_references: sources, missing: ['funding amount', 'equity terms', 'deadline', 'eligibility', 'fit evidence', 'application effort'] };
  if (sourceText) preview.source_excerpt = sourceText.slice(0, 1200);
  return preview;
}

export function researchDuplicate(records, preview) { return findOpportunityMatch(records, preview); }
