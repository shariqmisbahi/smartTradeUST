import {
  Component,
  inject,
  signal,
  ViewChild,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApiPnDResponse, PumpDumpRow } from '../models/pumpdump.models';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  RowClassRules,
  Theme,
  themeQuartz,
  ModuleRegistry,
  AllCommunityModule,
  ValueFormatterParams,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ExplainDialogComponent } from '../explain-dialog/explain-dialog.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize, timer, switchMap } from 'rxjs';
import { MatTabsModule } from '@angular/material/tabs';
import { ParamWizardDialogv2Component } from '../pump-and-dumpV2/param-wizard-dialogv2/param-wizard-dialog-v2.component';
import { ExplainDialogMlComponent } from '../explain-dialog-ml/explain-dialog-ml.component'; // keep this path consistent
import { VerificationDialogComponent } from './verification-dialog/verification-dialog.component';
import { apiUrl } from '../../environments/environment';

export interface Explanation {
  criterion: string;
  value: number | string | boolean | null;
  threshold: number | string | boolean | null;
  result: boolean;
  weight: number | null;
  score: number | null;
  meaning: string;
}

export interface AlertRow {
  alert_id: string;
  security_name: string;
  security_type: string;
  brokerage: string;
  pump_ts: string;
  dump_ts: string;
  pump_price: number;
  dump_price: number;
  pump_volume: number;
  dump_volume: number;
  symbol_median_volume: number;
  window_minutes_actual: number;
  rubric_score: number;
  decision: string;
  explanations: Explanation[];
}

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-pump-and-dump-v2',
  standalone: true,
  templateUrl: './pump-and-dumpV2.component.html',
  styleUrls: ['./pump-and-dumpV2.component.css'],
  imports: [
    CommonModule,
    FormsModule,
    AgGridAngular,
    MatDialogModule,
    MatButtonModule,
    MatIconModule, // keep single import
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    CommonModule,
  ],
})
export class PumpandDumpV2Component implements OnInit, OnDestroy {
  // UI state
  verifying = false;
  // Put a small GIF under assets (example path). Replace with your file:
  intelVerifyingGif = 'assets/ml_ai.gif';
  private dialog = inject(MatDialog);
  verifyPhase: 'prep' | 'analyzing' | null = null; // controls overlay caption

  processingGif = 'assets/ml_ai.gif';

  // ===== Grid #1 (main stream) =====
  buildMainCols(): ColDef<AlertRow>[] {
    return [
      { headerName: 'Alert ID', field: 'alert_id', width: 140 },
      { headerName: 'Security', field: 'security_name', minWidth: 200 },
      { headerName: 'Type', field: 'security_type', width: 110 },
      { headerName: 'Brokerage', field: 'brokerage', minWidth: 180 },
      { headerName: 'Pump TS', field: 'pump_ts', width: 160 },
      { headerName: 'Dump TS', field: 'dump_ts', width: 160 },
      {
        headerName: 'Pump Px',
        field: 'pump_price',
        type: 'rightAligned',
        width: 110,
        valueFormatter: (p) => this.f2(p.value),
      },
      {
        headerName: 'Dump Px',
        field: 'dump_price',
        type: 'rightAligned',
        width: 110,
        valueFormatter: (p) => this.f2(p.value),
      },
      {
        headerName: 'Pump Vol',
        field: 'pump_volume',
        type: 'rightAligned',
        width: 110,
        valueFormatter: (p) => this.n0(p.value),
      },
      {
        headerName: 'Dump Vol',
        field: 'dump_volume',
        type: 'rightAligned',
        width: 110,
        valueFormatter: (p) => this.n0(p.value),
      },
      {
        headerName: 'Median Vol',
        field: 'symbol_median_volume',
        type: 'rightAligned',
        width: 120,
        valueFormatter: (p) => this.n0(p.value),
      },
      {
        headerName: 'Window (m)',
        field: 'window_minutes_actual',
        type: 'rightAligned',
        width: 110,
      },
      {
        headerName: 'Rubric',
        field: 'rubric_score',
        type: 'rightAligned',
        width: 100,
        valueFormatter: (p) => this.f3(p.value),
      },
      {
        headerName: 'Decision',
        field: 'decision',
        width: 140,
        cellClass: (p) =>
          p.value === 'True Positive' ? 'chip chip-good' : 'chip chip-bad',
      },
    ];
  }

