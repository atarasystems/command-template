// One Google connection covers Gmail and Calendar. Founders set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
// GOOGLE_REFRESH_TOKEN once; older copies may use the GMAIL_ names. Either set fills in the other.
const PAIRS = [['GOOGLE_CLIENT_ID', 'GMAIL_CLIENT_ID'], ['GOOGLE_CLIENT_SECRET', 'GMAIL_CLIENT_SECRET'], ['GOOGLE_REFRESH_TOKEN', 'GMAIL_REFRESH_TOKEN']];

export function shareGoogleKeys(env = process.env) {
  for (const [a, b] of PAIRS) {
    if (!env[a] && env[b]) env[a] = env[b];
    if (!env[b] && env[a]) env[b] = env[a];
  }
  return env;
}

shareGoogleKeys();
