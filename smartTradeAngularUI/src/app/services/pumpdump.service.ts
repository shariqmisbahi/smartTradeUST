// src/app/services/pumpdump.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiPnDResponse } from '../models/pumpdump.models';

const API_BASE = 'http://localhost:5294';

@Injectable({ providedIn: 'root' })
export class PumpDumpService {
  constructor(private http: HttpClient) {}

  getLatestPumpDump(outDir: string, limit = 100): Observable<ApiPnDResponse> {
    const out = encodeURIComponent(outDir);
    const url = `${API_BASE}/simulate/alerts/latest/pumpdump?out_dir=${out}&limit=${limit}`;
    return this.http.get<ApiPnDResponse>(url);
  }
}