  // format helpers
  private f2(v: unknown) {
    return v == null ? '' : Number(v).toFixed(2);
  }
  private f3(v: unknown) {
    return v == null ? '' : Number(v).toFixed(3);
  }
  private n0(v: unknown) {
    return v == null ? '' : Number(v).toLocaleString();
  }

  private http = inject(HttpClient);
  private dialog2 = inject(MatDialog);

  gridThemeClass = 'ag-theme-alpine compact-grid trades-grid';
  totalCount: number | null = null;
  quickFilter = '';
  pageSize = 10;
  pageSizeOptions = [10, 20, 50, 100];

  @ViewChild(AgGridAngular) grid?: AgGridAngular<PumpDumpRow>;
  @ViewChild('calibGrid', { static: false }) calibGrid?: AgGridAngular;

  // form controls
  outDir = '';
  limit = 200;

  // data state (signals)
  loading = signal(false);
  error = signal<string | null>(null);
  meta = signal<Omit<ApiPnDResponse, 'results'> | null>(null);
  rows = signal<PumpDumpRow[]>([]);

  private gridApi!: GridApi;
  private calibApi?: GridApi;

  rowDataGrid1: PumpDumpRow[] = [];
  // Default values you already expose in the UI

  defaultColDefGrid1: ColDef = {
    sortable: true,
    //filter: true,
    suppressSizeToFit: true,
    width: 150,
    tooltipValueGetter: (p) => (p.value != null ? String(p.value) : ''),
  };

  // grid defs — ALL FIELDS UPDATED TO SNAKE_CASE
  colDefsGrid1: ColDef<PumpDumpRow>[] = [
    {
      headerName: 'Time',
      valueGetter: (p) => (p.data ? `${p.data.date} ${p.data.time}` : ''),
      width: 190,
    },
    { headerName: 'Alert ID', field: 'alert_id', width: 130 },
    { headerName: 'Order ID', field: 'order_id', width: 150 },
    { headerName: 'Trade ID', field: 'trade_id', width: 150 },
    { headerName: 'Security', field: 'security_name', width: 220 },
    { headerName: 'Type', field: 'security_type', width: 100 },
    { headerName: 'Side', field: 'market_side', width: 90 },
    { headerName: 'Brokerage', field: 'brokerage', width: 200 },
    { headerName: 'Broker', field: 'broker', width: 120 },
    {
      headerName: 'Price',
      field: 'price',
      width: 110,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(2) : '',
    },
    {
      headerName: 'Volume',
      field: 'total_volume',
      width: 120,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toLocaleString() : '',
    },
    {
      headerName: 'Value',
      field: 'value',
      width: 140,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toLocaleString() : '',
    },
    { headerName: 'Trader', field: 'trader', width: 110 },
    { headerName: 'Order Type', field: 'order_type', width: 120 },
    { headerName: 'Exec Instr', field: 'executions_instructions', width: 140 },
    { headerName: 'Account', field: 'account', width: 150 },
    { headerName: 'Account Type', field: 'account_type', width: 130 },
    { headerName: 'Comments', field: 'comments', width: 200 },
    // { headerName: 'Cancel Reason', field: 'cancel_reason', width: 180 },
  ];

  rowClassRules: RowClassRules = {
    'row-buy': (p) => p.data?.market_side === 'BUY',
    'row-sell': (p) => p.data?.market_side === 'SELL',
  };

  // stable row ids
  getRowId1 = (p: { data: PumpDumpRow }) =>
    p?.data?.trade_id ??
    p?.data?.order_id ??
    p?.data?.alert_id ??
    `${p?.data?.date}T${p?.data?.time}`;

  ngOnInit(): void {
    this.fetch();
    this.loading.set(false);
  }

