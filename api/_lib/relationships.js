const ROLE_MODES = {
  networking: new Set(['network']),
  prospecting: new Set(['prospect']),
  clients: new Set(['client']),
  partners: new Set(['partner', 'institution', 'funder', 'subcontractor']),
};

export function normalizeRelationshipEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function matchGmailInsightToContact(insight, contact) {
  if (!insight || !contact) return false;
  if (insight.contact_id && contact.id && insight.contact_id === contact.id) return true;
  const insightEmail = normalizeRelationshipEmail(insight.sender_email);
  const contactEmail = normalizeRelationshipEmail(contact.email);
  return Boolean(insightEmail && contactEmail && insightEmail === contactEmail);
}

export function relationshipModes(contact) {
  const role = String(contact?.relationshipType || '').toLowerCase();
  const areas = Array.isArray(contact?.areas) ? contact.areas : [];
  const interest = String(contact?.interest || '').toLowerCase();
  const modes = [];
  if (ROLE_MODES.networking.has(role) || areas.length > 0 || interest === 'networking') modes.push('networking');
  if (ROLE_MODES.prospecting.has(role) || ['client', 'consulting', 'audit', 'ai_training', 'procurement'].includes(interest)) modes.push('prospecting');
  if (ROLE_MODES.clients.has(role)) modes.push('clients');
  if (ROLE_MODES.partners.has(role) || interest === 'partnership') modes.push('partners');
  return modes;
}

function explicitWaiting(contact) {
  return /waiting\s+on|awaiting|their\s+reply|their\s+response|from\s+them|pending\s+their/i.test([contact?.followupIntent, contact?.notes].filter(Boolean).join(' '));
}

export function relationshipStage(contact) {
  const status = contact?.contactStatus || 'new';
  if (explicitWaiting(contact)) return 'Waiting';
  if (/reconnect|stay in touch|check back|circle back/i.test(contact?.followupIntent || '')) return 'Reconnect';
  if (status === 'new') return 'New';
  if (status === 'follow_up_needed') return 'Building';
  if (status === 'done' && String(contact?.relationshipType || '').toLowerCase() === 'client') return 'Strong';
  return '—';
}

export function relationshipQueueRank(contact, now = new Date()) {
  if (contact?.captureStatus === 'unfinished') return 0;
  const due = contact?.followupDueDate ? new Date(contact.followupDueDate + (String(contact.followupDueDate).length === 10 ? 'T00:00:00' : '')) : null;
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const soon = new Date(day); soon.setDate(soon.getDate() + 3);
  if (due && !Number.isNaN(due.getTime()) && due < day) return 1;
  if (due && !Number.isNaN(due.getTime()) && due <= soon) return 2;
  if (contact?.contactStatus === 'follow_up_needed') return 3;
  if (isWaitingOnThem(contact)) return 4;
  if (contact?.followupIntent) return 4;
  return 5;
}

export function isWaitingOnThem(contact) {
  return explicitWaiting(contact);
}
