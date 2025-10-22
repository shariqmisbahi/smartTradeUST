import { Component, EventEmitter, Output, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
  ValueGetterParams,
  CellClassParams,
  ValueFormatterParams,
  IsFullWidthRowParams,
  RowHeightParams,
} from 'ag-grid-community';

import { CommonModule } from '@angular/common'; // ⬅️ add this
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { RuleConfigDialogComponent } from './rule-config-dialog/rule-config-dialog.component';
import { ManualResponse } from './../services/rule-engine.service';
import { ParamWizardDialogComponent } from './param-wizard-dialog/param-wizard-dialog.component';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { apiUrl } from '../../environments/environment';

// interface Trade {
//   timestamp: string;
//   trade_id: string;
//   ticker: string;
//   price: number;
//   volume: number;
//   side: 'BUY' | 'SELL';
//   trader_id?: string;
//   order_type?: string;
//   is_fault: boolean;
//   fault_type?: string | null;
//   fault_reason?: string | null;
//   // price_change_pct?: number | null;
//   // rolling_avg_volume_5m?: number | null;
//   // trade_volume_bucket?: string | null;
// }

// interface TradesResponse {
//   counts: number;
//   combined: Trade[];
// }

export interface PumpandDumpApiresponse {
  count: number;
  csv_path: string;
  csv_rows: number;
  incidents: PumpandDumpSecondGridData[];
  message: string;
  rule_nam: string;
}
export interface PumpandDumpSecondGridData {
  ticker: string;
  start_ts: string;
  peak_ts: string;
  end_ts: string;
  pump_return_pct: number;
  dump_return_pct: number;
  pump_volume_spike_mult: number;
  peak_volume: number;
  baseline_volume: number;
  pump_duration_min: number;
  dump_duration_min: number;
  confidence: number;
}
export interface ApiResponse {
  message: string;
  csv: string;
  counts: CountsResponse;
  combined: PumpandDumpResult[];
}
export interface CountsResponse {
  pump_and_dump_total: number | null;
  returned: number | null;
}
export interface PumpandDumpResult {
  timestamp: string;
  trade_id: string;
  ticker: string;
  price: number | null;
  volume: number | null;
  side: 'BUY' | 'SELL';
  trader_id: string;
  order_type: string;
  is_fault: boolean;
  fault_type: string | null;
  fault_reason: string | null;
}
export interface Params {
  window_minutes: number;
  dump_window_minutes: number;
  pump_pct: number;
  dump_pct: number;
  vol_window: number;
  vol_mult: number;
  min_bars: number;
  resample_rule: string;
}
export interface Weights {
  pump_strength: number;
  dump_strength: number;
  volume_strength: number;
}