  fetch(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<ApiPnDResponse>(this.latestUrl()).subscribe({
      next: (resp) => {
        this.totalCount = resp.pump_and_dump_count ?? resp.count ?? null;
        this.rowDataGrid1 = resp?.results ?? [];
        console.log(
          'rows received:',
          this.rowDataGrid1.length,
          'sample:',
          this.rowDataGrid1[0]
        );
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch trades:', err);
        this.error.set('Failed to fetch trades');
        this.loading.set(false);
      },
    });
  }

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
  }

  onQuickFilterChange(): void {
    this.grid?.api.setGridOption('quickFilterText', this.quickFilter || '');
  }
  // Build the latest endpoint dynamically
  private latestUrl() {
    // If your backend no longer needs out_dir, just drop that key.
    return this.url('simulate/alerts/latest/pumpdump', {
      limit: this.limit,
    });
  }
  exportCsv(): void {
    this.grid?.api.exportDataAsCsv({
      fileName: 'pumpdump_latest.csv',
      columnSeparator: ',',
      processCellCallback: (p) =>
        typeof p.value === 'number' ? String(p.value) : p.value ?? '',
    });
  }

  theme: Theme = themeQuartz.withParams({});

  OpenWizard() {
    const ref = this.dialog.open(ParamWizardDialogv2Component, {
      height: '90vh',
      maxHeight: '93vh',
      width: '1100px',
      maxWidth: '95vw',
      panelClass: 'param-wizard-panel',
      autoFocus: 'dialog',
      data: {
        start: '2025-01-01',
        end: '2025-12-31',
        params: {
          window_minutes: 30,
          dump_window_minutes: 60,
          pump_pct: 22.0,
          dump_pct: 16.0,
          vol_window: 30,
          vol_mult: 3.0,
          min_bars: 15,
          resample_rule: '1min',
        },
        weights: {
          pump_strength: 0.45,
          dump_strength: 0.45,
          volume_strength: 0.1,
        },
      },
    });

    ref.afterClosed().subscribe((res) => {
      if (!res?.response) return;
      console.log('Wizard closed with:', res);
      this.loadCalibrationRowsFromResponse(res);
    });
  }

  //========================= GRID2 (Wizard/Calibration)
  private isTP(r: any): boolean {
    const s = (x: any) => (typeof x === 'string' ? x.toLowerCase() : '');
    return s(r?.decision) === 'true positive';
  }

  rowDataGrid2: AlertRow[] = [];

  defaultColDefGrid2: ColDef = {
    sortable: true,
    filter: true,
    suppressSizeToFit: true,
    width: 150,
    tooltipValueGetter: (p) => (p.value != null ? String(p.value) : ''),
  };

  colDefsGrid2: ColDef<AlertRow>[] = [
    { headerName: 'Alert ID', field: 'alert_id', width: 140 },
    { headerName: 'Security', field: 'security_name', minWidth: 200 },
    { headerName: 'Type', field: 'security_type', width: 110 },
    { headerName: 'Brokerage', field: 'brokerage', minWidth: 180 },
    { headerName: 'Pump TS', field: 'pump_ts', width: 160 },
    { headerName: 'Dump TS', field: 'dump_ts', width: 160 },
    {
      headerName: 'Rubric',
      field: 'rubric_score',
      type: 'rightAligned',
      width: 100,
      valueFormatter: (p) => this.f3(p.value),
    },
    {
      headerName: 'Decision',
      field: 'decision',
      width: 140,
      cellClass: (p) =>
        (p?.value || '').toString().toLowerCase() === 'true positive'
          ? 'chip chip-good'
          : 'chip chip-bad',
    },
  ];

  private prettyHeader(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  private tooltipFromExplanation(e: Explanation): string {
    const parts = [
      e.value !== undefined && e.value !== null ? `value: ${e.value}` : '',
      e.threshold !== undefined && e.threshold !== null
        ? `threshold: ${e.threshold}`
        : '',
      `result: ${e.result}`,
      e.weight !== undefined && e.weight !== null ? `weight: ${e.weight}` : '',
      e.score !== undefined && e.score !== null ? `score: ${e.score}` : '',
    ].filter(Boolean);
    return parts.join(' | ');
  }

  detailCellRendererParams = {
    detailGridOptions: {
      defaultColDef: {
        sortable: false,
        filter: false,
      },
      onFirstDataRendered: (ev: any) => {
        const row = ev.api.getDisplayedRowAtIndex(0)?.data;
        const criteria: string[] = row?.__criteria || [];
        const defs = criteria.map((crit: string) => ({
          headerName: this.prettyHeader(crit),
          field: crit,
          minWidth: 160,
          cellClass: (p: any) => {
            const meta = p?.data?.__expDetails?.[crit];
            return meta && meta.result === false ? 'cell-bad' : '';
          },
          tooltipValueGetter: (p: any) => {
            const meta: Explanation | undefined = p?.data?.__expDetails?.[crit];
            return meta ? this.tooltipFromExplanation(meta) : '';
          },
        }));
        ev.api.setGridOption('columnDefs', defs);
        ev.api.sizeColumnsToFit?.();
      },
      pagination: false,
      domLayout: 'autoHeight',
    },
    getDetailRowData: (params: any) => {
      const exps: Explanation[] = params?.data?.explanations ?? [];
      const expMap: Record<string, Explanation> = {};
      const row: any = { __criteria: [], __expDetails: {} };

      exps.forEach((e) => {
        const key = e.criterion;
        expMap[key] = e;
        row[key] = e.meaning ?? '';
        row.__criteria.push(key);
      });
      row.__expDetails = expMap;

      params.successCallback([row]);
    },
  };

  // ===== ML Tab =====
  rowDataML: any[] = [];
  colDefsML: ColDef[] = [];
  defaultColDefML: ColDef = { sortable: true, filter: true, resizable: true };

  loaderUrl = 'assets/loader.gif';
  private readonly CALIBRATE_URL = this.url('pumpdumpml/detect');

  calibRows: any[] = []; // parent rows from wizard
  showTPOnly = true;

  // parent cols (includes explain link)
  calibDefaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
  };

  calibColDefs: ColDef[] = [
    {
      headerName: 'Explanation',
      field: '__explain',
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
          this.openExplain(p?.data);
        };
        return a;
      },
    },
    { headerName: 'Alert ID', field: 'alert_id', width: 140 },
    { headerName: 'Security', field: 'security_name', minWidth: 200 },
    { headerName: 'Type', field: 'security_type', width: 110 },
    { headerName: 'Brokerage', field: 'brokerage', minWidth: 180 },
    { headerName: 'Pump Trade', field: 'pump_trade_id', width: 140 },
    { headerName: 'Dump Trade', field: 'dump_trade_id', width: 140 },
    { headerName: 'Pump Order', field: 'pump_order_id', width: 140 },
    { headerName: 'Dump Order', field: 'dump_order_id', width: 140 },
    { headerName: 'Pump TS', field: 'pump_ts', width: 160 },
    { headerName: 'Dump TS', field: 'dump_ts', width: 160 },
    {
      headerName: 'Pump Px',
      field: 'pump_price',
      width: 110,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(4) : '',
    },
    {
      headerName: 'Dump Px',
      field: 'dump_price',
      width: 110,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(2) : '',
    },
    {
      headerName: 'Pump Vol',
      field: 'pump_volume',
      width: 120,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toLocaleString() : '',
    },
    {
      headerName: 'Dump Vol',
      field: 'dump_volume',
      width: 120,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toLocaleString() : '',
    },
    {
      headerName: 'Median Vol',
      field: 'symbol_median_volume',
      width: 130,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toLocaleString() : '',
    },
    {
      headerName: 'Window (m)',
      field: 'window_minutes_actual',
      width: 125,
    },
    {
      headerName: 'Pump↑ vs Dump%',
      field: 'pump_vs_dump_increase_pct',
      width: 150,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(6) : '',
    },
    {
      headerName: 'Drop %',
      field: 'drop_pct',
      width: 120,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(6) : '',
    },
    {
      headerName: 'Vol Uplift ×',
      field: 'vol_uplift_mult',
      width: 130,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(6) : '',
    },
    {
      headerName: 'Pump Score',
      field: 'pump_strength_score',
      width: 130,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Dump Score',
      field: 'dump_strength_score',
      width: 130,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Vol Score',
      field: 'volume_strength_score',
      width: 130,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Rubric',
      field: 'rubric_score',
      width: 110,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(6) : '',
    },
    { headerName: 'Pump OK', field: 'pump_ok', width: 110 },
    { headerName: 'Dump OK', field: 'dump_ok', width: 120 },
    { headerName: 'Volume OK', field: 'volume_ok', width: 130 },
    { headerName: 'Within Window', field: 'within_window', width: 150 },
    { headerName: 'Min Bars OK', field: 'min_bars_ok', width: 130 },
    { headerName: 'Phase Order OK', field: 'phase_order_ok', width: 150 },
    {
      headerName: 'Decision',
      field: 'decision',
      width: 140,
      cellClass: (p) => {
        const v = (p?.value || '').toString().toLowerCase();
        return v === 'true positive'
          ? 'chip chip-good'
          : v === 'true negative'
          ? 'chip chip-bad'
          : '';
      },
    },
  ];

  // lifecycle for calibration grid
  onCalibGridReady(e: GridReadyEvent) {
    this.calibApi = e.api;
  }

  loadCalibrationRowsFromResponse(res: any) {
    const arr: any[] = Array.isArray(res?.response)
      ? res.response
      : res?.response?.results ?? [];
    const cleaned = (arr ?? []).map((r) => ({
      ...r,
      __open: false,
      explanations: Array.isArray(r?.explanations) ? r.explanations : [],
    }));

    this.calibRows = this.showTPOnly
      ? cleaned.filter((r) => this.isTP(r))
      : cleaned;
  }

  // full-width row utilities (Community)
  calibIsFullWidthRow = (p: any) => !!p?.rowNode?.data?.__isDetailRow;
  calibGetRowHeight = (p: any) => (p?.data?.__isDetailRow ? 140 : 42);

  toggleDetail = (p: any) => {
    const parent = p.data;
    const rowIdx = p.node.rowIndex;
    if (!this.calibApi) return;

    if (!parent.__open) {
      const detail = this.buildDetailRow(parent);
      this.calibApi.applyTransaction({ add: [detail], addIndex: rowIdx + 1 });
      parent.__open = true;
      this.calibApi.applyTransaction({ update: [parent] });
    } else {
      const n = this.calibApi.getDisplayedRowAtIndex(rowIdx + 1);
      const data = n?.data;
      if (data?.__isDetailRow && data.__parentId === parent.alert_id) {
        this.calibApi.applyTransaction({ remove: [data] });
      }
      parent.__open = false;
      this.calibApi.applyTransaction({ update: [parent] });
    }
  };

  buildDetailRow(parent: any) {
    return {
      __isDetailRow: true,
      __parentId: parent.alert_id,
      __explanations: parent.explanations,
    };
  }

  calibFullWidthRenderer = (params: any) => {
    const wrap = document.createElement('div');
    wrap.className = 'calib-detail-wrap';

    const exps: Explanation[] = params?.data?.__explanations ?? [];
    if (!exps.length) {
      wrap.textContent = 'No explanations';
      return wrap;
    }

    const cols = exps.map((e) => (e.criterion ?? '').toString().toUpperCase());

    const tooltip = (e: Explanation) => {
      const parts = [
        e.value !== undefined && e.value !== null ? `value: ${e.value}` : '',
        e.threshold !== undefined && e.threshold !== null
          ? `threshold: ${e.threshold}`
          : '',
        `result: ${e.result}`,
        e.weight !== undefined && e.weight !== null
          ? `weight: ${e.weight}`
          : '',
        e.score !== undefined && e.score !== null ? `score: ${e.score}` : '',
      ].filter(Boolean);
      return parts.join(' | ');
    };

    const tbl = document.createElement('table');
    tbl.className = 'calib-detail-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    cols.forEach((key) => {
      const th = document.createElement('th');
      th.textContent = key;
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    exps.forEach((e) => {
      const td = document.createElement('td');
      td.textContent = e?.meaning != null ? String(e.meaning) : '';
      td.title = tooltip(e);
      if (e?.result === false) td.classList.add('calib-cell-bad');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);

    tbl.appendChild(thead);
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    return wrap;
  };

  openExplain(row: any) {
    this.dialog.open(ExplainDialogComponent, {
      width: '1220px',
      maxWidth: '98vw',
      autoFocus: 'dialog',
      panelClass: 'param-wizard-panel',
      data: {
        parent: {
          alert_id: row?.alert_id,
          security_name: row?.security_name,
          security_type: row?.security_type,
          brokerage: row?.brokerage,
          pump_ts: row?.pump_ts,
          dump_ts: row?.dump_ts,
          rubric_score: row?.rubric_score,
          decision: row?.decision,
        },
        explanations: Array.isArray(row?.explanations) ? row.explanations : [],
      },
    });
  }

  /** ===== ML PIPELINE ===== */

  runCalibration(): void {
    // show overlay immediately
    this.loading.set(true);

    // wait 5s, then call API
    timer(1000)
      .pipe(
        switchMap(() => this.http.post<any>(this.CALIBRATE_URL, {})),
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

  // numeric/time helpers for ML grid
  private isNum = (v: any) => v !== null && v !== undefined && !isNaN(+v);

  private timeFmt = (p: ValueFormatterParams) => {
    const v = p.value;
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  };

  private intFmt = (p: ValueFormatterParams) =>
    this.isNum(p.value) ? Math.round(+p.value).toLocaleString() : '';

  private dec2Fmt = (p: ValueFormatterParams) =>
    this.isNum(p.value) ? (+p.value).toFixed(2) : '';

  private dec3Fmt = (p: ValueFormatterParams) =>
    this.isNum(p.value) ? (+p.value).toFixed(3) : '';

  private pct2Fmt = (p: ValueFormatterParams) => {
    if (!this.isNum(p.value)) return '';
    const v = +p.value;
    const pct = Math.abs(v) <= 1 ? v * 100 : v;
    return `${pct.toFixed(2)}%`;
  };

  // style decision chip
  private decisionClass = (p: any) => {
    const s = (p?.value ?? '').toString().toLowerCase();
    if (s.includes('true positive')) return 'chip good';
    if (s.includes('true negative')) return 'chip bad';
    return 'chip';
  };

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
        headerName: 'Final AI Score',
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

  rowClassRulesMLGrid = {
    'risk-high': (p: { data?: any }) =>
      (p?.data?.risk_band || '').toLowerCase() === 'high',
    'risk-medium': (p: { data?: any }) =>
      (p?.data?.risk_band || '').toLowerCase() === 'medium',
    'risk-low': (p: { data?: any }) =>
      (p?.data?.risk_band || '').toLowerCase() === 'low',
  };

  getRowStyle = (p: any) => {
    const v = (p?.data?.risk_band || '').toLowerCase();
    if (v === 'high') return { color: '#b71c1c' };
    if (v === 'medium') return { color: '#e65100' };
    if (v === 'low') return { color: '#459c53ff' };
    return undefined;
  };

  // getRowStyle = (p: any) => {
  //   const v = (p?.data?.risk_band || '').toLowerCase();
  //   if (v === 'high')
  //     return { backgroundColor: '#ffebee', color: '#b71c1c', fontWeight: 600 };
  //   if (v === 'medium')
  //     return { backgroundColor: '#fff3e0', color: '#e65100', fontWeight: 600 };
  //   if (v === 'low')
  //     return { backgroundColor: '#fffde7', color: '#827717', fontWeight: 600 };
  //   return undefined;
  // };

  // ===== ML Grid wiring =====
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

  // cleanup
  ngOnDestroy() {
    if (this.mlResizeHandler) {
      window.removeEventListener('resize', this.mlResizeHandler);
    }
  }
  onGifError(_: Event) {
    console.error('GIF failed to load. Check file path or assets config.');
  }

  //3rd Button code
  // UI state
  // verifying = false;
  // // Put a small GIF under assets (example path). Replace with your file:
  // intelVerifyingGif = 'assets/gifs/processing-intel.gif';

  // Optional: identify the set of rows/alertId you want to verify.
  // Adjust payload/query according to your backend needs.

  rowDataML1: any[] = [];
  colDefsML1: any[] = [];
  defaultColDefML1: any = {};
  getRowStyle1: any = null;
  onMLGridReady1 = (_e: any) => {};

  // private verificationEndpoint =
  private verificationEndpoint = this.url('reports/ml/high-risk.pdf', {
    limit: 50,
  });

  verifyWithIntel() {
    this.verifying = true;
    const ref = this.dialog.open(VerificationDialogComponent, {
      width: '775px',
      disableClose: true,
      data: {
        apiUrl: this.url('reports/ml/high-risk.pdf', { limit: 20 }),
      },
    });
    ref.afterClosed().subscribe(() => (this.verifying = false));
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

  // Build a fully-qualified API URL with optional query params
  private url(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ) {
    const base = apiUrl(path); // joins with environment.API_BASE
    if (!params) return base;
    const u = new URL(base);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    return u.toString();
  }
}
