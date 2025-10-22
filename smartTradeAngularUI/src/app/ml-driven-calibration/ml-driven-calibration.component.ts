import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  ModuleRegistry,
  AllCommunityModule,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize, timer, switchMap } from 'rxjs';
import { MatTabsModule } from '@angular/material/tabs';
import { ApiPnDResponse, PumpDumpRow } from '../models/pumpdump.models';
import { ExplainDialogMlComponent } from '../explain-dialog-ml/explain-dialog-ml.component';
import { apiUrl } from '../../environments/environment';

// keep this path consistent

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-ml-driven-calibration',
  standalone: true,
  templateUrl: './ml-driven-calibration.component.html',
  styleUrls: ['./ml-driven-calibration.component.css'],
  imports: [
    CommonModule,
    FormsModule,
    AgGridAngular,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    CommonModule,
  ],
})
export class MLDrivenCalibrationComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private dialog2 = inject(MatDialog);
  gridThemeClass = 'ag-theme-alpine compact-grid trades-grid';
  totalCount: number | null = null;
  quickFilter = '';
  pageSize = 10;
  pageSizeOptions = [10, 20, 50, 100];
  @Input() showAction = false;
  private dialog = inject(MatDialog);

  // data state (signals)
  loading = signal(false);
  error = signal<string | null>(null);
  meta = signal<Omit<ApiPnDResponse, 'results'> | null>(null);
  rows = signal<PumpDumpRow[]>([]);
  private readonly CALIBRATE_URL_FOR_ML = apiUrl('pumpdumpml/detect');
  // ===== ML Tab =====
  rowDataML: any[] = [];
  colDefsML: ColDef[] = [];
  defaultColDefML: ColDef = { sortable: true, resizable: true };

  processingGif = 'assets/ml_ai.gif';

  ngOnInit(): void {
    this.loading.set(false);
  }

  /** ===== ML PIPELINE ===== */
  runCalibration(): void {
    // show overlay immediately
    this.loading.set(true);

    // wait 5s, then call API
    timer(1000)
      .pipe(
        switchMap(() => this.http.post<any>(this.CALIBRATE_URL_FOR_ML, {})),
        finalize(() => this.loading.set(false))
      )
      .subscribe({
        next: (resp) => {
          const results = Array.isArray(resp?.results) ? resp.results : [];
          this.rowDataML = results;
          this.buildExplicitColsForML();
          this.mlApi?.setGridOption('rowData', this.rowDataML);
          setTimeout(() => this.autoSizeMlColumns(), 0);
        },
        error: (err) => {
          console.error('Calibration API error', err);
          this.rowDataML = [];
          this.loading.set(false);
        },
      });
  }

  // explicit ML columns (incl. Explanations opener)
  private buildExplicitColsForML() {
    this.colDefsML = [
      {
        headerName: 'Explanation',
        colId: 'ml_explanations',
        width: 110,
        pinned: 'left',
        sortable: false,
        filter: false,
        cellRenderer: (p: any) => {
          if (p?.data?.__isDetailRow) return '';
          const a = document.createElement('a');
          a.href = 'javascript:void(0)';
          a.textContent = 'Details';
          a.className = 'link-explain';
          a.onclick = (ev) => {
            ev.preventDefault();
            this.openExplainML(p?.data);
          };
          return a;
        },
      },
      // {
      //   headerName: 'Explanations',
      //   colId: 'ml_explanations',
      //   width: 160,
      //   sortable: false,
      //   filter: false,
      //   suppressMenu: true,
      //   valueGetter: (p: any) => this.getMlExplanations(p?.data)?.length ?? 0,
      //   cellRenderer: (p: any) => {
      //     const n = p?.value ?? 0;
      //     const disabled =
      //       n === 0 ? 'disabled style="opacity:.5;cursor:not-allowed;"' : '';
      //     return `<button class="explain-btn" ${disabled}>View (${n})</button>`;
      //   },
      //   onCellClicked: (p: any) => {
      //     const n = this.getMlExplanations(p?.data).length;
      //     if (n > 0) this.openExplainML(p?.data);
      //   },
      // },

      {
        headerName: 'Alert ID',
        field: 'alert_id',

        width: 140,
        filter: true,
      },

      {
        headerName: 'Security Name',
        field: 'security_name',

        width: 140,
        filter: true,
      },
      {
        headerName: 'Security Type',
        field: 'security_type',

        width: 140,
        filter: true,
      },
      {
        headerName: 'Brokerage',
        field: 'brokerage',

        width: 140,
        filter: true,
      },

      {
        headerName: 'RF Score',
        field: 'rf_score',
        type: 'rightAligned',
        valueFormatter: (p) =>
          p.value != null ? `${(p.value * 100).toFixed(1)}%` : '',
        width: 120,
      },
      {
        headerName: 'Isolation Score',
        field: 'iso_raw_score',
        type: 'rightAligned',
        valueFormatter: (p) =>
          p.value != null ? `${(p.value * 100).toFixed(1)}%` : '',
        width: 140,
      },
      {
        headerName: 'Ensemble Score',
        field: 'ensemble_score',
        type: 'rightAligned',
        valueFormatter: (p) =>
          p.value != null ? `${(p.value * 100).toFixed(1)}%` : '',
        width: 150,
      },
      {
        headerName: 'Final ML Confidence',
        field: 'final_ai_score',
        type: 'rightAligned',
        valueFormatter: (p) =>
          p.value != null ? `${(p.value * 100).toFixed(1)}%` : '',
        minWidth: 170,
      },
      {
        headerName: 'Risk Band',
        field: 'risk_band',
        type: 'rightAligned',
        minWidth: 100,
      },
    ] as ColDef[];

    this.defaultColDefML = {
      resizable: true,
      sortable: true,
      filter: 'agTextColumnFilter',
      minWidth: 110,
    };
  }

  onGifError(_: Event) {
    console.error('GIF failed to load. Check file path or assets config.');
  }

  getRowStyle = (p: any) => {
    const v = (p?.data?.risk_band || '').toLowerCase();
    if (v === 'high') return { color: '#b71c1c' };
    if (v === 'medium') return { color: '#e65100' };
    if (v === 'low') return { color: '#459c53ff' };
    return undefined;
  };

  onMLGridReady(event: GridReadyEvent) {
    this.mlApi = event.api;
    // if data already present
    if (Array.isArray(this.rowDataML)) {
      this.mlApi.setGridOption('rowData', this.rowDataML);
    }

    // v34 uses setGridOption
    if (this.pageSize) this.mlApi.setGridOption('paginationPageSize', 20);
    if (this.quickFilter)
      this.mlApi.setGridOption('quickFilterText', this.quickFilter || '');
    this.mlApi.setGridOption('domLayout', 'normal');

    setTimeout(() => {
      this.autoSizeMlColumns();
      this.mlApi.resetRowHeights();
    }, 0);

    this.mlResizeHandler = () => this.autoSizeMlColumns();
    window.addEventListener('resize', this.mlResizeHandler, { passive: true });
  }

  private mlApi!: GridApi;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private mlResizeHandler = () => {};

  private autoSizeMlColumns() {
    if (!this.mlApi) return;

    // Use GridApi only (v34). Cast to any to access helper methods safely across minor versions.
    const api = this.mlApi as any;

    // Try to autosize by column ids if available, else fall back to fit
    const cols = api.getAllGridColumns?.() as any[] | undefined;
    if (cols?.length && api.autoSizeColumns) {
      const allIds = cols.map((c: any) => c.getColId());
      api.autoSizeColumns(allIds);
    }

    // Additionally fit to viewport for small datasets
    if (this.mlApi.getDisplayedRowCount() < 10 && api.sizeColumnsToFit) {
      api.sizeColumnsToFit();
    }
  }

  // Open ML dialog
  openExplainML(row: any): void {
    const exps = this.getMlExplanations(row);
    this.dialog.open(ExplainDialogMlComponent, {
      width: '1220px',
      maxWidth: '98vw',
      data: {
        parent: row,
        explanations: exps,
      },
    });
  }

  // Normalize explanations array from any likely field name/shape
  private getMlExplanations(row: any): any[] {
    const raw =
      row?.explanations ??
      row?.ml_explanations ??
      row?.explanations_list ??
      row?.explain ??
      [];
    return Array.isArray(raw) ? raw : [];
  }

  // cleanup
  ngOnDestroy() {
    console.log('RuleGridComponent destroyed');
  }
}
