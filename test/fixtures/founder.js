// A made-up founder used across tests, so no real person's details live in the template.
import { settingsFromRows } from '../../api/_lib/founder-settings.js';

export const SAMPLE_ROWS = [
  { section: 'founder', value: { name: 'Maya Rivers', first_name: 'Maya', title: 'Founder and CEO', email: 'maya@northwind.example', signoff: 'Maya', bio: 'Former teacher.\nBuilds tools for small bakeries.' }, completed_at: '2026-10-01T00:00:00Z' },
  { section: 'company', value: { name: 'Northwind Studio', short_name: 'Northwind', legal_name: 'Northwind Studio LLC', entity_type: 'for-profit LLC', state: 'Ohio', one_liner: 'Ordering software for small bakeries.', website: 'northwind.example' }, completed_at: '2026-10-01T00:00:00Z' },
  { section: 'brands', value: { list: [{ code: 'NW', name: 'Northwind Orders', one_liner: 'Online ordering for bakeries', audience: 'bakery owners' }, { code: 'NB', name: 'Bake Better', one_liner: 'A newsletter for bakers' }] }, completed_at: '2026-10-01T00:00:00Z' },
  { section: 'funding', value: { stage: 'pre-seed', revenue: 'about $2,000', location: 'Columbus, Ohio', regions: 'Ohio', eligible_groups: 'women, veterans' }, completed_at: '2026-10-01T00:00:00Z' },
  { section: 'voice', value: { rules: 'Warm and short.', no_dashes: true, banned_words: ['synergy'], reading_level: '5th grade' }, completed_at: '2026-10-01T00:00:00Z' },
  { section: 'links', value: { booking_url: 'https://cal.example/maya', booking_label: 'coffee chat' }, completed_at: '2026-10-01T00:00:00Z' },
];

export const SAMPLE = settingsFromRows(SAMPLE_ROWS);
