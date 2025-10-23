import { Component, inject, signal, computed } from '@angular/core';
import { ColDef, GetRowIdFunc } from 'ag-grid-community';
import { InsiderTradingRow } from '../models/insiderTrading.models';
import { InsiderTradingService } from '../services/insider-trading.service';
import { AgGridAngular } from 'ag-grid-angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  InsiderTradingRefineService,
  RefineResponse,
  ThresholdMode,
  ReturnMode,
} from '../services/insider-trading-refine.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MnpiResultsDialogComponent } from './mnpi-results-dialog.component ';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { LucideAngularModule } from 'lucide-angular';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-insider-trading',
  imports: [
    CommonModule,
    FormsModule,
    // AG Grid (standalone component import)
    AgGridAngular,
    MatDialogModule, // <-- NEW
    MatButtonModule, // <-- NEW
    LucideAngularModule,
  ],
  templateUrl: './insider-trading.component.html',
  styleUrl: './insider-trading.component.css',
})
export class InsiderTradingComponent {
  rowDataGrid1: InsiderTradingRow[] = [];
  private dialog = inject(MatDialog); // <-- NEW
  // --- Grid 1: Insider-only columns + a few meta fields ---
  colDefsGrid1: ColDef[] = [
    // Meta (pinned/first)
    {
      headerName: 'Alert ID',
      field: 'alert_id',
      width: 160,
      pinned: 'left',
    },
    {
      headerName: 'ISIN',
      field: 'isin',
      width: 140,
      cellClass: 'mono-code',
      pinned: 'left',
    },
    {
      headerName: 'Security',
      field: 'security_name',
      width: 200,
    },
    { headerName: 'Type', field: 'security_type', width: 110 },
    { headerName: 'Side', field: 'market_side', width: 100 },

    // INSIDER FIELDS (exact list you requested)
    {
      headerName: 'MNPI',
      field: 'insider_mnpi_flag',
      width: 100,
      valueFormatter: (p) =>
        p.value === true ? 'Yes' : p.value === false ? 'No' : '',
    },
    { headerName: 'Relation', field: 'insider_relation', width: 100 },
    { headerName: 'Event Type', field: 'insider_event_type', minWidth: 140 },
    {
      headerName: 'Event Time',
      field: 'insider_event_datetime',
      minWidth: 180,
    },
    {
      headerName: 'Pre %',
      field: 'insider_pre_event_return_pct',
      width: 110,
      valueFormatter: (p) => (p.value == null ? '' : `${p.value}%`),
    },
    {
      headerName: 'Post %',
      field: 'insider_post_event_return_pct',
      width: 110,
      valueFormatter: (p) => (p.value == null ? '' : `${p.value}%`),
    },
    {
      headerName: 'Linkage',
      field: 'insider_linkage_score',
      width: 110,
      valueFormatter: (p) =>
        p.value == null ? '' : Number(p.value).toFixed(3),
    },
    {
      headerName: 'Suspicious P&L',
      field: 'insider_suspicious_profit',
      minWidth: 150,
      valueFormatter: (p) =>
        p.value == null ? '' : Number(p.value).toLocaleString(),
    },

    // Price & sizes
    {
      headerName: 'Price',
      field: 'price',
      width: 110,
      valueFormatter: (p) =>
        p.value == null ? '' : Number(p.value).toLocaleString(),
    },
    {
      headerName: 'Volume',
      field: 'total_volume',
      width: 120,
      valueFormatter: (p) =>
        p.value == null ? '' : Number(p.value).toLocaleString(),
    },
    {
      headerName: 'Value',
      field: 'value',
      width: 140,
      valueFormatter: (p) =>
        p.value == null ? '' : Number(p.value).toLocaleString(),
    },

    // Meta tail
    { headerName: 'Broker', field: 'broker', minWidth: 140 },
    { headerName: 'Account', field: 'account', width: 130 },
    { headerName: 'Date', field: 'date', width: 120 },
    { headerName: 'Time', field: 'time', width: 110 },
  ];

  api = inject(InsiderTradingService);
  serviceApi = inject(InsiderTradingRefineService);

  defaultColDefGrid1: ColDef = {
    resizable: true,
    sortable: true,
    //filter: true,
    //floatingFilter: true,
  };

  // Optional: if these are bound in your template
  gridThemeClass = 'ag-theme-alpine compact-grid trades-grid';
  pageSize = 20;
  quickFilter = '';

  // Match your template binding: [getRowId]="getRowId1"
  getRowId1: GetRowIdFunc = (params) =>
    params.data?.alert_id ?? params.data?.order_id;

