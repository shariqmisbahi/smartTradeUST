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
//import { finalize, timer, switchMap } from 'rxjs';
import { MatTabsModule } from '@angular/material/tabs';
import { apiUrl } from '../../environments/environment';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-rule-grid',
  standalone: true,
  templateUrl: './rule-grid-component.html',
  styleUrls: ['./rule-grid.component.css'],
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
export class RuleGridComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private dialog2 = inject(MatDialog);

  gridThemeClass = 'ag-theme-alpine compact-grid trades-grid';
  totalCount: number | null = null;
  quickFilter = '';
  pageSize = 10;
  pageSizeOptions = [10, 20, 50, 100];
  rowDataGrid1: PumpDumpRow[] = [];

  private gridApi!: GridApi;
  // data state (signals)
  loading = signal(false);
  error = signal<string | null>(null);
  meta = signal<Omit<ApiPnDResponse, 'results'> | null>(null);
  rows = signal<PumpDumpRow[]>([]);

  @ViewChild(AgGridAngular) grid?: AgGridAngular<PumpDumpRow>;

  readonly API_URL = (() => {
    const u = new URL(apiUrl('simulate/alerts/latest/pumpdump'));
    u.searchParams.set('limit', '200');
    return u.toString();
  })();
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

  // stable row ids
  getRowId1 = (p: { data: PumpDumpRow }) =>
    p?.data?.trade_id ??
    p?.data?.order_id ??
    p?.data?.alert_id ??
    `${p?.data?.date}T${p?.data?.time}`;

  ngOnInit(): void {
    this.getDatafetch();
    this.loading.set(false);
  }

  getDatafetch(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<ApiPnDResponse>(this.API_URL).subscribe({
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

  // cleanup
  ngOnDestroy() {
    console.log('RuleGridComponent destroyed');
  }
}
