// intel-verification.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, delay, map, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface VerifyApiResult {
  blob: Blob;
  filename: string;
}

@Injectable({ providedIn: 'root' }) // ✅ important
export class InternalVerificationService {
  private http = inject(HttpClient);

  login$(): Observable<void> {
    return of(null).pipe(
      delay(700),
      map(() => void 0)
    );
  }
  analyzeInternalData$(): Observable<void> {
    return of(null).pipe(
      delay(900),
      map(() => void 0)
    );
  }
  analyzeCrm$(): Observable<void> {
    return of(null).pipe(
      delay(900),
      map(() => void 0)
    );
  }
  analyzeChatPhone$(): Observable<void> {
    return of(null).pipe(
      delay(900),
      map(() => void 0)
    );
  }

  callVerificationPdf$(url: string): Observable<VerifyApiResult> {
    const headers = new HttpHeaders({ Accept: 'application/pdf' });
    return this.http.get(url, { headers, responseType: 'blob' }).pipe(
      map((blob) => ({
        blob,
        filename: `Suspicious_Transaction_Report_${this.timestamp()}.pdf`,
      })),
      catchError((err) =>
        throwError(() => new Error(err?.message || 'Verification API failed'))
      )
    );
  }

  private timestamp(): string {
    // Local time (e.g., Asia/Kuala_Lumpur on user’s browser)
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
  }
}