  onGridReady(): void {
    this.loadData();
  }

  loadData(): void {
    const limit = 200;

    this.api.getLatest(limit).subscribe({
      next: (rows) => {
        this.rowDataGrid1 = rows;
        // If you want to auto size after data loads, you can use grid API if available:
        // setTimeout(() => this.gridApi?.sizeColumnsToFit(), 0);
      },
      error: (err) => {
        console.error('Failed to load Insider Trading alerts', err);
        this.rowDataGrid1 = [];
      },
    });
  }

  // Grid 2 - Refined Results
  // ------------ UI state ------------
  limit = 200;
  returnMode: ReturnMode = 'tp_only';
  thresholdMode: ThresholdMode = 'fixed';
  threshold = 0.85; // fixed mode slider (0..1)
  topPct = 5; // quantile mode (top N%)
  startISO: string | null = null;
  endISO: string | null = null;
  forceProxyScoring = false;

  // weights
  w = {
    pattern: 0.3,
    micro: 0.2,
    concentration: 0.2,
    context: 0.15,
    crossvenue: 0.15,
  };

  // data & stats
  rowData = signal<any[]>([]);
  colDefs = signal<ColDef[]>([]);
  extras = signal<RefineResponse['extras'] | undefined>(undefined);
  lastUsedThreshold = signal<number>(this.threshold);

  // quick access for suggested thresholds
  // Suggested thresholds now read from backend field names
  p90 = computed(() => this.extras()?.p90 ?? null);
  p95 = computed(() => this.extras()?.p95 ?? null);

  isLoading = signal(false);
  errorMsg = signal<string | null>(null);

  // --- OPEN POPUP: filter from the *bottom* grid (rowData()/colDefs()) ---
  openMnpiPopup(): void {
    const rowsAll = this.rowData() ?? [];
    const filtered = rowsAll.filter((r) => r?.insider_mnpi_flag === true);
    const cols = (
      this.colDefs()?.length ? this.colDefs() : this.colDefsGrid1
    ) as ColDef[];

    this.dialog.open(MnpiResultsDialogComponent, {
      width: '1300px',
      maxWidth: '98vw',
      height: '75vh',
      data: { rows: filtered, cols },
    });
  }

  // Build columns dynamically when new data arrives
  private buildColsFromRows(rows: any[]): ColDef[] {
    if (!rows?.length) return [];

    const KEYS_TO_SKIP = new Set([
      'explanations',
      'explanations_full',
      'reasons',
      'details',
      'children',
      'raw',
      'debug',
      'calc_debug',
      'weights',
      '__meta__',
    ]);

    // 1) collect keys from a sample (avoid missing sparsely-populated columns)
    const keys = new Set<string>();
    const scanN = Math.min(rows.length, 50);
    for (let i = 0; i < scanN; i++) {
      const r = rows[i];
      Object.keys(r ?? {}).forEach((k) => {
        if (k.startsWith('pd_')) return;
        if (k.startsWith('_')) return;
        if (KEYS_TO_SKIP.has(k)) return;
        const v = r[k];
        if (v && typeof v === 'object') return; // skip nested objects/arrays
        keys.add(k);
      });
    }

    // 2) preferred order (present-only)
    const preferredOrder = [
      'classification',
      'rubric_score',
      'pattern_score',
      'micro_score',
      'concentration_score',
      'context_score',
      'crossvenue_score',
      'alert_id',
      'security_name',
      'security_type',
      'market_side',
      'price',
      'total_volume',
      'value',
      'insider_mnpi_flag',
      'insider_relation',
      'insider_event_type',
      'insider_event_datetime',
      'insider_pre_event_return_pct',
      'insider_post_event_return_pct',
      'insider_linkage_score',
      'insider_suspicious_profit',
      'isin',
      'broker',
      'account',
      'date',
      'time',
    ];

    const toTitle = (s: string) =>
      s
        .replace(/^is_/, '')
        .replace(/_/g, ' ')
        .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());

    const moneyFields = new Set([
      'price',
      'value',
      'total_volume',
      'suspicious_profit',
      'insider_suspicious_profit',
    ]);
    const isPercentLike = (f: string) =>
      f.endsWith('_pct') || f.endsWith('_percent') || /pct|percent/i.test(f);
    const isScoreLike = (f: string) =>
      f.endsWith('_score') ||
      [
        'pattern_score',
        'micro_score',
        'concentration_score',
        'context_score',
        'crossvenue_score',
        'rubric_score',
      ].includes(f);
    const isYesNoLike = (f: string) => f.endsWith('_flag') || /^is_/.test(f);

