import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  start: string; // ISO-8601, e.g. "2025-08-13T00:00:00Z"
  end: string; // ISO-8601
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

@Injectable({ providedIn: 'root' })
export class RuleEngineService {
  private http = inject(HttpClient);
  // If your frontend is proxied to the API, this can stay relative:
  private readonly base = '/api/rule-engine';

  runManual(body: ManualRequest): Observable<ManualResponse> {
    return this.http.post<ManualResponse>(
      `${this.base}/pump_and_dump_manual`,
      body
    );
  }
}
