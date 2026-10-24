-- Command: the full starting database for a new founder.
-- Run once on an empty Supabase project (Command's first run does this for you).
-- Safe to run again: everything uses "if not exists" or "or replace".


-- Founder settings: one row per setup section (founder, company, brands, audience, funding, schedule, voice, links,
-- assistant, modules). The setup assistant writes these; every AI helper reads them.
create table if not exists public.command_settings (
  section text primary key,
  value jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint command_settings_value_is_object check (jsonb_typeof(value) = 'object')
);
alter table public.command_settings enable row level security;

-- The founder's time zone from setup. Used for "today" in the database.
create or replace function public.command_time_zone() returns text language sql stable set search_path to 'public' as $$
  select coalesce(nullif((select value->>'time_zone' from public.command_settings where section = 'schedule'), ''), 'America/New_York')
$$;

create or replace function public.crm_set_updated_at() returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create or replace function public.crm_prevent_activity_mutation() returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception using errcode = '55000', message = 'CRM activities are immutable';
end; $$;


-- crm_accounts
create table if not exists public.crm_accounts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  website text,
  domain text,
  account_type text not null,
  industry text,
  city text,
  state text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_accounts add constraint crm_accounts_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_accounts_account_type_idx ON public.crm_accounts USING btree (account_type);
CREATE INDEX IF NOT EXISTS crm_accounts_name_idx ON public.crm_accounts USING btree (lower(name));
CREATE INDEX IF NOT EXISTS crm_accounts_domain_idx ON public.crm_accounts USING btree (lower(domain)) WHERE (domain IS NOT NULL);
alter table public.crm_accounts enable row level security;

-- crm_contacts
create table if not exists public.crm_contacts (
  id uuid not null default gen_random_uuid(),
  account_id uuid,
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  job_title text,
  linkedin_url text,
  alignable_url text,
  is_primary boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  notes text,
  next_action text,
  next_action_at timestamp with time zone,
  archived_at timestamp with time zone,
  areas text[] not null default '{}'::text[],
  interest text,
  capture_status text not null default 'complete'::text,
  website text,
  contact_status text not null default 'new'::text
);
do $$ begin alter table public.crm_contacts add constraint crm_contacts_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_contacts add constraint crm_contacts_contact_status_check CHECK ((contact_status = ANY (ARRAY['new'::text, 'follow_up_needed'::text, 'done'::text, 'not_needed'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_contacts add constraint crm_contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_accounts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_contacts_next_action_at_idx ON public.crm_contacts USING btree (next_action_at) WHERE (archived_at IS NULL);
CREATE INDEX IF NOT EXISTS crm_contacts_account_id_idx ON public.crm_contacts USING btree (account_id);
CREATE INDEX IF NOT EXISTS crm_contacts_email_idx ON public.crm_contacts USING btree (lower(email)) WHERE (email IS NOT NULL);
alter table public.crm_contacts enable row level security;

-- crm_program_opportunities
create table if not exists public.crm_program_opportunities (
  id uuid not null default gen_random_uuid(),
  opportunity_type text not null,
  title text not null,
  organization text,
  account_id uuid,
  contact_id uuid,
  source_url text,
  source_type text,
  source_id text,
  amount_value numeric,
  amount_text text,
  eligibility text,
  fit_notes text,
  status text not null default 'discovered'::text,
  deadline_at timestamp with time zone,
  submitted_at timestamp with time zone,
  response_expected_at timestamp with time zone,
  follow_up_at timestamp with time zone,
  decision_at timestamp with time zone,
  outcome_notes text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  funding_intent text,
  strategic_fit_score numeric,
  eligibility_confidence_score numeric,
  funding_value_score numeric,
  realism_score numeric,
  readiness_score numeric,
  deadline_timing_score numeric,
  effort_efficiency_score numeric,
  effort_min_hours numeric,
  effort_max_hours numeric,
  funding_min_amount numeric,
  funding_max_amount numeric,
  funding_value_text text,
  funding_structure text,
  is_non_dilutive boolean,
  equity_percent numeric,
  equity_terms_text text,
  external_program_id text,
  fit_label text,
  fit_rationale text,
  priority_label text,
  priority_rank integer,
  effort_level text,
  effort_rationale text,
  reuse_level text,
  application_requirements_json jsonb,
  required_partners text,
  source_verified_at timestamp with time zone,
  dilution_cost_score numeric,
  dismissed_reason text,
  dismissed_note text,
  dismissed_at timestamp with time zone,
  dismissed_by_user boolean,
  next_open_at date,
  next_round_note text,
  benefits_text text,
  last_checked_at timestamp with time zone,
  lead_time_days integer,
  prep_start_at date
);
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_funding_intent_check CHECK (((funding_intent IS NULL) OR (funding_intent = ANY (ARRAY['option'::text, 'chosen'::text])))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_opportunity_type_check CHECK ((opportunity_type = ANY (ARRAY['grant'::text, 'accelerator'::text, 'pitch_competition'::text, 'procurement'::text, 'funding'::text, 'fellowship'::text, 'program'::text, 'other'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_priority_score_range_check CHECK ((((strategic_fit_score IS NULL) OR ((strategic_fit_score >= (0)::numeric) AND (strategic_fit_score <= (100)::numeric))) AND ((eligibility_confidence_score IS NULL) OR ((eligibility_confidence_score >= (0)::numeric) AND (eligibility_confidence_score <= (100)::numeric))) AND ((funding_value_score IS NULL) OR ((funding_value_score >= (0)::numeric) AND (funding_value_score <= (100)::numeric))) AND ((realism_score IS NULL) OR ((realism_score >= (0)::numeric) AND (realism_score <= (100)::numeric))) AND ((readiness_score IS NULL) OR ((readiness_score >= (0)::numeric) AND (readiness_score <= (100)::numeric))) AND ((deadline_timing_score IS NULL) OR ((deadline_timing_score >= (0)::numeric) AND (deadline_timing_score <= (100)::numeric))) AND ((effort_efficiency_score IS NULL) OR ((effort_efficiency_score >= (0)::numeric) AND (effort_efficiency_score <= (100)::numeric))) AND ((effort_min_hours IS NULL) OR (effort_min_hours >= (0)::numeric)) AND ((effort_max_hours IS NULL) OR (effort_max_hours >= (0)::numeric)) AND ((effort_min_hours IS NULL) OR (effort_max_hours IS NULL) OR (effort_max_hours >= effort_min_hours)))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_status_check CHECK ((status = ANY (ARRAY['discovered'::text, 'reviewing'::text, 'apply'::text, 'in_progress'::text, 'submitted'::text, 'awaiting_response'::text, 'interview'::text, 'final_decision'::text, 'awarded'::text, 'not_selected'::text, 'archived'::text, 'watching'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_accounts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_program_opportunities add constraint crm_program_opportunities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_program_opportunities_account_idx ON public.crm_program_opportunities USING btree (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_program_opportunities_source_idx ON public.crm_program_opportunities USING btree (source_type, source_id) WHERE ((source_type IS NOT NULL) AND (source_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS crm_program_opportunities_status_idx ON public.crm_program_opportunities USING btree (status);
CREATE INDEX IF NOT EXISTS crm_program_opportunities_deadline_idx ON public.crm_program_opportunities USING btree (deadline_at) WHERE (status <> 'archived'::text);
CREATE INDEX IF NOT EXISTS crm_program_opportunities_contact_idx ON public.crm_program_opportunities USING btree (contact_id);
alter table public.crm_program_opportunities enable row level security;

-- command_applications
create table if not exists public.command_applications (
  id uuid not null default gen_random_uuid(),
  program_opportunity_id uuid,
  title text not null,
  organization text,
  application_type text not null default 'accelerator'::text,
  application_url text,
  status text not null default 'draft'::text,
  deadline_at timestamp with time zone,
  submitted_at timestamp with time zone,
  response_expected_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  response_status text,
  latest_response_at timestamp with time zone,
  latest_response_summary text,
  next_action text,
  next_action_due_at timestamp with time zone,
  final_outcome text,
  award_amount numeric,
  award_date timestamp with time zone,
  program_start_at timestamp with time zone,
  program_end_at timestamp with time zone,
  award_conditions text,
  agreement_url text
);
do $$ begin alter table public.command_applications add constraint command_applications_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_applications add constraint command_applications_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'submitted'::text, 'awaiting_response'::text, 'interview'::text, 'awarded'::text, 'not_selected'::text, 'archived'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_applications add constraint command_applications_program_opportunity_id_fkey FOREIGN KEY (program_opportunity_id) REFERENCES crm_program_opportunities(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_applications_deadline_idx ON public.command_applications USING btree (deadline_at);
CREATE INDEX IF NOT EXISTS command_applications_status_idx ON public.command_applications USING btree (status);
CREATE INDEX IF NOT EXISTS command_applications_program_opportunity_idx ON public.command_applications USING btree (program_opportunity_id);
alter table public.command_applications enable row level security;

-- command_application_answers
create table if not exists public.command_application_answers (
  id uuid not null default gen_random_uuid(),
  application_id uuid not null,
  question_order integer not null default 0,
  question_text text not null,
  topic text not null default 'general'::text,
  max_characters integer,
  answer_text text not null default ''::text,
  answer_status text not null default 'draft'::text,
  submitted_answer_text text,
  submitted_at timestamp with time zone,
  source_answer_id uuid,
  ai_drafted boolean not null default false,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_application_answers add constraint command_application_answers_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_answers add constraint command_application_answers_answer_status_check CHECK ((answer_status = ANY (ARRAY['draft'::text, 'approved'::text, 'submitted'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_answers add constraint command_application_answers_application_id_fkey FOREIGN KEY (application_id) REFERENCES command_applications(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_answers add constraint command_application_answers_source_answer_id_fkey FOREIGN KEY (source_answer_id) REFERENCES command_application_answers(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_application_answers_application_idx ON public.command_application_answers USING btree (application_id, question_order);
CREATE INDEX IF NOT EXISTS command_application_answers_topic_idx ON public.command_application_answers USING btree (topic);
CREATE INDEX IF NOT EXISTS command_application_answers_status_idx ON public.command_application_answers USING btree (answer_status);
alter table public.command_application_answers enable row level security;

-- command_living_docs
create table if not exists public.command_living_docs (
  id uuid not null default gen_random_uuid(),
  name text not null,
  document_type text not null,
  business_area text not null,
  canonical_live_link text,
  purpose text,
  is_canonical boolean not null default true,
  owner text not null default 'Founder'::text,
  last_reviewed_at timestamp with time zone,
  last_materially_updated_at timestamp with time zone,
  needs_update boolean not null default false,
  needs_update_reason text,
  related_project_product text,
  revision_change_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_living_docs add constraint command_living_docs_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_living_docs add constraint command_living_docs_area_not_blank CHECK ((length(TRIM(BOTH FROM business_area)) > 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_living_docs add constraint command_living_docs_document_type_check CHECK ((document_type = ANY (ARRAY['google_doc'::text, 'google_sheet'::text, 'google_slides'::text, 'other'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_living_docs add constraint command_living_docs_name_not_blank CHECK ((length(TRIM(BOTH FROM name)) > 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_living_docs add constraint command_living_docs_update_reason CHECK (((needs_update = false) OR (NULLIF(TRIM(BOTH FROM needs_update_reason), ''::text) IS NOT NULL))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_living_docs_needs_update_idx ON public.command_living_docs USING btree (needs_update) WHERE (needs_update = true);
CREATE INDEX IF NOT EXISTS command_living_docs_area_idx ON public.command_living_docs USING btree (business_area);
CREATE INDEX IF NOT EXISTS command_living_docs_canonical_idx ON public.command_living_docs USING btree (is_canonical) WHERE (is_canonical = true);
alter table public.command_living_docs enable row level security;

-- command_export_documents
create table if not exists public.command_export_documents (
  id uuid not null default gen_random_uuid(),
  living_doc_id uuid,
  name text not null,
  export_type text not null,
  file_url text not null,
  is_current boolean not null default true,
  exported_at timestamp with time zone not null default now(),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_export_documents add constraint command_export_documents_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_export_documents add constraint command_export_documents_export_type_check CHECK ((export_type = ANY (ARRAY['docx'::text, 'pdf'::text, 'pptx'::text, 'xlsx'::text, 'other'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_export_documents add constraint command_export_documents_name_not_blank CHECK ((length(TRIM(BOTH FROM name)) > 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_export_documents add constraint command_export_documents_url_not_blank CHECK ((length(TRIM(BOTH FROM file_url)) > 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_export_documents add constraint command_export_documents_living_doc_id_fkey FOREIGN KEY (living_doc_id) REFERENCES command_living_docs(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_export_documents_living_doc_idx ON public.command_export_documents USING btree (living_doc_id);
CREATE INDEX IF NOT EXISTS command_export_documents_current_idx ON public.command_export_documents USING btree (is_current) WHERE (is_current = true);
alter table public.command_export_documents enable row level security;

-- command_funding_document_versions
create table if not exists public.command_funding_document_versions (
  id uuid not null default gen_random_uuid(),
  document_key text not null,
  version_number integer not null,
  name text not null,
  document_type text not null default 'other'::text,
  file_url text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  file_size bigint,
  status text not null default 'current'::text,
  supersedes_version_id uuid,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_funding_document_versions add constraint command_funding_document_versions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_document_versions add constraint command_funding_document_versio_document_key_version_number_key UNIQUE (document_key, version_number); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_document_versions add constraint command_funding_document_versions_status_check CHECK ((status = ANY (ARRAY['current'::text, 'superseded'::text, 'retired'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_document_versions add constraint command_funding_document_versions_supersedes_version_id_fkey FOREIGN KEY (supersedes_version_id) REFERENCES command_funding_document_versions(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE UNIQUE INDEX IF NOT EXISTS command_funding_document_current_idx ON public.command_funding_document_versions USING btree (document_key) WHERE (status = 'current'::text);
alter table public.command_funding_document_versions enable row level security;

-- command_application_documents
create table if not exists public.command_application_documents (
  id uuid not null default gen_random_uuid(),
  application_id uuid,
  living_doc_id uuid,
  export_document_id uuid,
  name text not null,
  document_type text not null default 'other'::text,
  file_url text,
  is_current boolean not null default true,
  is_submitted boolean not null default false,
  submitted_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  storage_bucket text,
  storage_path text,
  mime_type text,
  file_size bigint,
  funding_document_version_id uuid,
  association_type text
);
do $$ begin alter table public.command_application_documents add constraint command_application_documents_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_documents add constraint command_application_documents_association_type_check CHECK (((association_type IS NULL) OR (association_type = ANY (ARRAY['reference'::text, 'submitted'::text])))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_documents add constraint command_application_documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES command_applications(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_documents add constraint command_application_documents_export_document_id_fkey FOREIGN KEY (export_document_id) REFERENCES command_export_documents(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_documents add constraint command_application_documents_funding_document_version_id_fkey FOREIGN KEY (funding_document_version_id) REFERENCES command_funding_document_versions(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_documents add constraint command_application_documents_living_doc_id_fkey FOREIGN KEY (living_doc_id) REFERENCES command_living_docs(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_application_documents_application_idx ON public.command_application_documents USING btree (application_id);
CREATE INDEX IF NOT EXISTS command_application_documents_funding_version_idx ON public.command_application_documents USING btree (funding_document_version_id);
CREATE INDEX IF NOT EXISTS command_application_documents_storage_idx ON public.command_application_documents USING btree (storage_bucket, storage_path) WHERE (storage_path IS NOT NULL);
alter table public.command_application_documents enable row level security;

-- command_application_responses
create table if not exists public.command_application_responses (
  id uuid not null default gen_random_uuid(),
  application_id uuid not null,
  response_date timestamp with time zone not null,
  response_type text not null,
  summary text not null,
  source_type text not null default 'manual'::text,
  source_reference text,
  gmail_message_id text,
  gmail_thread_id text,
  award_amount numeric,
  award_date timestamp with time zone,
  program_start_at timestamp with time zone,
  program_end_at timestamp with time zone,
  award_conditions text,
  agreement_url text,
  action_required boolean not null default false,
  next_action text,
  action_due_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_application_responses add constraint command_application_responses_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_application_responses add constraint command_application_responses_application_id_fkey FOREIGN KEY (application_id) REFERENCES command_applications(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_application_responses_action_idx ON public.command_application_responses USING btree (action_required, action_due_at);
CREATE INDEX IF NOT EXISTS command_application_responses_application_idx ON public.command_application_responses USING btree (application_id, response_date);
alter table public.command_application_responses enable row level security;

-- command_company_facts
create table if not exists public.command_company_facts (
  id uuid not null default gen_random_uuid(),
  fact_key text not null,
  label text not null,
  category text not null default 'company'::text,
  value_text text not null,
  status text not null default 'current'::text,
  source_note text,
  effective_at timestamp with time zone not null default now(),
  last_verified_at timestamp with time zone,
  owner text not null default 'Founder'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_company_facts add constraint command_company_facts_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_company_facts add constraint command_company_facts_fact_key_key UNIQUE (fact_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_company_facts add constraint command_company_facts_status_check CHECK ((status = ANY (ARRAY['current'::text, 'draft'::text, 'retired'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_company_facts enable row level security;

-- command_email_triage
create table if not exists public.command_email_triage (
  id uuid not null default gen_random_uuid(),
  gmail_message_id text not null,
  gmail_thread_id text,
  sender_name text,
  sender_email text,
  subject text,
  snippet text,
  received_at timestamp with time zone,
  kind text not null,
  summary text,
  ask text,
  due_date date,
  priority text not null default 'normal'::text,
  reply_subject text,
  reply_body text,
  gmail_draft_id text,
  work_item_id uuid,
  status text not null default 'open'::text,
  handled_at timestamp with time zone,
  handled_by text,
  model text,
  error text,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  items jsonb not null default '[]'::jsonb
);
do $$ begin alter table public.command_email_triage add constraint command_email_triage_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_email_triage add constraint command_email_triage_gmail_message_id_key UNIQUE (gmail_message_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_email_triage add constraint command_email_triage_kind_check CHECK ((kind = ANY (ARRAY['reply'::text, 'todo'::text, 'fyi'::text, 'skip'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_email_triage add constraint command_email_triage_priority_check CHECK ((priority = ANY (ARRAY['now'::text, 'soon'::text, 'normal'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_email_triage add constraint command_email_triage_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text, 'sent'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_email_triage_thread_idx ON public.command_email_triage USING btree (gmail_thread_id);
CREATE INDEX IF NOT EXISTS command_email_triage_open_idx ON public.command_email_triage USING btree (kind, status, received_at DESC) WHERE (deleted_at IS NULL);
alter table public.command_email_triage enable row level security;

-- command_finance_transactions
create table if not exists public.command_finance_transactions (
  id uuid not null default gen_random_uuid(),
  external_key text not null,
  txn_date date not null,
  month text generated always as ((((EXTRACT(year FROM txn_date))::integer)::text || '-'::text) || lpad(((EXTRACT(month FROM txn_date))::integer)::text, 2, '0'::text)) stored,
  description text not null,
  vendor text,
  amount numeric(12,2) not null,
  txn_type text not null,
  category text not null default 'Needs review'::text,
  account_label text,
  source text not null default 'manual'::text,
  evidence_status text not null default 'missing'::text,
  reviewed boolean not null default false,
  include_in_opex boolean not null default false,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_finance_transactions add constraint command_finance_transactions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_transactions add constraint command_finance_transactions_external_key_key UNIQUE (external_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_transactions add constraint command_finance_transactions_evidence_status_check CHECK ((evidence_status = ANY (ARRAY['matched'::text, 'missing'::text, 'not_needed'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_transactions add constraint command_finance_transactions_txn_type_check CHECK ((txn_type = ANY (ARRAY['expense'::text, 'income'::text, 'personal_transfer'::text, 'owner_contribution'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_finance_transactions_month_idx ON public.command_finance_transactions USING btree (month);
CREATE INDEX IF NOT EXISTS command_finance_transactions_date_idx ON public.command_finance_transactions USING btree (txn_date DESC);
alter table public.command_finance_transactions enable row level security;

-- command_finance_documents
create table if not exists public.command_finance_documents (
  id uuid not null default gen_random_uuid(),
  external_key text not null,
  document_date date,
  period text not null,
  vendor text not null,
  amount numeric(12,2) not null,
  evidence_type text,
  source_reference text,
  match_status text not null default 'needs_match'::text,
  transaction_id uuid,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_finance_documents add constraint command_finance_documents_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_documents add constraint command_finance_documents_external_key_key UNIQUE (external_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_documents add constraint command_finance_documents_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'needs_match'::text, 'no_charge'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_documents add constraint command_finance_documents_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES command_finance_transactions(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_finance_documents_period_idx ON public.command_finance_documents USING btree (period);
alter table public.command_finance_documents enable row level security;

-- command_finance_month_closes
create table if not exists public.command_finance_month_closes (
  month text not null,
  statement_imported boolean not null default false,
  statement_balance_checked boolean not null default false,
  closed_at timestamp with time zone,
  notes text,
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_finance_month_closes add constraint command_finance_month_closes_pkey PRIMARY KEY (month); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_month_closes add constraint command_finance_month_closes_month_check CHECK ((month ~ '^\d{4}-\d{2}$'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_finance_month_closes enable row level security;

-- command_finance_recurring_bills
create table if not exists public.command_finance_recurring_bills (
  id uuid not null default gen_random_uuid(),
  external_key text not null,
  vendor text not null,
  expected_amount numeric(12,2),
  amount_note text,
  cadence text not null default 'Monthly'::text,
  start_date date,
  end_date date,
  status text not null default 'active'::text,
  typical_account text,
  what_to_verify text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_finance_recurring_bills add constraint command_finance_recurring_bills_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_recurring_bills add constraint command_finance_recurring_bills_external_key_key UNIQUE (external_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_recurring_bills add constraint command_finance_recurring_bills_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text, 'plan_changed'::text, 'needs_review'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_finance_recurring_bills enable row level security;

-- command_finance_settings
create table if not exists public.command_finance_settings (
  id boolean not null default true,
  starting_cash numeric(12,2) not null default 0,
  starting_cash_date date,
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_finance_settings add constraint command_finance_settings_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_finance_settings add constraint command_finance_settings_id_check CHECK (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_finance_settings enable row level security;

-- command_funding_kit
create table if not exists public.command_funding_kit (
  key text not null,
  label text not null,
  category text not null default 'document'::text,
  status text not null default 'not_started'::text,
  value text,
  last_updated_at timestamp with time zone,
  refresh_days integer,
  refresh_rule text,
  document_id uuid,
  notes text,
  sort integer not null default 0
);
do $$ begin alter table public.command_funding_kit add constraint command_funding_kit_pkey PRIMARY KEY (key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_kit add constraint command_funding_kit_category_check CHECK ((category = ANY (ARRAY['registration'::text, 'document'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_kit add constraint command_funding_kit_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'needs_refresh'::text, 'not_started'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_funding_kit enable row level security;

-- command_funding_prep_items
create table if not exists public.command_funding_prep_items (
  id uuid not null default gen_random_uuid(),
  opportunity_id uuid not null,
  text text not null,
  kind text not null default 'other'::text,
  kit_key text,
  due_at date,
  done_at timestamp with time zone,
  sort integer not null default 0,
  created_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_funding_prep_items add constraint command_funding_prep_items_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_prep_items add constraint command_funding_prep_items_kind_check CHECK ((kind = ANY (ARRAY['registration'::text, 'document'::text, 'writing'::text, 'letter'::text, 'video'::text, 'other'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_funding_prep_items add constraint command_funding_prep_items_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES crm_program_opportunities(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_funding_prep_items_opp_idx ON public.command_funding_prep_items USING btree (opportunity_id, sort);
alter table public.command_funding_prep_items enable row level security;

-- command_funding_scout_runs
create table if not exists public.command_funding_scout_runs (
  id uuid not null default gen_random_uuid(),
  ran_at timestamp with time zone not null default now(),
  summary jsonb not null default '{}'::jsonb
);
do $$ begin alter table public.command_funding_scout_runs add constraint command_funding_scout_runs_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_funding_scout_runs_ran_idx ON public.command_funding_scout_runs USING btree (ran_at DESC);
alter table public.command_funding_scout_runs enable row level security;

-- command_heads_up
create table if not exists public.command_heads_up (
  id uuid not null default gen_random_uuid(),
  source text not null,
  source_id text not null,
  source_updated text,
  title text not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  all_day boolean not null default false,
  location text,
  join_link text,
  heads_up text,
  prep jsonb not null default '[]'::jsonb,
  has_news boolean not null default false,
  acknowledged_at timestamp with time zone,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_heads_up add constraint command_heads_up_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_heads_up add constraint command_heads_up_source_id_key UNIQUE (source_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_heads_up add constraint command_heads_up_source_check CHECK ((source = ANY (ARRAY['calendar'::text, 'email'::text, 'funding'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_heads_up_upcoming_idx ON public.command_heads_up USING btree (starts_at) WHERE ((dismissed_at IS NULL) AND has_news);
alter table public.command_heads_up enable row level security;

-- command_hidden_items
create table if not exists public.command_hidden_items (
  item_key text not null,
  title text,
  hidden_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_hidden_items add constraint command_hidden_items_pkey PRIMARY KEY (item_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_hidden_items enable row level security;

-- command_knowledge_cards
create table if not exists public.command_knowledge_cards (
  id uuid not null default gen_random_uuid(),
  deck text not null default 'statistics'::text,
  topic text not null default ''::text,
  prompt text not null,
  answer text not null,
  detail text not null default ''::text,
  who text,
  source text,
  source_url text,
  source_year text,
  note text,
  last_checked date,
  status text not null default 'current'::text,
  box integer not null default 0,
  due_at timestamp with time zone not null default now(),
  times_seen integer not null default 0,
  times_right integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_knowledge_cards add constraint command_knowledge_cards_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_knowledge_cards_deck_idx ON public.command_knowledge_cards USING btree (deck, status, due_at);
alter table public.command_knowledge_cards enable row level security;

-- command_linkedin_posts
create table if not exists public.command_linkedin_posts (
  id uuid not null default gen_random_uuid(),
  post_date date not null,
  topic text not null,
  angle text,
  body text not null default ''::text,
  status text not null default 'draft'::text,
  posted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  post_type text not null default 'framework'::text,
  pillar text not null default 'value'::text,
  filter_note text
);
do $$ begin alter table public.command_linkedin_posts add constraint command_linkedin_posts_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_linkedin_posts add constraint command_linkedin_posts_post_date_key UNIQUE (post_date); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_linkedin_posts add constraint command_linkedin_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'posted'::text, 'skipped'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_linkedin_posts enable row level security;

-- command_milestones
create table if not exists public.command_milestones (
  id uuid not null default gen_random_uuid(),
  title text not null,
  due_date date not null,
  category text,
  notes text,
  status text not null default 'upcoming'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_milestones add constraint command_milestones_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_milestones add constraint command_milestones_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'done'::text, 'cancelled'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_milestones_due_idx ON public.command_milestones USING btree (status, due_date);
alter table public.command_milestones enable row level security;

-- command_notes
create table if not exists public.command_notes (
  note_key text not null,
  body text not null default ''::text,
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_notes add constraint command_notes_pkey PRIMARY KEY (note_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
alter table public.command_notes enable row level security;

-- command_reviews
create table if not exists public.command_reviews (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  audience text not null default 'me'::text,
  period_start date not null,
  period_end date not null,
  title text not null,
  body text not null,
  followups jsonb not null default '[]'::jsonb,
  status text not null default 'draft'::text,
  sent_to text,
  sent_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_reviews add constraint command_reviews_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_reviews add constraint command_reviews_audience_check CHECK ((audience = ANY (ARRAY['me'::text, 'team'::text, 'investor'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_reviews add constraint command_reviews_kind_check CHECK ((kind = ANY (ARRAY['week'::text, 'month'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_reviews add constraint command_reviews_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_reviews_period_idx ON public.command_reviews USING btree (period_end DESC) WHERE (deleted_at IS NULL);
alter table public.command_reviews enable row level security;

-- command_updates
create table if not exists public.command_updates (
  id uuid not null default gen_random_uuid(),
  entry_date date not null default (now() at time zone public.command_time_zone())::date,
  body text not null,
  brand text,
  share_level text not null default 'private'::text,
  followups jsonb not null default '[]'::jsonb,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.command_updates add constraint command_updates_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_updates add constraint command_updates_body_check CHECK ((length(TRIM(BOTH FROM body)) > 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.command_updates add constraint command_updates_share_level_check CHECK ((share_level = ANY (ARRAY['private'::text, 'team'::text, 'investor'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS command_updates_date_idx ON public.command_updates USING btree (entry_date DESC) WHERE (deleted_at IS NULL);
alter table public.command_updates enable row level security;

-- crm_opportunities
create table if not exists public.crm_opportunities (
  id uuid not null default gen_random_uuid(),
  account_id uuid,
  contact_id uuid,
  pipeline text not null,
  lead_source text not null,
  trigger_type text,
  offer_type text not null,
  stage text not null default 'new'::text,
  problem_spotted text,
  research_notes text,
  personalization_angle text,
  evidence text,
  evidence_url text,
  qualification_grade text,
  outreach_path text,
  search_query text,
  announcement_date date,
  contact_form_url text,
  opportunity_value numeric(10,2),
  amount_paid numeric(10,2) not null default 0,
  last_contacted_at timestamp with time zone,
  next_action_at timestamp with time zone,
  next_action text,
  followup_count integer not null default 0,
  auto_followups_enabled boolean not null default true,
  needs_human boolean not null default false,
  human_reason text,
  gmail_thread_id text,
  gmail_message_id text,
  audit_id text,
  closed_at timestamp with time zone,
  lost_reason text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_amount_paid_check CHECK ((amount_paid >= (0)::numeric)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_followup_count_check CHECK ((followup_count >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_opportunity_value_check CHECK (((opportunity_value IS NULL) OR (opportunity_value >= (0)::numeric))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_qualification_grade_check CHECK (((qualification_grade IS NULL) OR (qualification_grade = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'researching'::text, 'ready_for_review'::text, 'approved_to_send'::text, 'contacted'::text, 'replied'::text, 'interested'::text, 'payment_sent'::text, 'paid'::text, 'audit_in_progress'::text, 'delivered'::text, 'follow_up'::text, 'upsell'::text, 'not_now'::text, 'lost'::text, 'do_not_contact'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_accounts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_opportunities add constraint crm_opportunities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_opportunities_created_at_idx ON public.crm_opportunities USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS crm_opportunities_lead_source_idx ON public.crm_opportunities USING btree (lead_source);
CREATE INDEX IF NOT EXISTS crm_opportunities_next_action_at_idx ON public.crm_opportunities USING btree (next_action_at);
CREATE INDEX IF NOT EXISTS crm_opportunities_account_id_idx ON public.crm_opportunities USING btree (account_id);
CREATE INDEX IF NOT EXISTS crm_opportunities_deleted_at_idx ON public.crm_opportunities USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS crm_opportunities_contact_id_idx ON public.crm_opportunities USING btree (contact_id);
CREATE INDEX IF NOT EXISTS crm_opportunities_stage_idx ON public.crm_opportunities USING btree (stage);
alter table public.crm_opportunities enable row level security;

-- crm_activities
create table if not exists public.crm_activities (
  id uuid not null default gen_random_uuid(),
  opportunity_id uuid,
  account_id uuid,
  contact_id uuid,
  activity_type text not null,
  subject text,
  description text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_activities add constraint crm_activities_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_activities add constraint crm_activities_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_activities add constraint crm_activities_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_accounts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_activities add constraint crm_activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_activities add constraint crm_activities_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_activities_occurred_at_idx ON public.crm_activities USING btree (occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_opportunity_id_idx ON public.crm_activities USING btree (opportunity_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_external_id_idx ON public.crm_activities USING btree (activity_type, external_id) WHERE (external_id IS NOT NULL);
alter table public.crm_activities enable row level security;

-- crm_contact_roles
create table if not exists public.crm_contact_roles (
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  role text not null,
  source_type text,
  source_id text,
  active boolean not null default true,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_contact_roles add constraint crm_contact_roles_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_contact_roles add constraint crm_contact_roles_contact_id_role_source_type_source_id_key UNIQUE (contact_id, role, source_type, source_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_contact_roles add constraint crm_contact_roles_role_check CHECK ((role = ANY (ARRAY['prospect'::text, 'client'::text, 'audit_partner'::text, 'business_coach'::text, 'advisor'::text, 'mentor'::text, 'referral_partner'::text, 'strategic_partner'::text, 'ecosystem_partner'::text, 'program_contact'::text, 'investor_funder'::text, 'vendor'::text, 'other'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_contact_roles add constraint crm_contact_roles_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_contact_roles_contact_idx ON public.crm_contact_roles USING btree (contact_id);
CREATE INDEX IF NOT EXISTS crm_contact_roles_role_idx ON public.crm_contact_roles USING btree (role) WHERE active;
alter table public.crm_contact_roles enable row level security;

-- crm_email_drafts
create table if not exists public.crm_email_drafts (
  id uuid not null default gen_random_uuid(),
  opportunity_id uuid,
  account_id uuid,
  contact_id uuid,
  gmail_thread_id text,
  gmail_message_id text,
  to_email text,
  cc_email text,
  subject text,
  body text,
  draft_type text not null default 'general'::text,
  status text not null default 'draft'::text,
  drafted_by text,
  needs_human boolean not null default true,
  human_reason text,
  audience_type text,
  audience_definition jsonb not null default '{}'::jsonb,
  recipient_count integer,
  scheduled_for timestamp with time zone,
  sent_at timestamp with time zone,
  last_updated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_draft_type_check CHECK ((draft_type = ANY (ARRAY['sales'::text, 'networking'::text, 'client'::text, 'audit_partner'::text, 'grant'::text, 'program'::text, 'follow_up'::text, 'customer_update'::text, 'general'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_recipient_count_check CHECK (((recipient_count IS NULL) OR (recipient_count >= 0))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'needs_review'::text, 'needs_update'::text, 'approved'::text, 'ready_to_send'::text, 'waiting_for_reply'::text, 'sent'::text, 'cancelled'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_accounts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_drafts add constraint crm_email_drafts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_email_drafts_updated_idx ON public.crm_email_drafts USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_drafts_contact_idx ON public.crm_email_drafts USING btree (contact_id);
CREATE INDEX IF NOT EXISTS crm_email_drafts_status_idx ON public.crm_email_drafts USING btree (status);
alter table public.crm_email_drafts enable row level security;

-- crm_email_insights
create table if not exists public.crm_email_insights (
  id uuid not null default gen_random_uuid(),
  gmail_message_id text not null,
  gmail_thread_id text,
  sender_name text,
  sender_email text,
  subject text,
  snippet text,
  received_at timestamp with time zone,
  classification text not null,
  confidence numeric,
  contact_id uuid,
  account_id uuid,
  program_opportunity_id uuid,
  proposed_action text,
  proposed_changes jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending'::text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_gmail_message_id_key UNIQUE (gmail_message_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_classification_check CHECK ((classification = ANY (ARRAY['sales'::text, 'client'::text, 'networking'::text, 'grant_program_opportunity'::text, 'application_update'::text, 'decision_result'::text, 'administrative'::text, 'ignore'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_proposed_changes_check CHECK ((jsonb_typeof(proposed_changes) = 'object'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'dismissed'::text, 'applied'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_accounts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_email_insights add constraint crm_email_insights_program_opportunity_id_fkey FOREIGN KEY (program_opportunity_id) REFERENCES crm_program_opportunities(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_email_insights_thread_idx ON public.crm_email_insights USING btree (gmail_thread_id);
CREATE INDEX IF NOT EXISTS crm_email_insights_contact_idx ON public.crm_email_insights USING btree (contact_id);
CREATE INDEX IF NOT EXISTS crm_email_insights_review_idx ON public.crm_email_insights USING btree (review_status, received_at DESC);
alter table public.crm_email_insights enable row level security;

-- crm_events
create table if not exists public.crm_events (
  id uuid not null default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'::text,
  attempt_count integer not null default 0,
  processed_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_events add constraint crm_events_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_events add constraint crm_events_attempt_count_check CHECK ((attempt_count >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_events add constraint crm_events_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_events add constraint crm_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_events_entity_idx ON public.crm_events USING btree (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS crm_events_status_created_at_idx ON public.crm_events USING btree (status, created_at);
alter table public.crm_events enable row level security;

-- crm_newsletter_subscribers
create table if not exists public.crm_newsletter_subscribers (
  id uuid not null default gen_random_uuid(),
  contact_id uuid,
  email text not null,
  email_normalized text not null,
  full_name text,
  status text not null default 'subscribed'::text,
  suppression_reason text,
  suppressed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_newsletter_subscribers add constraint crm_newsletter_subscribers_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_newsletter_subscribers add constraint crm_newsletter_subscribers_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'suppressed'::text, 'bounced'::text, 'invalid'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_newsletter_subscribers add constraint crm_newsletter_subscribers_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS crm_newsletter_subscribers_contact_idx ON public.crm_newsletter_subscribers USING btree (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_newsletter_subscribers_email_idx ON public.crm_newsletter_subscribers USING btree (email_normalized);
alter table public.crm_newsletter_subscribers enable row level security;

-- crm_newsletter_subscriptions
create table if not exists public.crm_newsletter_subscriptions (
  id uuid not null default gen_random_uuid(),
  subscriber_id uuid not null,
  segment_key text not null,
  status text not null default 'subscribed'::text,
  consent_source text not null,
  consented_at timestamp with time zone not null,
  unsubscribed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_newsletter_subscriptions add constraint crm_newsletter_subscriptions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_newsletter_subscriptions add constraint crm_newsletter_subscriptions_segment_check CHECK ((segment_key = ANY (ARRAY['atara_general'::text, 'smb_ai'::text, 'seo_geo'::text, 'training_partners'::text, 'clients_alumni'::text, 'organizations_ai'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_newsletter_subscriptions add constraint crm_newsletter_subscriptions_source_check CHECK ((consent_source = ANY (ARRAY['website_signup'::text, 'newsletter_signup'::text, 'training_registration'::text, 'event_registration'::text, 'client_onboarding'::text, 'atara_audits_opt_in'::text, 'manual_explicit_permission'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_newsletter_subscriptions add constraint crm_newsletter_subscriptions_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'suppressed'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_newsletter_subscriptions add constraint crm_newsletter_subscriptions_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES crm_newsletter_subscribers(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE UNIQUE INDEX IF NOT EXISTS crm_newsletter_subscriptions_subscriber_segment_idx ON public.crm_newsletter_subscriptions USING btree (subscriber_id, segment_key);
CREATE INDEX IF NOT EXISTS crm_newsletter_subscriptions_segment_status_idx ON public.crm_newsletter_subscriptions USING btree (segment_key, status);
alter table public.crm_newsletter_subscriptions enable row level security;

-- crm_suppressions
create table if not exists public.crm_suppressions (
  id uuid not null default gen_random_uuid(),
  email text not null,
  reason text,
  source text,
  created_at timestamp with time zone not null default now()
);
do $$ begin alter table public.crm_suppressions add constraint crm_suppressions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.crm_suppressions add constraint crm_suppressions_email_key UNIQUE (email); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE UNIQUE INDEX IF NOT EXISTS crm_suppressions_email_lower_idx ON public.crm_suppressions USING btree (lower(email));
alter table public.crm_suppressions enable row level security;

-- work_projects
create table if not exists public.work_projects (
  id uuid not null default gen_random_uuid(),
  name text not null,
  outcome text,
  area text,
  status text not null default 'active'::text,
  priority text not null default 'normal'::text,
  start_date date,
  due_date date,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.work_projects add constraint work_projects_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_projects add constraint work_projects_priority_check CHECK ((priority = ANY (ARRAY['now'::text, 'next'::text, 'normal'::text, 'later'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_projects add constraint work_projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'waiting'::text, 'on_hold'::text, 'completed'::text, 'archived'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS work_projects_status_priority_idx ON public.work_projects USING btree (status, priority);
alter table public.work_projects enable row level security;

-- work_phases
create table if not exists public.work_phases (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  name text not null,
  description text,
  status text not null default 'open'::text,
  target_date date,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
do $$ begin alter table public.work_phases add constraint work_phases_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_phases add constraint work_phases_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text, 'skipped'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_phases add constraint work_phases_project_id_fkey FOREIGN KEY (project_id) REFERENCES work_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS work_phases_project_sort_idx ON public.work_phases USING btree (project_id, sort_order);
alter table public.work_phases enable row level security;

-- work_items
create table if not exists public.work_items (
  id uuid not null default gen_random_uuid(),
  title text not null,
  project_id uuid,
  phase_id uuid,
  category text not null default 'general'::text,
  status text not null default 'open'::text,
  priority text not null default 'normal'::text,
  due_at timestamp with time zone,
  defer_until timestamp with time zone,
  cannot_wait boolean not null default false,
  owner_type text not null default 'founder'::text,
  owner_name text,
  source_type text,
  source_id text,
  notes text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  assigned_agent text
);
do $$ begin alter table public.work_items add constraint work_items_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_category_check CHECK ((category = ANY (ARRAY['general'::text, 'sales'::text, 'networking'::text, 'client'::text, 'grant'::text, 'content'::text, 'audit'::text, 'product'::text, 'admin'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_check CHECK ((((status = 'done'::text) AND (completed_at IS NOT NULL)) OR (status <> 'done'::text))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_owner_type_check CHECK ((owner_type = ANY (ARRAY['founder'::text, 'ai'::text, 'human'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_priority_check CHECK ((priority = ANY (ARRAY['now'::text, 'next'::text, 'normal'::text, 'later'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'waiting'::text, 'done'::text, 'cancelled'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES work_phases(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table public.work_items add constraint work_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES work_projects(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
CREATE INDEX IF NOT EXISTS work_items_assigned_agent_idx ON public.work_items USING btree (assigned_agent) WHERE (assigned_agent IS NOT NULL);
CREATE INDEX IF NOT EXISTS work_items_project_idx ON public.work_items USING btree (project_id);
CREATE INDEX IF NOT EXISTS work_items_actionable_idx ON public.work_items USING btree (status, defer_until, due_at, priority);
CREATE INDEX IF NOT EXISTS work_items_phase_idx ON public.work_items USING btree (phase_id);
CREATE INDEX IF NOT EXISTS work_items_source_idx ON public.work_items USING btree (source_type, source_id);
alter table public.work_items enable row level security;

-- ---------- Functions that need the tables above ----------

create or replace function public.crm_enforce_outreach_safety() returns trigger language plpgsql set search_path to 'public' as $$
declare
  matched_suppression_reason text;
begin
  if new.contact_id is not null then
    select suppression.reason into matched_suppression_reason
    from public.crm_contacts as contact
    join public.crm_suppressions as suppression on lower(suppression.email) = lower(contact.email)
    where contact.id = new.contact_id
    order by suppression.created_at
    limit 1;
    if found then
      new.stage := 'do_not_contact';
      new.auto_followups_enabled := false;
      new.needs_human := false;
      new.human_reason := null;
      return new;
    end if;
  end if;
  if new.qualification_grade = 'C' then
    new.auto_followups_enabled := false;
    new.needs_human := true;
    new.human_reason := coalesce(nullif(new.human_reason, ''), 'Qualification grade C requires human review before outreach');
  end if;
  return new;
end; $$;

-- How many days before a funding deadline to start. Federal programs need the longest runway.
create or replace function public.funding_default_lead_days(o public.crm_program_opportunities) returns int language sql immutable as $$
  select case
    when coalesce(o.title, '') || ' ' || coalesce(o.organization, '') ~* '(sbir|sttr|nih|nsf|national science foundation|national institutes|nidilrr|arpa-h|grants\.gov|department of|administration for community living)' then 45
    when o.opportunity_type in ('accelerator', 'pitch_competition', 'fellowship', 'program') then 14
    when o.opportunity_type in ('grant', 'funding', 'procurement') then 21
    else 7 end
$$;

create or replace function public.funding_set_prep_start() returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.prep_start_at := case when new.deadline_at is null then null
    else (new.deadline_at at time zone public.command_time_zone())::date - coalesce(new.lead_time_days, public.funding_default_lead_days(new)) end;
  return new;
end $$;

-- Creates (or reuses) the account and contact, then the opportunity, in one step.
create or replace function public.crm_create_opportunity(input jsonb) returns jsonb language plpgsql set search_path to 'public' as $$
declare
  account_row public.crm_accounts;
  contact_row public.crm_contacts;
  opportunity_row public.crm_opportunities;
  normalized_domain text := nullif(lower(trim(input->>'domain')), '');
  normalized_email text := nullif(lower(trim(input->>'email')), '');
  account_name text := nullif(trim(input->>'business_name'), '');
  contact_name text := nullif(trim(input->>'contact_name'), '');
  explicit_auto_followups boolean := null;
  suppressed boolean := false;
  suppression_reason text;
  inferred_account_type text;
begin
  if account_name is null then
    raise exception using errcode = '22023', message = 'business_name is required';
  end if;
  if input ? 'auto_followups_enabled' then
    if jsonb_typeof(input->'auto_followups_enabled') <> 'boolean' then
      raise exception using errcode = '22023', message = 'auto_followups_enabled must be boolean';
    end if;
    explicit_auto_followups := (input->>'auto_followups_enabled')::boolean;
  end if;
  perform pg_advisory_xact_lock(hashtext(coalesce(normalized_domain, lower(account_name))));
  if normalized_email is not null then perform pg_advisory_xact_lock(hashtext(normalized_email)); end if;
  if normalized_domain is not null then
    select * into account_row from public.crm_accounts where lower(domain) = normalized_domain order by created_at limit 1;
  end if;
  if account_row.id is null then
    select * into account_row from public.crm_accounts where lower(name) = lower(account_name) order by created_at limit 1;
  end if;
  inferred_account_type := case input->>'pipeline' when 'partner' then 'agency_partner' when 'institutional' then 'smb_support_org' when 'referral' then 'referral_partner' else 'business' end;
  if account_row.id is null then
    insert into public.crm_accounts (name, website, domain, account_type, city, state)
    values (account_name, nullif(trim(input->>'website'), ''), normalized_domain, inferred_account_type, nullif(trim(input->>'city'), ''), nullif(trim(input->>'state'), ''))
    returning * into account_row;
  end if;
  if normalized_email is not null then
    select * into contact_row from public.crm_contacts where lower(email) = normalized_email order by created_at limit 1;
  end if;
  if contact_row.id is null and (contact_name is not null or normalized_email is not null) then
    insert into public.crm_contacts (account_id, full_name, email, job_title, linkedin_url, alignable_url, is_primary)
    values (account_row.id, contact_name, normalized_email, nullif(trim(input->>'contact_title'), ''), nullif(trim(input->>'linkedin_url'), ''), nullif(trim(input->>'alignable_url'), ''), true)
    returning * into contact_row;
  end if;
  if normalized_email is not null then
    select reason into suppression_reason from public.crm_suppressions where lower(email) = normalized_email order by created_at limit 1;
    suppressed := found;
  end if;
  insert into public.crm_opportunities (
    account_id, contact_id, pipeline, lead_source, trigger_type, offer_type, stage, problem_spotted, research_notes,
    personalization_angle, evidence, evidence_url, qualification_grade, outreach_path, search_query, announcement_date,
    contact_form_url, opportunity_value, auto_followups_enabled, needs_human, human_reason
  ) values (
    account_row.id, contact_row.id, coalesce(input->>'pipeline', 'referral'), coalesce(input->>'lead_source', 'manual'),
    nullif(input->>'trigger_type', ''), coalesce(input->>'offer_type', 'other'),
    case when suppressed then 'do_not_contact' else 'new' end,
    nullif(trim(input->>'problem_spotted'), ''), nullif(trim(input->>'research_notes'), ''), nullif(trim(input->>'personalization_angle'), ''),
    nullif(trim(input->>'evidence'), ''), nullif(trim(input->>'evidence_url'), ''), nullif(input->>'qualification_grade', ''),
    nullif(trim(input->>'outreach_path'), ''), nullif(trim(input->>'search_query'), ''), nullif(input->>'announcement_date', '')::date,
    nullif(trim(input->>'contact_form_url'), ''), nullif(input->>'opportunity_value', '')::numeric,
    case when suppressed then false when explicit_auto_followups is not null then explicit_auto_followups else false end,
    false, null
  ) returning * into opportunity_row;
  insert into public.crm_activities (opportunity_id, account_id, contact_id, activity_type, subject, metadata)
  values (opportunity_row.id, account_row.id, contact_row.id, 'lead_created', 'Opportunity created',
    jsonb_strip_nulls(jsonb_build_object('lead_source', opportunity_row.lead_source, 'suppressed', suppressed, 'suppression_reason', suppression_reason)));
  insert into public.crm_events (event_type, entity_type, entity_id, payload)
  values ('lead.created', 'opportunity', opportunity_row.id, jsonb_build_object('account_id', account_row.id, 'contact_id', contact_row.id, 'suppressed', suppressed));
  return jsonb_build_object('opportunity', to_jsonb(opportunity_row), 'account', to_jsonb(account_row),
    'contact', case when contact_row.id is null then null else to_jsonb(contact_row) end, 'suppressed', suppressed);
end; $$;

-- Money: one summary row per month (Money starts switched off in settings).
create or replace view public.command_finance_month_summary as
 select t.month,
    (coalesce(sum(t.amount) filter (where t.txn_type = 'income'), 0))::numeric(12,2) as business_income,
    (coalesce(-sum(t.amount) filter (where t.txn_type = 'expense' and t.include_in_opex), 0))::numeric(12,2) as business_opex,
    (coalesce(sum(t.amount) filter (where t.txn_type = any (array['personal_transfer', 'owner_contribution'])), 0))::numeric(12,2) as owner_personal,
    count(*) filter (where t.category = 'Needs review') as needs_review,
    count(*) filter (where t.evidence_status = 'missing') as missing_evidence,
    count(*) filter (where not t.reviewed) as unreviewed,
    count(*) as transaction_count,
    coalesce(c.statement_imported, false) as statement_imported,
    coalesce(c.statement_balance_checked, false) as statement_balance_checked,
    c.closed_at
   from public.command_finance_transactions t
     left join public.command_finance_month_closes c on c.month = t.month
  group by t.month, c.statement_imported, c.statement_balance_checked, c.closed_at;

-- Private file storage for Funding documents.
insert into storage.buckets (id, name, public) values ('personal-docs', 'personal-docs', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('know-docs', 'know-docs', false) on conflict (id) do nothing;

-- The Funding Ready Kit: reusable pieces most applications ask for. Everything starts as not started.
insert into public.command_funding_kit (key, label, category, refresh_days, refresh_rule, sort) values
  ('sam_gov', 'SAM.gov registration', 'registration', 365, null, 1),
  ('grants_gov', 'Grants.gov organization account', 'registration', null, 'once', 2),
  ('sba_registry', 'SBA Company Registry (SBC Control ID)', 'registration', null, 'once', 3),
  ('research_gov', 'Research.gov account (NSF)', 'registration', null, 'once', 4),
  ('era_commons', 'eRA Commons (NIH)', 'registration', null, 'once', 5),
  ('login_gov', 'Login.gov', 'registration', null, 'once', 6),
  ('pitch_deck', 'Pitch deck', 'document', 60, null, 10),
  ('exec_summary', 'Executive summary', 'document', 60, null, 11),
  ('one_pager', 'One-pager', 'document', 60, null, 12),
  ('traction_numbers', 'Traction numbers', 'document', 7, null, 13),
  ('founder_video', 'Founder video', 'document', 90, null, 14),
  ('demo_video', 'Demo video', 'document', 90, null, 15),
  ('budget_10k_50k_100k_300k', 'Budgets at $10K, $50K, $100K and $300K', 'document', 90, null, 16),
  ('team_bios', 'Team bios', 'document', 90, null, 17),
  ('letters_of_support', 'Letters of support', 'document', null, 'none', 18),
  ('company_docs_ein_w9_good_standing', 'Company papers, EIN, W-9, good standing', 'document', 365, null, 19),
  ('cap_table', 'Cap table', 'document', null, 'on change', 20)
on conflict (key) do nothing;

-- Marks the schema version so Command's first run knows setup is done.
insert into public.command_notes (note_key, body) values ('schema_version', '1') on conflict (note_key) do update set body = excluded.body, updated_at = now();

-- ---------- Triggers ----------
CREATE OR REPLACE TRIGGER command_export_documents_set_updated_at BEFORE UPDATE ON public.command_export_documents FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER command_living_docs_set_updated_at BEFORE UPDATE ON public.command_living_docs FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_accounts_set_updated_at BEFORE UPDATE ON public.crm_accounts FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_activities_are_immutable BEFORE DELETE OR UPDATE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION crm_prevent_activity_mutation();
CREATE OR REPLACE TRIGGER crm_contact_roles_set_updated_at BEFORE UPDATE ON public.crm_contact_roles FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_contacts_set_updated_at BEFORE UPDATE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_email_drafts_set_updated_at BEFORE UPDATE ON public.crm_email_drafts FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_email_insights_set_updated_at BEFORE UPDATE ON public.crm_email_insights FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_opportunities_enforce_outreach_safety BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION crm_enforce_outreach_safety();
CREATE OR REPLACE TRIGGER crm_opportunities_set_updated_at BEFORE UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER crm_program_opportunities_set_updated_at BEFORE UPDATE ON public.crm_program_opportunities FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER funding_prep_start BEFORE INSERT OR UPDATE OF deadline_at, lead_time_days, title, organization, opportunity_type ON public.crm_program_opportunities FOR EACH ROW EXECUTE FUNCTION funding_set_prep_start();
CREATE OR REPLACE TRIGGER work_items_set_updated_at BEFORE UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER work_phases_set_updated_at BEFORE UPDATE ON public.work_phases FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE OR REPLACE TRIGGER work_projects_set_updated_at BEFORE UPDATE ON public.work_projects FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
