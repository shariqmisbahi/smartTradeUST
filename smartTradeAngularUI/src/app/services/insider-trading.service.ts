import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  InsiderTradingApiResponse,
  InsiderTradingRow,
} from '../models/insiderTrading.models';
import { apiUrl } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InsiderTradingService {
  private readonly baseUrl = apiUrl('simulate/alerts/latest/insidertrading');
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
