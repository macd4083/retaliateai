import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath = '/home/runner/work/retaliateai/retaliateai/supabase/migrations/20260928_today_v2_workflow.sql';
const featureMigrationPath = '/home/runner/work/retaliateai/retaliateai/supabase/migrations/20261006_today_v2_controllable_and_first_five.sql';
const consolidatedSqlPath = '/home/runner/work/retaliateai/retaliateai/supabase/sql/today_v2_isolated_workflow.sql';
const todayV2ServicePath = '/home/runner/work/retaliateai/retaliateai/src/v2/services/todayReview.js';

describe('TodayV2 SQL contract', () => {
  it('keeps the migration and SQL editor copy in sync', () => {
    const consolidatedSql = fs.readFileSync(consolidatedSqlPath, 'utf8');
    const initialMigration = fs.readFileSync(migrationPath, 'utf8');
    const featureMigration = fs.readFileSync(featureMigrationPath, 'utf8');

    expect(consolidatedSql.startsWith(initialMigration)).toBe(true);
    expect(consolidatedSql.slice(initialMigration.length).trim()).toBe(featureMigration.trim());
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
