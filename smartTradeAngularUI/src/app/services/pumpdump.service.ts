import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiPnDResponse } from '../models/pumpdump.models';
import { apiUrl } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PumpDumpService {
  constructor(private http: HttpClient) {}

  getLatestPumpDump(outDir: string, limit = 100): Observable<ApiPnDResponse> {
    const url = apiUrl('simulate/alerts/latest/pumpdump');
    const params = new HttpParams().set('limit', String(limit));

    return this.http.get<ApiPnDResponse>(url, { params });
  }
}
