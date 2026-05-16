// @vitest-environment node
/**
 * Tests pure helper `groupTasksBySections` + `getDaysOverdue` (Story 3.3 T9.8 / AC5+AC6).
 *
 * Cobertura ≥8 tests: empty input, atrasadas first FR11, today/tomorrow/this_week/later/
 * no_due_date buckets, completed_today filter, archived silently excluded, week boundary,
 * DST PT 2026 (March + October), null due_date, getDaysOverdue PT-PT.
 */
import { describe, expect, it } from 'vitest';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import {
  getDaysOverdue,
  groupTasksBySections,
  getTodayLisbon,
} from '@/app/(app)/tarefas/_lib/task-sections';

function makeTask(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: 't1',
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: 'Tarefa',
    description: null,
    due_date: null,
    due_time: null,
    priority: 'medium',
    status: 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

// Reference date: 2026-05-16 (Saturday) ~ 12:00 Lisbon
const NOW = new Date('2026-05-16T12:00:00.000Z');

describe('groupTasksBySections', () => {
  it('retorna lista vazia quando input vazio', () => {
    const sections = groupTasksBySections([], NOW);
    expect(sections).toEqual([]);
  });

  it('FR11 — Atrasadas SEMPRE em primeiro quando non-empty', () => {
    const tasks = [
      makeTask({ id: 'today1', due_date: '2026-05-16' }),
      makeTask({ id: 'late1', due_date: '2026-05-10' }),
      makeTask({ id: 'tom1', due_date: '2026-05-17' }),
    ];
    const sections = groupTasksBySections(tasks, NOW);
    expect(sections[0]!.key).toBe('overdue');
    expect(sections[0]!.variant).toBe('danger');
    expect(sections[0]!.tasks.map((t) => t.id)).toEqual(['late1']);
    expect(sections[0]!.label).toMatch(/Atrasadas/);
  });

  it('agrupa Hoje/Amanhã/Esta semana/Mais tarde correctamente', () => {
    const tasks = [
      makeTask({ id: 'today', due_date: '2026-05-16' }),
      makeTask({ id: 'tomorrow', due_date: '2026-05-17' }),
      makeTask({ id: 'this_week', due_date: '2026-05-20' }),
      makeTask({ id: 'later', due_date: '2026-06-10' }),
    ];
    const sections = groupTasksBySections(tasks, NOW);
    const keys = sections.map((s) => s.key);
    expect(keys).toEqual(['today', 'tomorrow', 'this_week', 'later']);
    expect(sections.find((s) => s.key === 'today')?.label).toMatch(/Hoje · 16\/05\/2026/);
    expect(sections.find((s) => s.key === 'tomorrow')?.label).toMatch(/Amanhã · 17\/05\/2026/);
  });

  it('week boundary — dia today+6 entra em this_week; today+7 entra em later', () => {
    const tasks = [
      makeTask({ id: 'd6', due_date: '2026-05-22' }), // today+6 (Friday)
      makeTask({ id: 'd7', due_date: '2026-05-23' }), // today+7 (Saturday)
    ];
    const sections = groupTasksBySections(tasks, NOW);
    expect(sections.find((s) => s.key === 'this_week')?.tasks.map((t) => t.id)).toEqual(['d6']);
    expect(sections.find((s) => s.key === 'later')?.tasks.map((t) => t.id)).toEqual(['d7']);
  });

  it('tarefa sem due_date entra em "Sem prazo"', () => {
    const tasks = [makeTask({ id: 'nd', due_date: null })];
    const sections = groupTasksBySections(tasks, NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.key).toBe('no_due_date');
    expect(sections[0]!.label).toBe('Sem prazo');
  });

  it('tarefas archived são silently excluídas', () => {
    const tasks = [
      makeTask({ id: 'arc', due_date: '2026-05-16', status: 'archived' }),
      makeTask({ id: 'today', due_date: '2026-05-16', status: 'todo' }),
    ];
    const sections = groupTasksBySections(tasks, NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.key).toBe('today');
    expect(sections[0]!.tasks).toHaveLength(1);
  });

  it('done com completed_at >= todayLisbon entra em Concluídas hoje (variant success)', () => {
    const tasks = [
      makeTask({
        id: 'done_today',
        status: 'done',
        completed_at: '2026-05-16T08:00:00.000Z',
      }),
      makeTask({
        id: 'done_yesterday',
        status: 'done',
        completed_at: '2026-05-15T20:00:00.000Z',
      }),
    ];
    const sections = groupTasksBySections(tasks, NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.key).toBe('completed_today');
    expect(sections[0]!.variant).toBe('success');
    expect(sections[0]!.tasks.map((t) => t.id)).toEqual(['done_today']);
  });

  it('DST PT — boundary 2026-03-29 (last Sunday March) calcula today correctamente', () => {
    // DST PT spring-forward: 29 March 2026 02:00 UTC → 03:00 WEST
    const dstMar = new Date('2026-03-29T12:00:00.000Z');
    const today = getTodayLisbon(dstMar);
    // Expect a Date no Lisbon midnight de 29/03
    expect(today.getDate()).toBe(29);
    expect(today.getMonth()).toBe(2); // March = month 2

    const tasks = [makeTask({ id: 'dst_today', due_date: '2026-03-29' })];
    const sections = groupTasksBySections(tasks, dstMar);
    expect(sections[0]!.key).toBe('today');
  });

  it('DST PT — boundary 2026-10-25 (last Sunday October) calcula today correctamente', () => {
    // DST PT fall-back: 25 October 2026 02:00 WEST → 01:00 WET
    const dstOct = new Date('2026-10-25T12:00:00.000Z');
    const today = getTodayLisbon(dstOct);
    expect(today.getDate()).toBe(25);
    expect(today.getMonth()).toBe(9); // October = month 9

    const tasks = [makeTask({ id: 'dst_today', due_date: '2026-10-25' })];
    const sections = groupTasksBySections(tasks, dstOct);
    expect(sections[0]!.key).toBe('today');
  });

  it('ordem fixa de display: overdue → today → tomorrow → this_week → later → no_due_date → completed_today', () => {
    const tasks = [
      makeTask({ id: 'ct', status: 'done', completed_at: '2026-05-16T08:00:00.000Z' }),
      makeTask({ id: 'nd', due_date: null }),
      makeTask({ id: 'later', due_date: '2026-06-10' }),
      makeTask({ id: 'tw', due_date: '2026-05-20' }),
      makeTask({ id: 'tom', due_date: '2026-05-17' }),
      makeTask({ id: 'today', due_date: '2026-05-16' }),
      makeTask({ id: 'late', due_date: '2026-05-10' }),
    ];
    const sections = groupTasksBySections(tasks, NOW);
    expect(sections.map((s) => s.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'this_week',
      'later',
      'no_due_date',
      'completed_today',
    ]);
  });
});

describe('getDaysOverdue', () => {
  it('retorna null quando due_date é null', () => {
    expect(getDaysOverdue(null, NOW)).toBeNull();
  });

  it('retorna null quando due_date é hoje ou futuro', () => {
    expect(getDaysOverdue('2026-05-16', NOW)).toBeNull();
    expect(getDaysOverdue('2026-05-17', NOW)).toBeNull();
  });

  it('formata "há 1 dia" para 1 dia atrasado', () => {
    expect(getDaysOverdue('2026-05-15', NOW)).toBe('há 1 dia');
  });

  it('formata "há N dias" para 2-6 dias atrasados', () => {
    expect(getDaysOverdue('2026-05-14', NOW)).toBe('há 2 dias');
    expect(getDaysOverdue('2026-05-11', NOW)).toBe('há 5 dias');
  });

  it('formata "há 1 semana" para 7-13 dias atrasados', () => {
    expect(getDaysOverdue('2026-05-09', NOW)).toBe('há 1 semana');
  });

  it('formata "há N semanas" para 14-30 dias atrasados', () => {
    expect(getDaysOverdue('2026-04-30', NOW)).toBe('há 2 semanas');
  });

  it('formata "há mais de 1 mês" para > 60 dias atrasados', () => {
    expect(getDaysOverdue('2026-01-01', NOW)).toBe('há mais de 1 mês');
  });
});
