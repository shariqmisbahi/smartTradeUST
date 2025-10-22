import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridModule } from 'ag-grid-angular';
import { HttpClientModule } from '@angular/common/http';
import {
  TradingActivityService,
  TradeResponse,
} from '../services/trading-activity.service';

@Component({
  selector: 'app-real-time-monitoring',
  standalone: true,
  templateUrl: './real-time-monitoring.component.html',
  styleUrls: ['./real-time-monitoring.component.css'],
  imports: [CommonModule, FormsModule, AgGridModule, HttpClientModule],
})
export class RealTimeMonitoringComponent implements OnInit {
  // ag-grid refs
  private gridApi: any;
  private gridColumnApi: any;

  // grid data/columns
  rowData: any[] = [];
  columnDefs: any[] = [];
  defaultColDef = {
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 160, // ← wider by default so headers are readable
  };

  // paging
  page = 1;
  pageSize = 50;
  pageSizeOptions = [25, 50, 100, 200];
  totalCount = 0;
  totalPages = 1;
  pageStart = 0;
  pageEnd = 0;

  // filters
  showFaultOnly = false;
  searchQuery = '';

  // ui state
  isLoading = false;
  loadError: string | null = null;

  constructor(private tradingService: TradingActivityService) {}

  ngOnInit(): void {
    this.loadPage(1);
  }

  onGridReady(params: any) {
    this.gridApi = params.api;
    this.gridColumnApi = params.columnApi;
  }

  // ===== Data & Paging =====
  loadPage(targetPage: number) {
    this.isLoading = true;
    this.loadError = null;

    this.tradingService
      .getTrades(
        targetPage,
        this.pageSize,
        this.searchQuery,
        this.showFaultOnly
      )
      .subscribe({
        next: (resp: TradeResponse) => {
          const data = resp?.trades ?? [];
          const count = Number(resp?.count ?? data.length);

          // build columns once (or when schema unknown)
          if (data.length && this.columnDefs.length === 0) {
            this.columnDefs = this.buildColumnDefsFromRow(data[0]);
          }

          // set data
          this.rowData = data;
          this.totalCount = count;
          this.page = targetPage;
          this.totalPages = Math.max(
            1,
            Math.ceil(this.totalCount / this.pageSize)
          );

          // visible range
          if (this.totalCount === 0) {
            this.pageStart = 0;
            this.pageEnd = 0;
          } else {
            this.pageStart = (this.page - 1) * this.pageSize + 1;
            this.pageEnd = Math.min(this.page * this.pageSize, this.totalCount);
          }

          // auto-size columns (keeps header readable)
          setTimeout(() => this.autoSizeAll(), 0);
        },
        error: (err) => {
          console.error(err);
          this.loadError = 'Failed to fetch trades. Please try again.';
        },
        complete: () => (this.isLoading = false),
      });
  }

  firstPage() {
    if (this.page > 1) this.loadPage(1);
  }
  prevPage() {
    if (this.page > 1) this.loadPage(this.page - 1);
  }
  nextPage() {
    if (this.page < this.totalPages) this.loadPage(this.page + 1);
  }
  lastPage() {
    if (this.page < this.totalPages) this.loadPage(this.totalPages);
  }

  onJumpToPage(value: string | number) {
    const p = Math.max(1, Math.min(this.totalPages, Number(value) || 1));
    this.loadPage(p);
  }

  onPageSizeChange() {
    this.columnDefs = []; // schema might change; safe to re-infer
    this.loadPage(1);
  }

  applySearch() {
    this.columnDefs = []; // re-infer columns if backend changes fields with query
    this.loadPage(1);
  }

  clearSearch() {
    this.searchQuery = '';
    this.applySearch();
  }

  toggleFaultOnly() {
    this.columnDefs = [];
    this.loadPage(1);
  }

  // ===== Columns =====
  private buildColumnDefsFromRow(sample: any): any[] {
    const formatterMap: Record<string, (p: any) => string> = {
      timestamp: (p) => {
        if (!p.value) return '';
        const d = new Date(p.value);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`;
      },
      price: (p) => (p.value != null ? Number(p.value).toFixed(4) : ''),
      is_fault: (p) => (p.value ? '⚠️ Yes' : '✅ No'),
    };

    const headerPretty = (k: string) =>
      k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const preferredOrder = [
      'trade_id',
      'ticker',
      'timestamp',
      'price',
      'volume',
      'side',
      'trader_id',
      'order_type',
      'is_fault',
      'fault_type',
      'fault_reason',
    ];

    const keys = Array.from(
      new Set([
        ...preferredOrder.filter((k) => k in sample),
        ...Object.keys(sample).filter((k) => !preferredOrder.includes(k)),
      ])
    );

    return keys.map((key) => {
      const col: any = {
        headerName: headerPretty(key),
        field: key,
        sortable: true,
        filter: true,
        resizable: true,
      };
      if (formatterMap[key]) col.valueFormatter = formatterMap[key];
      if (key === 'fault_reason') {
        col.flex = 2; // make this one wider
        col.cellRenderer = (params: any) => {
          const text = params.value || '';
          const clipped = text.length > 80 ? text.slice(0, 80) + '…' : text;
          return `<span title="${text}">${clipped}</span>`;
        };
      }
      return col;
    });
  }

  private autoSizeAll() {
    if (!this.gridColumnApi) return;
    const allIds: string[] = [];
    this.gridColumnApi
      .getColumns()
      ?.forEach((c: any) => allIds.push(c.getColId()));
    if (allIds.length) this.gridColumnApi.autoSizeColumns(allIds, false);
  }
}
