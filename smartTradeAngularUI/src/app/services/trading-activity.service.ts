import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface TradeResponse {
  count: number;
  trades: any[];
}

@Injectable({ providedIn: 'root' })
export class TradingActivityService {
  private baseUrl = 'http://localhost:5294/api/features/data/trades';

  constructor(private readonly http: HttpClient) {}

  /**
   * Server-side paging. If your API uses offset/limit instead of page/limit,
   * tell me and I’ll flip the params.
   */
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
