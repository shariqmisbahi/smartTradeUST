// src/app/rule-engine/models/rule-engine.models.ts
export interface RuleParams {
  window_minutes: number;
  dump_window_minutes: number;
  pump_pct: number;
  dump_pct: number;
  vol_window: number;
  vol_mult: number;
  min_bars: number;
  resample_rule: string;
}

export interface RuleWeights {
  pump_strength: number;
  dump_strength: number;
  volume_strength: number;
}

export interface ManualRequest {
  start: string; // ISO string
  end: string; // ISO string
  params: RuleParams;
  weights: RuleWeights;
}

export interface Incident {
  ticker: string;
  start_ts: string;
  peak_ts: string;
  end_ts: string;
  pump_return?: number | null;
  dump_return?: number | null;
  volume_multiplier?: number | null;
  confidence?: number | null;
}

export interface ManualResponse {
  message: string;
  rule_name: string;
  count: number;
  incidents: Incident[];
}
