import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../environments/environment';

export interface RefineExtras {
  tp_count: number;
  tn_count: number;
  used_threshold: number;
  p90: number;
  p95: number;
  p99: number;
  total: number;
}

export interface RefineResponse {
  message: string;
  count: number;
  true_positive_threshold: number;
  results: any[];
  extras?: RefineExtras;
}

export type ThresholdMode = 'fixed' | 'quantile';
export type ReturnMode = 'tp_only' | 'all';

@Injectable({ providedIn: 'root' })
export class InsiderTradingRefineService {
  private readonly baseURL = apiUrl('insidertrading');
  private http = inject(HttpClient);

  async refine(payload: {
    out_dir: string;
    limit: number;
    return_mode: ReturnMode;
    params: {
      start?: string | null;
      end?: string | null;
      report_short_name?: string | null;
      true_positive_threshold?: number;
      threshold_mode?: ThresholdMode;
      top_pct?: number;
      force_proxy_scoring?: boolean;
    };
    weights: {
      pattern: number;
      micro: number;
      concentration: number;
      context: number;
      crossvenue: number;
    };
  }): Promise<RefineResponse> {
    const url = `${this.baseURL}/refine`;
    return await firstValueFrom(this.http.post<RefineResponse>(url, payload));
  }
}
