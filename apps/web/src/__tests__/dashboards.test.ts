/**
 * Smoke test JSON schema do dashboard Grafana Agent Health (Story 2.11 AC10).
 *
 * Defesa em profundidade contra dashboard JSON malformado pre-merge.
 * Valida:
 *   - Ficheiro existe e é JSON parseável.
 *   - `panels.length === 6` (Story 2.11 AC1 — 6 painéis obrigatórios).
 *   - Cada painel tem `title` (string não-vazia).
 *   - Cada painel tem `targets[0].expr` (PromQL/LogQL não-vazia).
 *   - Top-level `uid` é `expressia-agent-health` (canonical identifier).
 *
 * Trace: Story 2.11 AC10 + [AUTO-DECISION D63] @sm.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = path.resolve(HERE, '../../../../docs/dashboards/grafana-agent-health.json');

interface DashboardPanel {
  readonly id: number;
  readonly title: string;
  readonly type: string;
  readonly targets: ReadonlyArray<{ readonly refId: string; readonly expr: string }>;
}

interface Dashboard {
  readonly uid: string;
  readonly title: string;
  readonly panels: ReadonlyArray<DashboardPanel>;
}

describe('docs/dashboards/grafana-agent-health.json — Story 2.11 AC10 smoke', () => {
  it('JSON é parseável e tem 6 painéis com title + query não-vazios', () => {
    const raw = readFileSync(DASHBOARD_PATH, 'utf8');
    const dashboard = JSON.parse(raw) as Dashboard;

    expect(dashboard.uid).toBe('expressia-agent-health');
    expect(dashboard.title).toContain('Agent Health');
    expect(dashboard.panels).toBeDefined();
    expect(dashboard.panels.length).toBe(6);

    for (const panel of dashboard.panels) {
      expect(panel.title).toMatch(/.+/);
      expect(panel.targets.length).toBeGreaterThan(0);
      const firstTarget = panel.targets[0];
      expect(firstTarget).toBeDefined();
      expect(firstTarget!.expr).toMatch(/\S/);
    }
  });
});
