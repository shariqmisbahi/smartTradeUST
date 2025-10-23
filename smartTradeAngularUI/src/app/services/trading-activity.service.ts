import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { apiUrl } from '../../app/config/api.config';

export interface TradeResponse {
  count: number;
  trades: any[];
}

@Injectable({ providedIn: 'root' })
export class TradingActivityService {
  // Do NOT include '/api' here because API_BASE already includes it in prod.
  private readonly baseUrl = apiUrl('features/data/trades');

  constructor(private readonly http: HttpClient) {}

  getTrades(
    page: number,
    limit: number,
    q?: string,
    faultOnly?: boolean
  ): Observable<TradeResponse> {
    let params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));
    if (q) params = params.set('q', q);
    if (faultOnly) params = params.set('is_fault', 'true');

    return this.http.get<any>(this.baseUrl, { params }).pipe(
      map((resp: any) => {
        if (Array.isArray(resp)) return { count: resp.length, trades: resp };
        if (resp && 'trades' in resp && 'count' in resp)
          return resp as TradeResponse;
        if (resp && 'items' in resp && 'total' in resp)
          return { trades: resp.items, count: resp.total } as TradeResponse;
        return { count: resp?.trades?.length ?? 0, trades: resp?.trades ?? [] };
      })
    );
  }
}