@Component({
  selector: 'app-pump-and-dump',
  standalone: true,
  imports: [
    FormsModule,
    // AG Grid (standalone component import)
    AgGridAngular,
    CommonModule,
    // Material
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './pump-and-dump.component.html',
  styleUrl: './pump-and-dump.component.css',
})
export class PumpAndDumpComponent implements OnInit {
  showValidateBtn = false;
  showValidateArea = false;
  showResults = false;
  validateQuery = '';
  showSorry = false;
  loading = false;
  // Table data
  readonly BURSA_LINK =
    'https://www.bursamalaysia.com/bm/about_bursa/media_centre/bursa-malaysia-reprimands-fines-and-orders-to-strike-off-heah-sieu-tee-for-engaging-in-unethical-slash-false-trading-activities';
  // NOTE: The Swagger URL points to docs. Use the JSON API route that returns the data.
  // If your server exposes a different path, change API_URL below accordingly.

  readonly API_URL = (() => {
    const u = new URL(apiUrl('assets/export-faults'));
    u.searchParams.set('csv_filename', 'trades.csv');
    u.searchParams.set('limit', String(100));
    u.searchParams.set('newest_first', String(true));
    return u.toString();
  })();

  displayedColumns = ['serial', 'link'];
  resultRows = [{ url: this.BURSA_LINK, text: 'LINK' }]; //
  private readonly REQUIRED_PHRASE = 'Can you Validate the result';
  private readonly SCORE_PASS_THRESHOLD = 0.55; // tweak if you want stricter/looser pass
  private timerId: number | undefined;
  private http = inject(HttpClient);
  private dialog = inject(MatDialog);
  rowData: PumpandDumpResult[] = [];
  totalCount: number | null = null;
  private explainColsAdded = false;
  private detailHeights = new Map<string, number>();
  quickFilter = '';
  pageSize = 10;
  pageSizeOptions = [10, 20, 50, 100];

  lastRunMessage = '';
  lastRunCount = 0;
  gridApiWashTrade?: GridApi;

  private gridApi!: GridApi;
  @Output() executed = new EventEmitter<ManualResponse>();
  gridThemeClass = 'ag-theme-alpine compact-grid trades-grid';

  params: Params = {
    window_minutes: 30,
    dump_window_minutes: 60,
    pump_pct: 22.0,
    dump_pct: 16.0,
    vol_window: 30,
    vol_mult: 3.0,
    min_bars: 15,
    resample_rule: '1min',
  };

  weights: Weights = {
    pump_strength: 0.45,
    dump_strength: 0.45,
    volume_strength: 0.1,
  };

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    //floatingFilter: true,
    tooltipField: 'fault_reason',
    // width: 50, // target width
    // minWidth: 50, // allow smaller
    maxWidth: 160, // prevent very wide columns
  };

  autoSizeStrategy = {
    type: 'fitGridWidth',
    defaultMinWidth: 80,
    defaultMaxWidth: 140, // tighten even more if you like
  };

  colDefs: ColDef<PumpandDumpResult>[] = [
    {
      headerName: 'Time',
      field: 'timestamp',
      width: 200,
      minWidth: 200,
      cellStyle: {
        // prevent "..."
        whiteSpace: 'nowrap',
        textOverflow: 'clip',
        overflow: 'visible',
      },
      valueFormatter: (p) => {
        if (!p.value) return '';
        const s = String(p.value);
        if (s.includes('T') && s.endsWith('Z'))
          return s.slice(0, 19).replace('T', ' ');
        const d = new Date(s);
        if (isNaN(d.getTime())) return s;
        const pad = (n: number) => String(n).padStart(2, '0');
        return (
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
        );
      },
      tooltipValueGetter: (p) => {
        // full time on hover
        const s = String(p.value ?? '');
        return s.replace('T', ' ').replace('Z', '');
      },
    },
    { headerName: 'Trade ID', field: 'trade_id', width: 110 },
    { headerName: 'Ticker', field: 'ticker', width: 100 },
    {
      headerName: 'Price',
      field: 'price',
      valueFormatter: (p) => (p.value != null ? p.value : ''),
      width: 100,
    },
    {
      headerName: 'Volume',
      field: 'volume',
      valueFormatter: (p) => (p.value != null ? p.value.toLocaleString() : ''),
      width: 100,
    },
    { headerName: 'Side', field: 'side', width: 100 },
    { headerName: 'Order Type', field: 'order_type', width: 130 },
    {
      headerName: 'Fault?',
      field: 'is_fault',
      width: 100,
      valueFormatter: (p) => (p.value ? 'Yes' : 'No'),
      cellClass: (p) => (p.value ? 'fault-yes' : 'fault-no'),
    },
    {
      headerName: 'Fault Type',
      field: 'fault_type',
      valueFormatter: (p) => p.value,
      width: 130,
    },
    {
      headerName: 'Reason',
      field: 'fault_reason',
      width: 400,
      tooltipField: 'fault_reason',
    },
    // {
    //   headerName: 'Price %',
    //   field: 'price_change_pct',
    //   valueFormatter: (p) => (p.value != null ? `${p.value}%` : ''),
    //   width: 120,
    // },
    // {
    //   headerName: 'Roll Avg Vol (5m)',
    //   field: 'rolling_avg_volume_5m',
    //   valueFormatter: (p) => (p.value != null ? p.value.toLocaleString() : ''),
    //   width: 160,
    // },
    // {
    //   headerName: 'Vol Bucket',
    //   field: 'trade_volume_bucket',
    //   width: 120,
    //   cellClass: (p) =>
    //     p.value
    //       ? `bucket-${String(p.value).toLowerCase().replace(' ', '-')}`
    //       : '',
    // },
  ];

  rowDataWashTrade: PumpandDumpSecondGridData[] = [];
  defaultColDefWashTrade: ColDef = {
    resizable: true,
    sortable: true,
    filter: 'agNumberColumnFilter',
  };

  // ---- Grid 2 (verification results) ----
  columnDefsWashTrade: ColDef[] = [
    // Core
    {
      headerName: 'Ticker',
      field: 'ticker',
      filter: true,
      sortable: true,
      valueFormatter: (p) => (p.value === 'KLK' ? 'KENMARK' : p.value),
      width: 110,
      cellClass: 'cell-strong',
    },
    {
      headerName: 'Class',
      field: 'classification',
      width: 140,
      filter: true,
      valueFormatter: (p: ValueFormatterParams) => (p.value ?? '') as string,
      cellClass: (p: CellClassParams) =>
        p.value === 'True Positive'
          ? 'chip chip-good'
          : p.value === 'True Negative'
          ? 'chip chip-bad'
          : 'chip',
    },
    // {
    //   headerName: 'Confidence',
    //   field: 'overall_confidence',
    //   width: 140,
    //   type: 'rightAligned',
    //   filter: 'agNumberColumnFilter',
    //   valueFormatter: (p) =>
    //     p.value != null ? `${(Number(p.value) * 100).toFixed(1)}%` : '',
    //   cellClass: (p) => (Number(p.value) >= 0.7 ? 'chip chip-good' : 'chip'),
    // },
    {
      headerName: 'Confidence',
      colId: 'overall_confidence',
      width: 140,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p: ValueGetterParams) =>
        p.data?.overall_confidence ?? p.data?.rubric_score ?? null,
      valueFormatter: (p: ValueFormatterParams) =>
        p.value != null ? `${(Number(p.value) * 100).toFixed(1)}%` : '',
      cellClass: (p: CellClassParams) =>
        Number(p.value) >= 0.7
          ? 'chip chip-good'
          : Number(p.value) >= 0.55
          ? 'chip'
          : 'chip chip-bad',
    },
    // Timestamps
    {
      headerName: 'Start',
      field: 'start_ts',
      filter: 'agDateColumnFilter',
      width: 180,
      valueFormatter: (p) =>
        p.value ? String(p.value).replace('T', ' ').replace('Z', '') : '',
      tooltipValueGetter: (p) =>
        p.value ? String(p.value).replace('T', ' ').replace('Z', '') : '',
    },
    {
      headerName: 'Peak',
      field: 'peak_ts',
      filter: 'agDateColumnFilter',
      width: 180,
      valueFormatter: (p) =>
        p.value ? String(p.value).replace('T', ' ').replace('Z', '') : '',
      tooltipValueGetter: (p) =>
        p.value ? String(p.value).replace('T', ' ').replace('Z', '') : '',
    },
    {
      headerName: 'End',
      field: 'end_ts',
      filter: 'agDateColumnFilter',
      width: 180,
      valueFormatter: (p) =>
        p.value ? String(p.value).replace('T', ' ').replace('Z', '') : '',
      tooltipValueGetter: (p) =>
        p.value ? String(p.value).replace('T', ' ').replace('Z', '') : '',
    },

    // Returns (%)
    {
      headerName: 'Pump Return',
      field: 'max_future_return_wm', // from response
      width: 140,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) =>
        p.value != null ? `${Number(p.value).toFixed(2)}%` : '',
      cellClass: (p) => (Number(p.value) >= 22 ? 'chip chip-good' : 'chip'),
    },
    {
      headerName: 'Dump Return',
      field: 'min_future_return_dwm', // from response (usually negative)
      width: 140,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) =>
        p.value != null ? `${Number(p.value).toFixed(2)}%` : '',
      cellClass: (p) => (Number(p.value) <= -16 ? 'chip chip-bad' : 'chip'),
    },

    // Windows (minutes)
    {
      headerName: 'Pump Window',
      field: 'window_minutes',
      width: 130,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value != null ? `${Number(p.value)}m` : ''),
    },
    {
      headerName: 'Dump Window',
      field: 'dump_window_minutes',
      width: 130,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value != null ? `${Number(p.value)}m` : ''),
    },

    // Gates (booleans with label in tooltip)
    {
      headerName: 'Pattern',
      field: 'pattern_ok',
      width: 110,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      tooltipValueGetter: (p) => {
        const g = (p as any).data?.explain?.gates?.find(
          (x: any) => x.gate === 'pattern_ok'
        );
        return g?.label ?? 'Pattern shape';
      },
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },
    {
      headerName: 'Micro',
      field: 'micro_ok',
      width: 100,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      tooltipValueGetter: (p) => {
        const g = (p as any).data?.explain?.gates?.find(
          (x: any) => x.gate === 'micro_ok'
        );
        return g?.label ?? 'Microstructure';
      },
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },
    {
      headerName: 'Concentration',
      field: 'concentration_ok',
      width: 150,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      tooltipValueGetter: (p) => {
        const g = (p as any).data?.explain?.gates?.find(
          (x: any) => x.gate === 'concentration_ok'
        );
        return g?.label ?? 'Order-flow concentration';
      },
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },
    {
      headerName: 'Context',
      field: 'context_ok',
      width: 110,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      tooltipValueGetter: (p) => {
        const g = (p as any).data?.explain?.gates?.find(
          (x: any) => x.gate === 'context_ok'
        );
        return g?.label ?? 'Context / exogenous factors';
      },
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },
    {
      headerName: 'Cross-venue',
      field: 'crossvenue_ok',
      width: 140,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      tooltipValueGetter: (p) => {
        const g = (p as any).data?.explain?.gates?.find(
          (x: any) => x.gate === 'crossvenue_ok'
        );
        return g?.label ?? 'Cross-venue consistency';
      },
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },

    // Scores (from top-level or explain.scores)
    {
      headerName: 'Pattern Score',
      width: 130,
      type: 'rightAligned',
      valueGetter: (p) =>
        p.data?.pattern_score ??
        p.data?.explain?.scores?.find((s: any) => s.key === 'pattern_score')
          ?.value ??
        null,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Micro Score',
      width: 120,
      type: 'rightAligned',
      valueGetter: (p) =>
        p.data?.micro_score ??
        p.data?.explain?.scores?.find((s: any) => s.key === 'micro_score')
          ?.value ??
        null,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Concentration Score',
      width: 170,
      type: 'rightAligned',
      valueGetter: (p) =>
        p.data?.concentration_score ??
        p.data?.explain?.scores?.find(
          (s: any) => s.key === 'concentration_score'
        )?.value ??
        null,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Context Score',
      width: 140,
      type: 'rightAligned',
      valueGetter: (p) =>
        p.data?.context_score ??
        p.data?.explain?.scores?.find((s: any) => s.key === 'context_score')
          ?.value ??
        null,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },
    {
      headerName: 'Cross-venue Score',
      width: 160,
      type: 'rightAligned',
      valueGetter: (p) =>
        p.data?.crossvenue_score ??
        p.data?.explain?.scores?.find((s: any) => s.key === 'crossvenue_score')
          ?.value ??
        null,
      valueFormatter: (p) =>
        p.value != null ? Number(p.value).toFixed(3) : '',
    },

    // Vector hits (optional booleans)
    {
      headerName: 'Pump Vec',
      field: 'vector_pump_hit',
      width: 110,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },
    {
      headerName: 'Dump Vec',
      field: 'vector_dump_hit',
      width: 110,
      valueFormatter: (p) =>
        p.value === true ? 'True' : p.value === false ? 'False' : '',
      cellClass: (p) =>
        p.value === true
          ? 'chip chip-good'
          : p.value === false
          ? 'chip chip-bad'
          : 'chip',
    },
    // 0) EXPAND/COLLAPSE column (put this as the FIRST column)
    {
      headerName: '',
      width: 46,
      pinned: 'left',
      // suppressMenu: true,            // ❌ remove this
      menuTabs: [], // ✅ v34+ way to show no menu items
      headerClass: 'no-menu', // (CSS below hides the button itself)
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams) => {
        if ((p.data as any)?.__detail) return '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'expander';
        btn.title = 'Show details';
        const expanded = !!(p.data as any)?.__expanded;
        btn.textContent = expanded ? '▼' : '▶';
        btn.onclick = (ev) => {
          ev.stopPropagation();
          this.toggleExplain(p);
        };
        return btn;
      },
    },
    // ... (YOUR EXISTING COLUMNS HERE - no changes) ...
    // Z) DETAIL column (put this as the LAST column)
    {
      headerName: 'Explain',
      colId: 'explain_detail',
      autoHeight: true,
      wrapText: true,
      sortable: false,
      filter: false,
      // only shows content for synthetic detail rows
      cellRenderer: (p: ICellRendererParams) => {
        const d: any = p.data;
        if (!d?.__detail) return '';
        const div = document.createElement('div');
        div.className = 'explain-host';
        div.innerHTML = this.renderExplainHtml(d.__explain);
        return div;
      },
      // span across the entire grid (except the expander col) when on detail rows
      colSpan: (p) => {
        // use the callback's GridApi if present, else fall back to your saved api
        const api = (p as any).api ?? this.gridApiWashTrade;
        if (!api) return 1;

        // total displayed cols (left + center + right)
        const total =
          (api.getDisplayedLeftColumns?.() ?? []).length +
          (api.getDisplayedCenterColumns?.() ?? []).length +
          (api.getDisplayedRightColumns?.() ?? []).length;

        // span across everything except the expander column
        return Math.max(1, total - 1);
      },
    },
  ];

  // stable row ids (you already use this idea)

  slug(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  ngOnInit(): void {
    this.fetchTrades();
  }
  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
  }
  onGridReadyWashTrade(params: GridReadyEvent) {
    this.gridApiWashTrade = params.api;
  }

  onQuickFilter() {
    console.log('Applying quick filter:', this.quickFilter);
  }

  onPageSizeChange(size: number) {
    this.pageSize = size;
  }

  fetchTrades() {
    // debugger;
    this.http.get<ApiResponse>(this.API_URL).subscribe({
      next: (resp) => {
        this.totalCount = resp?.counts?.pump_and_dump_total ?? null;
        this.rowData = resp?.combined ?? [];
      },
      error: (err) => {
        console.error('Failed to fetch trades:', err);
        this.totalCount = 0;
        this.rowData = [];
      },
    });
  }

  open() {
    this.dialog
      .open(RuleConfigDialogComponent, {
        width: '720px',
        maxWidth: '95vw',
        autoFocus: 'first-tabbable',
        panelClass: 'rules-dialog',
      })
      .afterClosed()
      .subscribe((resp?: ManualResponse) => {
        if (resp) {
          this.executed.emit(resp);
        }
      });
  }

  OpenWizard() {
    const ref = this.dialog.open(ParamWizardDialogComponent, {
      height: '85vh',
      maxHeight: '90vh',
      width: '900px',
      maxWidth: '95vw',
      panelClass: 'param-wizard-panel',
      autoFocus: 'dialog',
      data: {
        start: '2025-01-01T00:00:00Z',
        end: '2025-12-31T23:59:59Z',
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
      const r = res.response as {
        message: string;
        count: number;
        results: PumpandDumpSecondGridData[];
      };

      //this.lastRunMessage = r.message;
      this.lastRunMessage = 'All rules applied successfully !';
      this.lastRunCount = r.count;

      // ⬇️ send API incidents to the *second* grid’s data
      this.rowDataWashTrade = r.results ?? []; // your existing line
      this.ensureExplainColumnsPresent(this.rowDataWashTrade); // <-- add this
      if (this.gridApiWashTrade) {
        this.gridApiWashTrade.setGridOption('rowData', this.rowDataWashTrade);
      }

      // Refresh grid 2 safely
      if (this.gridApiWashTrade) {
        this.gridApiWashTrade.applyTransaction({
          update: this.rowDataWashTrade,
        });
        this.showValidateBtn = true;
      }
    });
  }

  toggleValidateArea(): void {
    this.showValidateArea = !this.showValidateArea;
    this.resetValidationState();
  }

  onExecuteValidation(): void {
    if (this.loading) return;

    // snapshot the current input
    const phrase = (this.validateQuery || '').trim();
    const matches = phrase.toLowerCase() === this.REQUIRED_PHRASE.toLowerCase();

    // reset and show loader
    this.showResults = false;
    this.showSorry = false;
    this.loading = true;

    // clear any previous timer
    if (this.timerId) window.clearTimeout(this.timerId);

    // reveal result (or sorry) after 8s
    this.timerId = window.setTimeout(() => {
      this.loading = false;
      this.showResults = matches;
      this.showSorry = !matches;
      this.timerId = undefined;
    }, 8500);
  }

  ngOnDestroy(): void {
    if (this.timerId) {
      clearTimeout(this.timerId); // ✅ no "window."
    }
  }
  resetValidationState(): void {
    this.showResults = false;
    this.showSorry = false;
    this.loading = false;
    if (this.timerId) {
      window.clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }

  formatIso = (p: { value: string }) => {
    if (!p?.value) return '';
    const s = String(p.value);
    if (s.includes('T') && s.endsWith('Z'))
      return s.slice(0, 19).replace('T', ' ');
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  };

  // Stable IDs for parent rows and their synthetic detail rows
  // stable row ids (you already use this idea)
  getWashRowId = (p: any) => {
    const d = p.data;
    if (d?.__detail) return `detail|${d.__parentKey}`;
    return `${d?.ticker ?? 'NA'}|${d?.start_ts ?? ''}`;
  };
  // Style the inserted detail rows a bit
  // simple row class for styling the child row
  getWashRowClass = (p: any) => (p.data?.__detail ? ['detail-row'] : undefined);

  getDisplayedIndexByKey(api: GridApi, key: string): number {
    let found = -1;
    api.forEachNodeAfterFilterAndSort((n, idx) => {
      const k = `${n.data?.ticker ?? 'NA'}|${n.data?.start_ts ?? ''}`;
      // skip synthetic detail rows
      if ((n.data as any)?.__detail) return;
      if (k === key) found = idx;
    });
    return found;
  }

  // click handler to insert/remove the child row (same as you have, unchanged)
  toggleExplain(p: ICellRendererParams): void {
    const api = (p.api as GridApi) ?? this.gridApiWashTrade;
    if (!api) return;

    const parent: any = p.data;
    if (parent?.__detail) return;

    const key = `${parent.ticker ?? 'NA'}|${parent.start_ts ?? ''}`;

    // find displayed index by key (safe with sorting/filtering)
    let parentRowIndex = -1;
    api.forEachNodeAfterFilterAndSort((n, idx) => {
      if ((n.data as any)?.__detail) return;
      const k = `${n.data?.ticker ?? 'NA'}|${n.data?.start_ts ?? ''}`;
      if (k === key) parentRowIndex = idx;
    });
    if (parentRowIndex < 0) return;

    if (parent.__expanded) {
      const total = api.getDisplayedRowCount();
      if (parentRowIndex < total - 1) {
        const nextNode = api.getDisplayedRowAtIndex(parentRowIndex + 1);
        const nextData: any = nextNode?.data;
        if (nextData?.__detail && nextData.__parentKey === key) {
          api.applyTransaction({ remove: [nextData] });
        }
      }
      parent.__expanded = false;
      api.applyTransaction({ update: [parent] });
    } else {
      const detail = {
        __detail: true,
        __parentKey: key,
        __explain: parent.explain, // carry the explain object
      };
      api.applyTransaction({ add: [detail], addIndex: parentRowIndex + 1 });
      parent.__expanded = true;
      api.applyTransaction({ update: [parent] });
    }
  }

  /** Build HTML for the explain object (gates, scores, magnitude, windows, vectors, narrative) */
  renderExplainHtml(explain: any): string {
    if (!explain) return '<div class="muted">No explain data</div>';

    // Gates: label + pass (green/red)
    const gatesRows = (explain.gates ?? [])
      .map((g: any) => {
        const pass = !!g.pass;
        const cls = pass ? 'chip chip-good' : 'chip chip-bad';
        return `<tr>
        <td>${g.label || g.gate}</td>
        <td><span class="${cls}">${pass ? 'True' : 'False'}</span></td>
      </tr>`;
      })
      .join('');

    // Scores: label + pass (derive pass from value >= threshold)
    const thr = this.SCORE_PASS_THRESHOLD;
    const scoresRows = (explain.scores ?? [])
      .map((s: any) => {
        const val = typeof s.value === 'number' ? s.value : null;
        const pass = val != null ? val >= thr : null;
        const cls =
          pass == null ? 'chip' : pass ? 'chip chip-good' : 'chip chip-bad';
        const title =
          val != null
            ? `title="value=${val.toFixed(3)} • threshold=${thr}"`
            : '';
        return `<tr>
        <td>${s.label || s.key}</td>
        <td><span class="${cls}" ${title}>${
          pass == null ? '—' : pass ? 'True' : 'False'
        }</span></td>
      </tr>`;
      })
      .join('');

    // Magnitude checks: label + value_pct (as %)
    const magRows = (explain.magnitude_checks ?? [])
      .map((m: any) => {
        const val =
          typeof m.value_pct === 'number' ? `${m.value_pct.toFixed(2)}%` : '';
        return `<tr>
        <td>${m.label || m.metric}</td>
        <td class="num">${val}</td>
      </tr>`;
      })
      .join('');

    const narrative = explain.narrative
      ? `<div class="narr">${explain.narrative}</div>`
      : '<div class="muted">No narrative</div>';

    return `
  <div class="explain-wrap">
    <div class="ex-col">
      <h4>Gates</h4>
      <table class="mini">
        <thead><tr><th>Label</th><th>Pass</th></tr></thead>
        <tbody>${
          gatesRows || `<tr><td colspan="2" class="muted">—</td></tr>`
        }</tbody>
      </table>
    </div>

    <div class="ex-col">
      <h4>Scores</h4>
      <table class="mini">
        <thead><tr><th>Label</th><th>Pass</th></tr></thead>
        <tbody>${
          scoresRows || `<tr><td colspan="2" class="muted">—</td></tr>`
        }</tbody>
      </table>
    </div>

    <div class="ex-col">
      <h4>Magnitude</h4>
      <table class="mini">
        <thead><tr><th>Label</th><th>Value %</th></tr></thead>
        <tbody>${
          magRows || `<tr><td colspan="2" class="muted">—</td></tr>`
        }</tbody>
      </table>
    </div>
  </div>

  <div class="explain-wrap" style="grid-template-columns: 1fr;">
    <div class="ex-col">
      <h4>Narrative</h4>
      ${narrative}
    </div>
  </div>`;
  }

  /**
   * Create extra columns for child (detail) rows using the union of labels found in rowDataWashTrade.
   * Parent rows show blanks in these columns; detail rows show real values from __explain.
   */
  ensureExplainColumnsPresent(rows: any[]): void {
    if (this.explainColsAdded) return;
    if (!rows || !rows.length) return;

    const gateLabels = new Set<string>();
    const scoreLabels = new Set<string>();
    const magLabels = new Set<string>();

    for (const r of rows) {
      const ex = r?.explain;
      (ex?.gates ?? []).forEach((g: any) =>
        gateLabels.add(g?.label || g?.gate || 'Gate')
      );
      (ex?.scores ?? []).forEach((s: any) =>
        scoreLabels.add(s?.label || s?.key || 'Score')
      );
      (ex?.magnitude_checks ?? []).forEach((m: any) =>
        magLabels.add(m?.label || m?.metric || 'Magnitude')
      );
    }

    const childCols: ColDef[] = [];

    // ---- Gates (one column per gate: label + pass) ----
    for (const label of gateLabels) {
      const id = `gate_${this.slug(label)}`;
      childCols.push({
        headerName: `Gate: ${label}`,
        colId: id,
        width: 140,
        sortable: false,
        filter: false,
        valueGetter: (p: ValueGetterParams) => {
          const d: any = p.data;
          if (!d?.__detail) return ''; // parent rows blank
          const g = (d.__explain?.gates ?? []).find(
            (x: any) => (x.label || x.gate) === label
          );
          return g?.pass === true ? 'True' : g?.pass === false ? 'False' : '';
        },
        cellClass: (p: CellClassParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const g = (d.__explain?.gates ?? []).find(
            (x: any) => (x.label || x.gate) === label
          );
          return g?.pass ? 'chip chip-good' : 'chip chip-bad';
        },
      });
    }

    // ---- Scores (two columns per score: Pass, Meets) ----
    for (const label of scoreLabels) {
      const idBase = `score_${this.slug(label)}`;
      // Pass: computed from value >= threshold
      childCols.push({
        headerName: `Score: ${label} Pass`,
        colId: `${idBase}_pass`,
        width: 150,
        sortable: false,
        filter: false,
        valueGetter: (p: ValueGetterParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const s = (d.__explain?.scores ?? []).find(
            (x: any) => (x.label || x.key) === label
          );
          const v = typeof s?.value === 'number' ? s.value : null;
          return v == null
            ? ''
            : v >= this.SCORE_PASS_THRESHOLD
            ? 'True'
            : 'False';
        },
        cellClass: (p: CellClassParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const s = (d.__explain?.scores ?? []).find(
            (x: any) => (x.label || x.key) === label
          );
          const v = typeof s?.value === 'number' ? s.value : null;
          if (v == null) return 'chip';
          return v >= this.SCORE_PASS_THRESHOLD
            ? 'chip chip-good'
            : 'chip chip-bad';
        },
        tooltipValueGetter: (p) => {
          const d: any = (p as any).data;
          const s = (d?.__explain?.scores ?? []).find(
            (x: any) => (x.label || x.key) === label
          );
          const v = typeof s?.value === 'number' ? s.value.toFixed(3) : '—';
          return `value=${v} • threshold=${this.SCORE_PASS_THRESHOLD}`;
        },
      });
      // Meets: duplicate of pass but explicitly Yes/No
      childCols.push({
        headerName: `Score: ${label} Meets`,
        colId: `${idBase}_meets`,
        width: 160,
        sortable: false,
        filter: false,
        valueGetter: (p: ValueGetterParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const s = (d.__explain?.scores ?? []).find(
            (x: any) => (x.label || x.key) === label
          );
          const v = typeof s?.value === 'number' ? s.value : null;
          return v == null ? '' : v >= this.SCORE_PASS_THRESHOLD ? 'Yes' : 'No';
        },
        cellClass: (p: CellClassParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const s = (d.__explain?.scores ?? []).find(
            (x: any) => (x.label || x.key) === label
          );
          const v = typeof s?.value === 'number' ? s.value : null;
          if (v == null) return 'chip';
          return v >= this.SCORE_PASS_THRESHOLD
            ? 'chip chip-good'
            : 'chip chip-bad';
        },
      });
    }

    // ---- Magnitude (two columns per metric: Value %, Meets) ----
    for (const label of magLabels) {
      const idBase = `mag_${this.slug(label)}`;
      childCols.push({
        headerName: `Mag: ${label} %`,
        colId: `${idBase}_val`,
        width: 150,
        type: 'rightAligned',
        sortable: false,
        filter: false,
        valueGetter: (p: ValueGetterParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const m = (d.__explain?.magnitude_checks ?? []).find(
            (x: any) => (x.label || x.metric) === label
          );
          return typeof m?.value_pct === 'number'
            ? `${m.value_pct.toFixed(2)}%`
            : '';
        },
      });
      childCols.push({
        headerName: `Mag: ${label} Meets`,
        colId: `${idBase}_meets`,
        width: 160,
        sortable: false,
        filter: false,
        valueGetter: (p: ValueGetterParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const m = (d.__explain?.magnitude_checks ?? []).find(
            (x: any) => (x.label || x.metric) === label
          );
          return m?.meets_threshold == null
            ? ''
            : m.meets_threshold
            ? 'Yes'
            : 'No';
        },
        cellClass: (p: CellClassParams) => {
          const d: any = p.data;
          if (!d?.__detail) return '';
          const m = (d.__explain?.magnitude_checks ?? []).find(
            (x: any) => (x.label || x.metric) === label
          );
          if (m?.meets_threshold == null) return 'chip';
          return m.meets_threshold ? 'chip chip-good' : 'chip chip-bad';
        },
      });
    }

    // ---- Narrative (one column) ----
    childCols.push({
      headerName: 'Narrative',
      colId: 'explain_narrative',
      minWidth: 260,
      flex: 1,
      sortable: false,
      filter: false,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p: ValueGetterParams) => {
        const d: any = p.data;
        return d?.__detail ? d.__explain?.narrative ?? '' : '';
      },
    });

    // Append to your existing working columns
    this.columnDefsWashTrade = [...this.columnDefsWashTrade, ...childCols];
    // If grid is already created, update columns now:
    if (this.gridApiWashTrade) {
      this.gridApiWashTrade.setGridOption(
        'columnDefs',
        this.columnDefsWashTrade
      );
      this.gridApiWashTrade.refreshHeader();
    }
    this.explainColsAdded = true;
  }

  // mark only the synthetic child row as full-width
  isFullWidthRow = (p: IsFullWidthRowParams) => !!p?.rowNode?.data?.__detail;

  // give the child row more height (autoHeight within renderer still works)
  getWashRowHeight = (p: RowHeightParams) =>
    p.data?.__detail ? 660 : undefined;

  // bind this function in the template as [fullWidthCellRenderer]
  fullWidthRenderer = (p: ICellRendererParams) => {
    const d: any = p.data;
    if (!d?.__detail) return '';
    const ex = d.__explain ?? {};
    const thr = this.SCORE_PASS_THRESHOLD;

    const gates = (ex.gates ?? [])
      .map((g: any) => {
        const pass = !!g.pass;
        const cls = pass ? 'chip chip-good' : 'chip chip-bad';
        return `<tr><td>${g.label || g.gate}</td><td><span class="${cls}">${
          pass ? 'True' : 'False'
        }</span></td></tr>`;
      })
      .join('');

    const scores = (ex.scores ?? [])
      .map((s: any) => {
        const v = typeof s.value === 'number' ? s.value : null;
        const pass = v != null ? v >= thr : null;
        const cls =
          pass == null ? 'chip' : pass ? 'chip chip-good' : 'chip chip-bad';
        const meets = pass == null ? '—' : pass ? 'Yes' : 'No';
        return `<tr>
      <td>${s.label || s.key}</td>
      <td><span class="${cls}" title="value=${
          v?.toFixed?.(3) ?? '—'
        } • threshold=${thr}">${
          pass == null ? '—' : pass ? 'True' : 'False'
        }</span></td>
      <td>${meets}</td>
    </tr>`;
      })
      .join('');

    const mags = (ex.magnitude_checks ?? [])
      .map((m: any) => {
        const val =
          typeof m.value_pct === 'number' ? `${m.value_pct.toFixed(2)}%` : '';
        const meets =
          m?.meets_threshold == null ? '—' : m.meets_threshold ? 'Yes' : 'No';
        const cls =
          m?.meets_threshold == null
            ? 'chip'
            : m.meets_threshold
            ? 'chip chip-good'
            : 'chip chip-bad';
        return `<tr><td>${
          m.label || m.metric
        }</td><td class="num">${val}</td><td><span class="${cls}">${meets}</span></td></tr>`;
      })
      .join('');

    const narrative = ex.narrative
      ? `<div class="narr">${ex.narrative}</div>`
      : '<div class="muted">No narrative</div>';

    const host = document.createElement('div');
    host.className = 'explain-fullwidth';
    host.innerHTML = `
    <div class="ex-grid">
      <div class="ex-card">
        <h4>Gates</h4>
        <table class="mini">
          <thead><tr><th>Label</th><th>Pass</th></tr></thead>
          <tbody>${
            gates || `<tr><td colspan="2" class="muted">—</td></tr>`
          }</tbody>
        </table>
      </div>

      <div class="ex-card">
        <h4>Scores</h4>
        <table class="mini">
          <thead><tr><th>Label</th><th>Pass</th><th>Meets</th></tr></thead>
          <tbody>${
            scores || `<tr><td colspan="3" class="muted">—</td></tr>`
          }</tbody>
        </table>
      </div>

      <div class="ex-card">
        <h4>Magnitude</h4>
        <table class="mini">
          <thead><tr><th>Label</th><th>Value %</th><th>Meets</th></tr></thead>
          <tbody>${
            mags || `<tr><td colspan="3" class="muted">—</td></tr>`
          }</tbody>
        </table>
      </div>

      <div class="ex-card">
        <h4>Narrative</h4>
        ${narrative}
      </div>
    </div>
  `;

    // Measure and cache height after DOM paints, then refresh row heights
    setTimeout(() => {
      try {
        const key = d.__parentKey ?? 'detail';
        const h = Math.max(host.scrollHeight + 12, 220); // padding + min
        if (this.detailHeights.get(key) !== h) {
          this.detailHeights.set(key, h);
          (p.api as GridApi).resetRowHeights(); // reflow the row to show all sections
        }
      } catch {}
    });

    return host;
  };
}
