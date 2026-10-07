import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(repositoryRoot, 'supabase/migrations/20260928_today_v2_workflow.sql');
const featureMigrationPath = path.join(repositoryRoot, 'supabase/migrations/20261006_today_v2_controllable_and_first_five.sql');
const schedulingMigrationPath = path.join(repositoryRoot, 'supabase/migrations/20261007_today_v2_scheduling.sql');
const lockMigrationPath = path.join(repositoryRoot, 'supabase/migrations/20261008_today_v2_schedule_review_lock.sql');
const releaseGuardPath = path.join(repositoryRoot, 'supabase/migrations/20261009_today_v2_completion_release_guard.sql');
const recurrenceMigrationPath = path.join(repositoryRoot, 'supabase/migrations/20261010_today_v2_habit_recurrence.sql');
const consolidatedSqlPath = path.join(repositoryRoot, 'supabase/sql/today_v2_isolated_workflow.sql');
const todayV2ServicePath = path.join(repositoryRoot, 'src/v2/services/todayReview.js');

describe('TodayV2 SQL contract', () => {
  it('keeps the migration and SQL editor copy in sync', () => {
    const consolidatedSql = fs.readFileSync(consolidatedSqlPath, 'utf8');
    const initialMigration = fs.readFileSync(migrationPath, 'utf8');
    const featureMigration = fs.readFileSync(featureMigrationPath, 'utf8');
    const schedulingMigration = fs.readFileSync(schedulingMigrationPath, 'utf8');
    const lockMigration = fs.readFileSync(lockMigrationPath, 'utf8');
    const releaseGuard = fs.readFileSync(releaseGuardPath, 'utf8');
    const recurrenceMigration = fs.readFileSync(recurrenceMigrationPath, 'utf8');

    expect(consolidatedSql.startsWith(initialMigration)).toBe(true);
    expect(consolidatedSql.slice(initialMigration.length).trim()).toBe(
      `${featureMigration.trim()}\n\n${schedulingMigration.trim()}\n\n${lockMigration.trim()}\n\n${releaseGuard.trim()}\n\n${recurrenceMigration.trim()}`
    );
    expect(consolidatedSql.endsWith(recurrenceMigration)).toBe(true);
  });

  it('serializes all schedule and plan mutations against their owned source review while allowing outcome-only writes', () => {
    const sql = fs.readFileSync(lockMigrationPath, 'utf8');
    expect(sql).toContain('foreign key (user_id, source_review_id)');
    expect(sql).toContain('alter column source_review_id set not null');
    expect(sql).toContain('where user_id = p_user_id and local_date = p_local_date for update');
    expect(sql).toContain('if v_review.completed_at is not null then');
    expect(sql).toContain("v_date := new.target_local_date - 1");
    expect(sql).toContain('select source_local_date into strict v_date');
    expect(sql).toContain('before insert or update or delete on public.today_v2_schedule_blocks');
    expect(sql).toContain("array['completion_state','answered_at','updated_at']");
    expect(sql).toContain('before insert or update or delete on public.today_v2_plan_inputs');
    expect(sql).toContain('before insert or update or delete on public.today_v2_commitment_fragments');
    expect(sql).toContain("to_regprocedure('public.today_v2_replace_plan_stable_unlocked");
    expect(sql).toContain('revoke all on function public.today_v2_replace_plan_stable_unlocked');
    expect(sql).toContain('disable trigger today_v2_schedule_validate');
    expect(sql).toContain('enable trigger today_v2_schedule_validate');
    expect(sql).toContain('disable trigger today_v2_schedule_set_updated_at');
    expect(sql).toContain('references public.today_v2_daily_reviews(user_id, id) on delete cascade');
    expect(sql).toContain("confdeltype <> 'c'");
    expect(sql).toContain('pg_trigger_depth() > 1');
    expect(sql).toContain('execute $today_v2_repair_ddl$');
  });

  it('defines owned source-linked schedule blocks with local-date and duration guards', () => {
    const sql = fs.readFileSync(schedulingMigrationPath, 'utf8');

    expect(sql).toContain('create table if not exists public.today_v2_schedule_blocks');
    expect(sql).toContain('(commitment_fragment_id is not null) <> (habit_definition_id is not null)');
    expect(sql).toContain('foreign key (user_id, target_local_date, commitment_fragment_id)');
    expect(sql).toContain('references public.today_v2_commitment_fragments(user_id, target_local_date, id) on delete cascade');
    expect(sql).toContain('foreign key (user_id, habit_definition_id)');
    expect(sql).toContain('unique (user_id, target_local_date, commitment_fragment_id)');
    expect(sql).toContain('unique (user_id, target_local_date, habit_definition_id)');
    expect(sql).toContain("ends_at > starts_at and ends_at - starts_at <= interval '24 hours'");
    expect(sql).toContain('isfinite(starts_at) and isfinite(ends_at)');
    expect(sql).toContain('pg_timezone_names where name = new.timezone_name');
    expect(sql).toContain('(new.starts_at at time zone new.timezone_name)::date <> new.target_local_date');
    expect(sql).toContain('extract(dow from new.target_local_date)::smallint = any(schedule_weekdays)');
    expect(sql).toContain('and not is_archived');
    expect(sql).toContain('alter table public.today_v2_schedule_blocks enable row level security;');
    expect(sql).toContain('using (auth.uid() = user_id)');
    expect(sql).toContain('grant select on public.today_v2_schedule_blocks to authenticated;');
    expect(sql).not.toMatch(/grant\s+[^;]*(?:insert|update|delete)[^;]*today_v2_schedule_blocks[^;]*to authenticated/i);
  });

  it('replaces plans by stable identity and serializes atomic schedule replacement', () => {
    const sql = fs.readFileSync(schedulingMigrationPath, 'utf8');
    const stablePlanSql = sql.split('create or replace function public.today_v2_replace_plan_stable(')[1]
      .split('-- Legacy positional callers')[0];

    expect(stablePlanSql).toContain('p_fragment_texts text[], p_fragment_ids uuid[]');
    expect(stablePlanSql).toContain('returns setof public.today_v2_commitment_fragments');
    expect(stablePlanSql).toContain('p_first_five_minutes text default null');
    expect(stablePlanSql).toContain('cardinality(p_fragment_texts)');
    expect(stablePlanSql).toContain('cardinality(p_fragment_ids)');
    expect(stablePlanSql).toContain("raise exception 'Duplicate fragment IDs'");
    expect(stablePlanSql).toContain('f.id = i and f.user_id = v_user_id and f.target_local_date = p_target_local_date');
    expect(stablePlanSql).toContain("completion_state <> 'unanswered'");
    expect(stablePlanSql).toContain('set fragment_order = fragment_order + v_offset');
    expect(stablePlanSql).toContain('if v_entry.i is null then');
    expect(stablePlanSql).toContain('where id = v_entry.i and user_id = v_user_id and target_local_date = p_target_local_date');
    expect(stablePlanSql).not.toContain('on conflict (user_id, target_local_date, fragment_order)');
    expect(sql).not.toContain('grant delete on public.today_v2_commitment_fragments to authenticated;');
    expect(sql).not.toContain('create policy "today_v2 unanswered fragments delete"');
    expect(sql).toContain('create or replace function public.today_v2_replace_schedule(');
    expect(sql).toContain('p_target_local_date date, p_timezone_name text, p_blocks jsonb');
    expect(sql).toContain('returns setof public.today_v2_schedule_blocks');
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(v_user_id::text');
    expect(sql).toContain("jsonb_typeof(p_blocks) <> 'array'");
    expect(sql).toContain('from jsonb_to_recordset(p_blocks)');
    expect(sql).toContain('commitment_fragment_id uuid, habit_definition_id uuid, starts_at timestamptz, ends_at timestamptz');
  });

  it('keeps legacy five/six-argument calls safe and archives only future habit schedules', () => {
    const sql = fs.readFileSync(schedulingMigrationPath, 'utf8');
    const legacySql = sql.split('-- Legacy positional callers')[1]
      .split('create or replace function public.today_v2_replace_schedule(')[0];
    const archiveSql = sql.split('create or replace function public.today_v2_archive_habit_schedule()')[1]
      .split('drop trigger if exists today_v2_archive_habit_schedule')[0];

    expect(sql).toContain('add column if not exists first_five_minutes text');
    expect(legacySql).toContain('drop function if exists public.today_v2_replace_plan_for_date(date, date, text, text, text[]);');
    expect(legacySql).toContain('p_first_five_minutes text default null');
    expect(legacySql).toContain('delete from public.today_v2_schedule_blocks b');
    expect(legacySql).toContain('ord - 1 = f.fragment_order and trim(t) = f.fragment_text');
    expect(legacySql).toContain('perform public.today_v2_replace_plan_stable(');
    expect(archiveSql).toContain('if new.is_archived and not old.is_archived then');
    expect(archiveSql).toContain('habit_definition_id = new.id and starts_at >= now()');
    expect(archiveSql).toContain('r.local_date = today_v2_schedule_blocks.target_local_date');
    expect(archiveSql).toContain('and r.completed_at is not null');
    expect(archiveSql).not.toContain('today_v2_habit_occurrences');
    expect(archiveSql).not.toContain('today_v2_commitment_fragments');
  });

  it('restricts Google credentials and one-use state consumption to backend service role', () => {
    const sql = fs.readFileSync(schedulingMigrationPath, 'utf8');
    const stateRpcSql = sql.split('create or replace function public.today_v2_consume_google_state(p_state_hash text)')[1];

    expect(sql).toContain('create table if not exists public.today_v2_google_connections');
    expect(sql).toContain('tokens_encrypted text not null');
    expect(sql).toContain("selected_calendar_ids text[] not null default '{}'");
    expect(sql).toContain('create table if not exists public.today_v2_google_oauth_states');
    expect(sql).toContain('state_hash text primary key');
    expect(sql).toContain('verifier_encrypted text not null');
    expect(sql).toContain('return_path text not null');
    expect(sql).toContain('alter table public.today_v2_google_connections enable row level security;');
    expect(sql).toContain('alter table public.today_v2_google_oauth_states enable row level security;');
    expect(sql).toContain('revoke all on public.today_v2_google_connections, public.today_v2_google_oauth_states from public, anon, authenticated;');
    expect(sql).toContain('grant all on public.today_v2_google_connections, public.today_v2_google_oauth_states to service_role;');
    expect(stateRpcSql).toContain('returns setof public.today_v2_google_oauth_states');
    expect(stateRpcSql).toContain('delete from public.today_v2_google_oauth_states');
    expect(stateRpcSql).toContain('where state_hash = p_state_hash and expires_at > now()');
    expect(stateRpcSql).toContain('returning *;');
    expect(stateRpcSql).toContain('revoke all on function public.today_v2_consume_google_state(text) from public, anon, authenticated;');
    expect(stateRpcSql).toContain('grant execute on function public.today_v2_consume_google_state(text) to service_role;');
  });

  it('adds autosaved fields and the guarded plan RPC argument', () => {
    const sql = fs.readFileSync(featureMigrationPath, 'utf8');

    expect(sql).toContain('add column if not exists controllable_focus text');
    expect(sql).toContain('add column if not exists first_five_minutes text');
    expect(sql).toContain('p_first_five_minutes text default null');
    expect(sql).toContain('first_five_minutes = excluded.first_five_minutes');
    expect(sql).toContain('on conflict (user_id, target_local_date, fragment_order)');
    expect(sql).toContain('and not (fragment_order = any(v_keep_orders))');
    expect(sql).toContain('cannot overwrite answered fragments');
    expect(sql).toContain('grant execute on function public.today_v2_replace_plan_for_date(date, date, text, text, text[], text) to authenticated;');
  });

  it('atomically finalizes Google authorization from unexpired state with backend-only execution', () => {
    const sql = fs.readFileSync(schedulingMigrationPath, 'utf8');
    const finishSql = sql.split('create or replace function public.today_v2_finish_google_authorization(')[1];

    expect(finishSql).toContain('p_state_hash text, p_tokens_encrypted text, p_selected_calendar_ids text[]');
    expect(finishSql).toContain('returns setof public.today_v2_google_connections');
    expect(finishSql).toContain('with consumed_state as (');
    expect(finishSql).toContain('delete from public.today_v2_google_oauth_states');
    expect(finishSql).toContain('where state_hash = p_state_hash and expires_at > now()');
    expect(finishSql).toContain('returning user_id');
    expect(finishSql).toContain('insert into public.today_v2_google_connections(user_id, tokens_encrypted, selected_calendar_ids)');
    expect(finishSql).toContain('from consumed_state');
    expect(finishSql).toContain('on conflict (user_id) do update set');
    expect(finishSql).toContain('tokens_encrypted = excluded.tokens_encrypted');
    expect(finishSql).toContain('revoke all on function public.today_v2_finish_google_authorization(text, text, text[]) from public, anon, authenticated;');
    expect(finishSql).toContain('grant execute on function public.today_v2_finish_google_authorization(text, text, text[]) to service_role;');
  });

  it('defines isolated today_v2 tables, RPCs, uniqueness, and RLS', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists public.today_v2_daily_reviews');
    expect(sql).toContain('create table if not exists public.today_v2_plan_inputs');
    expect(sql).toContain('completed_at timestamptz');
    expect(sql).toContain('create table if not exists public.today_v2_commitment_fragments');
    expect(sql).toContain('create table if not exists public.today_v2_habit_definitions');
    expect(sql).toContain('create table if not exists public.today_v2_habit_occurrences');
    expect(sql).toContain('today_v2_seed_default_habits_for_user');
    expect(sql).toContain('today_v2_replace_plan_for_date');
    expect(sql).toContain('today_v2_ensure_habit_occurrences_for_date');
    expect(sql).toContain('today_v2_commitment_fragments_user_target_order_unique');
    expect(sql).toContain('today_v2_habit_occurrences_user_habit_date_unique');
    expect(sql).toContain('alter table public.today_v2_daily_reviews enable row level security;');
    expect(sql).toContain('grant select, insert, update on public.today_v2_commitment_fragments to authenticated;');
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it('does not reference superseded generic V2 or legacy persistence objects', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const serviceSource = fs.readFileSync(todayV2ServicePath, 'utf8');

    expect(sql).not.toContain('public.seed_default_habits_for_user');
    expect(sql).not.toContain('replace_v2_planned_actions');
    expect(sql).not.toContain('public.v2_daily_reviews');
    expect(sql).not.toContain('public.v2_planned_actions');
    expect(sql).not.toContain('public.v2_follow_through_items');
    expect(serviceSource).not.toContain('reflection_sessions');
    expect(serviceSource).not.toContain('reflection_messages');
    expect(serviceSource).not.toContain('follow_up_queue');
    expect(serviceSource).not.toContain('growth_markers');
    expect(serviceSource).not.toContain('goal_commitment_log');
    expect(serviceSource).not.toContain('seed_default_habits_for_user');
    expect(serviceSource).not.toContain('replace_v2_planned_actions');
  });
});
