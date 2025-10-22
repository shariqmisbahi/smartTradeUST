// src/app/services/insider-trading.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  InsiderTradingApiResponse,
  InsiderTradingRow,
} from '../models/insiderTrading.models';

@Injectable({ providedIn: 'root' })
export class InsiderTradingService {
  private baseUrl =
    'http://localhost:5294/simulate/alerts/latest/insidertrading';

  //constructor(private http: HttpClient) {}
  private http = inject(HttpClient);

  getLatest(outDir: string, limit = 200): Observable<InsiderTradingRow[]> {
    const params = new HttpParams()
      .set('out_dir', outDir)
      .set('limit', limit.toString());

    return this.http
      .get<InsiderTradingApiResponse>(this.baseUrl, { params })
      .pipe(map((resp) => resp.results ?? []));
  }
}
