import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../command-shell.js', import.meta.url), 'utf8');
const theme = fs.readFileSync(new URL('../command-theme.css', import.meta.url), 'utf8');

test('Command loads the shell and the theme layer, Rooftop Sunrise by default', () => {
  assert.match(html, /<link rel="stylesheet" href="\/command-theme\.css">/);
  assert.match(html, /<script src="\/command-shell\.js"><\/script>\s*<\/body>/);
  assert.match(html, /"sea"\?"sea":"rooftop"/);
  assert.match(theme, /:root\[data-theme="rooftop"\]/);
  assert.match(theme, /:root\[data-theme="sea"\]/);
  assert.match(shell, /applyTheme\(store\(THEME_KEY\) \|\| 'rooftop'\)/);
});

test('The side menu has the founder areas and every key panel has a home', () => {
  for (const label of ['SCOPE', 'Content']) assert.ok(!shell.includes(`label: '${label}'`), `${label} is Atara-only`);
  for (const label of ['Today', 'Email', 'Updates', 'People', 'Partnerships', 'Funding', 'Work', 'Calendar', 'Money', 'News & Notes']) assert.ok(shell.includes(`label: '${label}'`), label);
  for (const id of ['panel-relationship-desk', 'panel-email-desk', 'panel-contacts-full', 'panel-revenue-crm', 'panel-projects', 'panel-actions', 'panel-tickler', 'panel-calendar', 'panel-intelligence', 'panel-knowledge']) {
    assert.ok(shell.includes(`'${id}'`), id);
  }
});

test('Today shows at most five items and Money reads the finance route', () => {
  assert.match(shell, /items\.slice\(0, 5\)/);
  assert.match(shell, /fetch\('\/api\/finance'\)/);
  assert.match(shell, /function openCalm\(\)/);
});

test('Shell copy stays positive and dash-free', () => {
  const visible = shell.match(/'[^'\n]{12,}'/g).join(' ');
  assert.doesNotMatch(visible, /—|–| -- /);
  assert.doesNotMatch(visible, /rejected|struggling/i);
});

test('Today never shows dollar amounts and Command always opens on Today', () => {
  const moneyCard = shell.slice(shell.indexOf("areaCard('money'"), shell.indexOf('\n', shell.indexOf("areaCard('money'")));
  assert.doesNotMatch(moneyCard, /money\(|money2\(|cash_position/);
  assert.match(shell, /showPage\('today'\);/);
  assert.doesNotMatch(shell, /showPage\(store\(PAGE_KEY\)/);
});

test('Partnerships holds organizations and Funding holds grants, apart from Money', () => {
  const page = (id) => shell.slice(shell.indexOf(`{ id: '${id}'`), shell.indexOf('\n', shell.indexOf(`{ id: '${id}'`)));
  assert.match(page('partnerships'), /panel-opportunity-hub/);
  assert.match(page('partnerships'), /panel-revenue-crm/);
  assert.doesNotMatch(page('people'), /panel-opportunity-hub|panel-revenue-crm/);
  assert.match(page('funding'), /cmd-funding/);
  const moneySection = shell.slice(shell.indexOf("section('cmd-money'"), shell.indexOf("section('cmd-funding'"));
  assert.doesNotMatch(moneySection, /applications\.html|Program Opportunities/);
});

test('LinkedIn drafts live on Work, Money follows its setting, and new founders go to Setup', () => {
  assert.match(shell, /id === 'work' && window\.CommandLinkedIn/);
  assert.match(shell, /settings\.moduleOn\(p\.id\)/);
  assert.match(shell, /window\.location\.href = '\/setup\.html'/);
  assert.doesNotMatch(shell, /Solei|SCOPE|Atara Command/);
});

test('Calendar has its own page and shows the founder time zone', () => {
  assert.match(shell, /id: 'calendar', label: 'Calendar'[^\n]*panels: \['panel-calendar'\]/);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-tz-label/);
  assert.doesNotMatch(html, />Eastern Time</);
});