    const fmtYesNo = (v: any) => (v === true ? 'Yes' : v === false ? 'No' : '');
    const fmtNum3 = (v: any) =>
      v == null ? '' : typeof v === 'number' ? v.toFixed(3) : v;
    const fmtMoney = (v: any) => (v == null ? '' : Number(v).toLocaleString());
    const fmtPct = (v: any) => (v == null ? '' : `${v}%`);

    const spec: Record<string, ColDef> = {
      classification: {
        field: 'classification',
        headerName: 'Class',
        minWidth: 120,
        pinned: 'left',
        cellRenderer: (p: any) => {
          const v = p.value ?? '';
          const cls = v === 'True Positive' ? 'chip chip-tp' : 'chip chip-tn';
          return `<span class="${cls}">${v}</span>`;
        },
      },
      rubric_score: {
        field: 'rubric_score',
        headerName: 'Rubric',
        minWidth: 110,
        pinned: 'left',
        valueFormatter: (p) => fmtNum3(p.value),
      },
      alert_id: {
        field: 'alert_id',
        headerName: 'Alert ID',
        minWidth: 140,
        pinned: 'left',
      },
      security_name: {
        field: 'security_name',
        headerName: 'Security',
        minWidth: 200,
        filter: true,
        pinned: 'left',
      },
      isin: {
        field: 'isin',
        headerName: 'ISIN',
        minWidth: 160,
        cellClass: 'mono-code',
      },
    };

    const makeDef = (f: string): ColDef => {
      if (spec[f]) return spec[f];
      const def: ColDef = { field: f, headerName: toTitle(f), minWidth: 120 };
      if (isYesNoLike(f)) def.valueFormatter = (p) => fmtYesNo(p.value);
      else if (isPercentLike(f)) def.valueFormatter = (p) => fmtPct(p.value);
      else if (moneyFields.has(f))
        def.valueFormatter = (p) => fmtMoney(p.value);
      else if (isScoreLike(f)) def.valueFormatter = (p) => fmtNum3(p.value);
      return def;
    };

    const present = Array.from(keys);

    // 3) build column list: preferred first, then any remaining keys alphabetically
    const cols: ColDef[] = [];
    for (const f of preferredOrder)
      if (present.includes(f)) cols.push(makeDef(f));
    const used = new Set(cols.map((c) => c.field as string));
    const rest = present
      .filter((f) => !used.has(f))
      .sort((a, b) => a.localeCompare(b));
    for (const f of rest) cols.push(makeDef(f));

    return cols;
  }

  async OnInit() {
    await this.refresh();
  }

  async refresh() {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    try {
      const payload = {
        limit: this.limit,
        return_mode: this.returnMode,
        params: {
          start: this.startISO,
          end: this.endISO,
          true_positive_threshold:
            this.thresholdMode === 'fixed' ? this.threshold : undefined,
          threshold_mode: this.thresholdMode,
          top_pct: this.thresholdMode === 'quantile' ? this.topPct : undefined,
          force_proxy_scoring: this.forceProxyScoring,
        },
        weights: { ...this.w },
      };

      const res = await this.serviceApi.refine(payload);
      this.rowData.set(res.results || []);
      this.colDefs.set(this.buildColsFromRows(res.results || []));
      this.extras.set(res.extras);
      this.lastUsedThreshold.set(res.true_positive_threshold ?? this.threshold);
    } catch (err: any) {
      this.errorMsg.set(err?.message || 'Failed to load data');
      this.rowData.set([]);
      this.colDefs.set([]);
      this.extras.set(undefined);
    } finally {
      this.isLoading.set(false);
    }
  }

  // Slider changed (fixed mode)
  // insider-trading-refine.component.ts
  async onThresholdChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.threshold = input.valueAsNumber;
    if (this.thresholdMode === 'fixed') {
      await this.refresh();
    }
  }

  // Snap threshold to p90/p95 (fixed mode)
  async snapTo(percentile: 'p90' | 'p95') {
    const val = percentile === 'p90' ? this.p90() : this.p95();
    if (val == null) return;
    // Clamp to [0,1]
    this.threshold = Math.max(0, Math.min(1, val));
    this.thresholdMode = 'fixed';
    await this.refresh();
  }

  // Quantile change → refresh
  async onTopPctChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.topPct = input.valueAsNumber;
    if (this.thresholdMode === 'quantile') {
      await this.refresh();
    }
  }

  // Utility for header metrics
  get tpCount(): number {
    return (this.extras()?.tp_count ?? 0) as number;
    // some backends return floats; cast is fine for display
  }
  get tnCount(): number {
    return (this.extras()?.tn_count ?? 0) as number;
  }
}
