# Command

Command is a daily operating system for founders: Today, Work, Email, People, Partnerships, Funding, LinkedIn,
Updates, Know it and Reply help, with an AI assistant that knows your company.

Each founder gets their own copy, their own database and their own keys. Nothing is shared between copies.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fatarasystems%2Fcommand-template&project-name=command&repository-name=command&env=COMMAND_PASSWORD%2CCOMMAND_SESSION_SECRET%2CCRON_SECRET%2CCOMMAND_TIME_ZONE%2CGEMINI_API_KEY&envDescription=Your%20Command%20password%2C%20two%20long%20random%20secrets%2C%20your%20time%20zone%20%28like%20America%2FChicago%29%2C%20and%20a%20free%20Gemini%20AI%20key%20from%20aistudio.google.com%2Fapikey.&envLink=https%3A%2F%2Fgithub.com%2Fatarasystems%2Fcommand-template%23settings-command-needs&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%2C%22protocol%22%3A%22storage%22%7D%5D)

## Getting started (about 30 minutes)

1. **Press Deploy.** Sign in to Vercel and GitHub. Vercel makes your own copy of the code.
2. **Fill in five settings** on the Vercel screen:
   - `COMMAND_PASSWORD`: the password you will use to sign in to Command.
   - `COMMAND_SESSION_SECRET` and `CRON_SECRET`: two different strings of 40 or more random characters. A password manager can make these.
   - `COMMAND_TIME_ZONE`: your time zone, such as `America/Chicago`.
   - `GEMINI_API_KEY`: a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
3. **Create the database.** Vercel offers a Supabase database during deploy. Choose the free plan.
4. **Open your Command** and sign in. The Setup page opens. Press **Create my tables**.
5. **Answer the setup questions.** One at a time, in plain words. You can change any answer later from Today, Setup.
6. **Connect Gmail and Calendar.** Setup shows each screen to click, step by step.

## Settings Command needs

| Setting | Needed? | What it is |
|---|---|---|
| `COMMAND_PASSWORD` | Yes | Your sign-in password |
| `COMMAND_SESSION_SECRET` | Yes | Random text that keeps you signed in |
| `CRON_SECRET` | Yes | Random text that protects scheduled jobs |
| `COMMAND_TIME_ZONE` | Yes | Your time zone |
| `GEMINI_API_KEY` | Yes | The AI key (the lowest-cost option) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL_NON_POOLING` | Yes | Added for you when Supabase is connected |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | For Email and Calendar | One Google connection for both |
| `SERPER_API_KEY` | Optional | Web search for the Funding Scout and Know it news |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional | Sends your morning brief by email |

`.env.example` lists the same settings with notes.

## Scheduled jobs

Five jobs run on their own. On the free Vercel plan each runs once a day at most, so the times in `vercel.json`
are daily or weekly. Email also has a **Check now** button for anything sooner.

| Job | When (UTC) | What it does |
|---|---|---|
| `/api/cron/email-triage` | 11:00 daily | Sorts new email, drafts replies, adds tasks, reads upcoming events |
| `/api/cron/funding` | 12:30 daily | Deadline reminders, then searches for new funding |
| `/api/cron/reviews` | 21:45 daily | Week in review on Fridays, month in review on the 1st |
| `/api/cron/linkedin-week` | 21:00 Fridays | Drafts next week's three LinkedIn posts |
| `/api/cron/know-news` | 11:05 daily | New Know it news cards each morning |

On Vercel Pro, email sorting can run every 30 minutes: change its schedule to `*/30 * * * *`.

## How it fits together

- **Founder settings** live in the `command_settings` table, one row per Setup section. `api/_lib/founder-settings.js`
  turns them into the facts, voice rules and funding profile every AI helper reads. Nothing about a founder is in the code.
- **The database** is built from one file, `supabase/schema/command-schema.sql`. First run applies it through
  `api/setup/database.js`. It is safe to run again.
- **The AI** runs on Gemini through `api/_lib/ai.js`. One key covers every feature.
- **Tests:** `npm test`. They include a check that the schema builds on an empty database and that no founder's
  details are written into the code.

## Privacy

Command reads the founder's email to sort it and draft replies. Drafts are never sent without the founder pressing
Send. Each copy's data stays in that founder's own Supabase project and Google account.
