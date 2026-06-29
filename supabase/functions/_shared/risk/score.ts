// Transparent, auditable risk scoring. Deliberately a linear weighted model —
// NOT an LLM — so every score is explainable (component_breakdown_json) and the
// CEO can tune weights. Claude is used only to narrate a high score, never to
// compute it.

export interface RiskFactor {
  key: string;
  /** Normalized 0..1 intensity of this factor over the scoring window. */
  value: number;
}

export interface RiskWeights {
  [factorKey: string]: number;
}

export interface RiskResult {
  totalScore: number;                 // 0..100
  tier: 'low' | 'elevated' | 'high' | 'critical';
  breakdown: Record<string, { value: number; weight: number; contribution: number }>;
}

function tierFor(score: number): RiskResult['tier'] {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'elevated';
  return 'low';
}

/**
 * Weighted sum normalized to 0..100. With factor values in [0,1] and arbitrary
 * positive weights, the raw sum is divided by the total possible (Σ weights) so
 * the result is a clean percentage that the dashboard can render as a gauge.
 */
export function computeRisk(factors: RiskFactor[], weights: RiskWeights): RiskResult {
  const breakdown: RiskResult['breakdown'] = {};
  let weighted = 0;
  let maxWeighted = 0;

  for (const f of factors) {
    const w = weights[f.key] ?? 0;
    const v = Math.max(0, Math.min(1, f.value));
    const contribution = v * w;
    weighted += contribution;
    maxWeighted += w;                 // max when every factor is at 1.0
    breakdown[f.key] = { value: v, weight: w, contribution };
  }

  const totalScore = maxWeighted > 0 ? Math.round((weighted / maxWeighted) * 100) : 0;
  // Re-express contributions as their share of the 0..100 score (transparency).
  if (maxWeighted > 0) {
    for (const k of Object.keys(breakdown)) {
      breakdown[k].contribution = Math.round((breakdown[k].contribution / maxWeighted) * 100);
    }
  }
  return { totalScore, tier: tierFor(totalScore), breakdown };
}
