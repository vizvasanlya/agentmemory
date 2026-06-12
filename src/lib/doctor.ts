import type { MemoryHealth } from './types.js';

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  recommendations: string[];
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
}

export function buildDoctorReport(health: MemoryHealth): DoctorReport {
  const checks: DoctorCheck[] = [];
  const recommendations: string[] = [];

  checks.push({
    name: 'memory-count',
    ok: health.total > 0,
    message: health.total > 0 ? `${health.total} memories found` : 'No memories found yet'
  });

  if (health.total === 0) {
    recommendations.push('Run `agentmemory index` or `agentmemory learn` to create the first project memories.');
  }

  checks.push({
    name: 'duplicate-memory',
    ok: health.duplicatePairs === 0,
    message: health.duplicatePairs === 0 ? 'No duplicate memories detected' : `${health.duplicatePairs} duplicate pairs detected`
  });

  if (health.duplicatePairs > 0) {
    recommendations.push('Run `agentmemory duplicates` and merge or delete duplicate memories.');
  }

  checks.push({
    name: 'expired-memory',
    ok: health.expired === 0,
    message: health.expired === 0 ? 'No expired memories' : `${health.expired} expired memories found`
  });

  if (health.expired > 0) {
    recommendations.push('Delete or refresh expired memories with `agentmemory forget <id>` or `agentmemory edit <id>`.');
  }

  checks.push({
    name: 'memory-freshness',
    ok: !health.newestUpdatedAt || Date.now() - new Date(health.newestUpdatedAt).getTime() < 30 * 86_400_000,
    message: health.newestUpdatedAt ? `Newest memory updated ${health.newestUpdatedAt}` : 'No newest memory timestamp'
  });

  if (health.newestUpdatedAt && Date.now() - new Date(health.newestUpdatedAt).getTime() > 30 * 86_400_000) {
    recommendations.push('Memory has not been updated in over 30 days. Run `agentmemory learn` after your next agent session.');
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    recommendations
  };
}
