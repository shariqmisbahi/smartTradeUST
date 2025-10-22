import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class IntelVerifyService {
  private http = inject(HttpClient);
  private endpoint = '/api/intel/verify'; // <-- adjust

  getVerificationPdf(
    params?: Record<string, string>
  ): Observable<HttpResponse<Blob>> {
    return this.http.get(this.endpoint, {
      params, // e.g., { ids: 'A,B,C' }
      responseType: 'blob',
      observe: 'response',
    });
  }
}
