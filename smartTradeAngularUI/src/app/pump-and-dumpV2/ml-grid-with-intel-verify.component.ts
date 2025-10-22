import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-ml-grid-with-intel-verify',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="align-center grid-container" *ngIf="rowDataML?.length">
      <ag-grid-angular
        [theme]="'legacy'"
        class="ag-theme-alpine"
        style="width: 100%; height: 56vh; overflow: auto"
        [rowData]="rowDataML"
        [columnDefs]="colDefsML"
        [defaultColDef]="defaultColDefML"
        [pagination]="true"
        [paginationPageSize]="20"
        [animateRows]="true"
        [getRowStyle]="getRowStyle"
        (gridReady)="onMLGridReady($event)"
      >
      </ag-grid-angular>

      <!-- RIGHT-ALIGNED BUTTON + GIF -->
      <div class="actions-bar" *ngIf="rowDataML?.length">
        <button
          mat-raised-button
          color="primary"
          class="intel-btn"
          (click)="verifyWithIntel()"
          [disabled]="verifying"
          aria-label="Verification using Email Data"
        >
          <mat-icon style="margin-right:6px">verified</mat-icon>
          Verification using Internal Data sources
        </button>
        <img
          *ngIf="verifying"
          [src]="intelVerifyingGif"
          class="processing-gif"
          width="42"
          height="42"
          alt="Processing..."
          decoding="async"
        />
      </div>
    </div>
  `,
  styles: [
    `
      .actions-bar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
      }
      .intel-btn {
        border-radius: 9999px;
        padding: 8px 14px;
        font-weight: 600;
      }
      .processing-gif {
        object-fit: contain;
        image-rendering: auto;
      }
    `,
  ],
})
export class MlGridWithIntelVerifyComponent {
  private http = inject(HttpClient);

  // Provide your existing bindings as in your current component:
  rowDataML: any[] = [];
  colDefsML: any[] = [];
  defaultColDefML: any = {};
  getRowStyle: any = null;
  onMLGridReady = (_e: any) => {};

  // UI state
  verifying = false;
  // Put a small GIF under assets (example path). Replace with your file:
  intelVerifyingGif = 'assets/gifs/processing-intel.gif';

  // Optional: identify the set of rows/alertId you want to verify.
  // Adjust payload/query according to your backend needs.
  private verificationEndpoint = '/api/intel/verify'; // <-- change to your real endpoint

  verifyWithIntel(): void {
    this.verifying = true;

    // Example payload: send IDs of selected rows or any context you need
    const selectedIds = this.rowDataML.slice(0, 20).map((r) => r.alert_id); // tweak selection logic

    this.http
      .get(this.verificationEndpoint, {
        // If your API needs POST instead, switch to this.http.post(...)
        // body: { alert_ids: selectedIds },
        // For GET, you might use params: { ids: selectedIds.join(',') }
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(finalize(() => (this.verifying = false)))
      .subscribe({
        next: (res: HttpResponse<Blob>) => {
          // Verify content type is a PDF
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.toLowerCase().includes('application/pdf')) {
            this._downloadAs(res.body!, 'intel_verification.bin'); // fallback
            return;
          }

          // Try to extract filename from Content-Disposition
          const cd = res.headers.get('content-disposition') || '';
          const fnameMatch =
            /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd);
          const fileName = decodeURIComponent(
            fnameMatch?.[1] || fnameMatch?.[2] || 'intel_verification.pdf'
          );

          // Open in new tab and trigger a download
          const blob = new Blob([res.body!], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);

          // Open in new tab
          window.open(url, '_blank', 'noopener,noreferrer');

          // Also trigger a download (optional — remove if you only want to open)
          this._downloadUrl(url, fileName);

          // Revoke after a short delay to ensure tab opened
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        },
        error: (err) => {
          console.error('Intel verification failed:', err);
          alert('Verification failed. Please try again.');
        },
      });
  }

  private _downloadAs(data: Blob, fileName: string) {
    const url = URL.createObjectURL(data);
    this._downloadUrl(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private _downloadUrl(url: string, fileName: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
