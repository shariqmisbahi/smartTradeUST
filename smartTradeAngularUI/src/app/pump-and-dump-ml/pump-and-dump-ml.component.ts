// pump-and-dump-ml.ts
import { Component, Input } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ColDef } from 'ag-grid-community';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-pump-and-dump-ml',
  // Inline template so you can paste a single file.
  templateUrl: './pump-and-dump-ml.component.html',
  styleUrls: ['./pump-and-dump-ml.component.css'],
})
export class PumpAndDumpMlComponent {
  // --- Inputs so you can reuse your existing grid plumbing ---
  @Input() rowDataGrid2: any[] = [];
  @Input() colDefsGrid2: ColDef[] = [];
  @Input() defaultColDefGrid2: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
  };
  @Input() detailCellRendererParams: any;
  pageSize = 50;

  // --- ML tab state ---
  rowDataML: any[] = [];
  colDefsML: ColDef[] = [];
  defaultColDefML: ColDef = { sortable: true, filter: true, resizable: true };

  // loader
  loading = false;
  loaderUrl = 'assets/loader.gif';

  private readonly CALIBRATE_URL =
    'http://localhost:5294/simulate/alerts/calibrate';

  constructor(private http: HttpClient) {}

  // Keep this to match your existing button’s handler usage in templates
  OpenWizard() {
    // Intentionally empty – this just preserves your existing (click) binding.
  }

  /** Click handler: call calibrate API, show loader, bind results to ML grid */
  runCalibration(): void {
    this.loading = true;

    // If your endpoint expects a body, replace {} with that payload.
    this.http
      .post<any>(this.CALIBRATE_URL, {})
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (resp) => {
          // The sample schema has: message, count, ..., results: [...]
          const results = Array.isArray(resp?.results) ? resp.results : [];
          this.rowDataML = results;

          // Build smart column defs from keys
          this.colDefsML = this.buildColDefs(results);

          // Bonus: if you want to show a toast/snackbar, inject MatSnackBar and use it here.
        },
        error: (err) => {
          console.error('Calibration API error', err);
          this.rowDataML = [];
        },
      });
  }

  /** Infer AG-Grid columns; format nested 'explanations' neatly */
  private buildColDefs(rows: any[]): ColDef[] {
    if (!rows?.length) return [];

    // Gather all keys across rows to be robust
    const keys = new Set<string>();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => keys.add(k)));

    const orderHint = [
      'alert_id',
      'security_name',
      'security_type',
      'brokerage',
      'pump_trade_id',
      'dump_trade_id',
      'pump_order_id',
      'dump_order_id',
      'pump_ts',
      'dump_ts',
      'pump_price',
      'dump_price',
      'pump_volume',
      'dump_volume',
      'symbol_median_volume',
      'window_minutes_actual',
      'pump_vs_dump_increase_pct',
      'drop_pct',
      'vol_uplift_mult',
      'pump_strength_score',
      'dump_strength_score',
      'volume_strength_score',
      'rubric_score',
      'decision',
      'rf_score',
      'iso_raw_score',
      'ensemble_score',
      'final_ai_score',
    ];

    // Move known keys first, then the rest
    const sortedKeys = [
      ...orderHint.filter((k) => keys.has(k)),
      ...Array.from(keys).filter(
        (k) => !orderHint.includes(k) && k !== 'explanations'
      ),
    ];

    const defs: ColDef[] = sortedKeys.map((k) => ({
      headerName: this.pretty(k),
      field: k,
      minWidth: 120,
      filter: 'agTextColumnFilter',
      valueFormatter: this.numFmtIfNumber,
    }));

    // Add a readable Explanations column if present
    if (keys.has('explanations')) {
      defs.push({
        headerName: 'Explanations',
        field: 'explanations',
        autoHeight: true,
        cellRenderer: (p: any) => {
          const list = Array.isArray(p.value) ? p.value : [];
          if (!list.length) return '';
          // Show top 3 concise reasons
          const top = list
            .slice(0, 3)
            .map((e: any) => {
              const name = e?.signal ?? e?.criterion ?? 'reason';
              const val =
                e?.value !== undefined && e?.value !== null
                  ? `=${e.value}`
                  : '';
              const why = e?.why ?? e?.meaning ?? '';
              return `<div style="margin-bottom:4px;"><b>${this.escape(
                name
              )}</b>${this.escape(val)} — ${this.escape(why)}</div>`;
            })
            .join('');
          return `<div style="line-height:1.2">${top}</div>`;
        },
      } as ColDef);
    }

    return defs;
  }

  private numFmtIfNumber(params: any) {
    const v = params?.value;
    return typeof v === 'number'
      ? Number.isInteger(v)
        ? v.toString()
        : v.toFixed(4)
      : v;
  }

  private pretty(s: string): string {
    return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  private escape(s: any): string {
    const str = String(s ?? '');
    return str.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[ch] as string)
    );
  }
}
