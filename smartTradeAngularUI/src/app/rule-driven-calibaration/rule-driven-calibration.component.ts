import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ColDef, ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
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
import { ParamWizardDialogv2Component } from '../pump-and-dumpV2/param-wizard-dialogv2/param-wizard-dialog-v2.component';
import { ExplainDialogComponent } from '../explain-dialog/explain-dialog.component';
// keep this path consistent

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-rule-driven-calibration',
  standalone: true,
  templateUrl: './rule-driven-calibration.component.html',
  styleUrls: ['./rule-driven-calibration.component.css'],
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
export class RuleDrivenCalibrationComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private dialog2 = inject(MatDialog);
  gridThemeClass = 'ag-theme-alpine compact-grid trades-grid';
  totalCount: number | null = null;
  quickFilter = '';
  pageSize = 10;
  pageSizeOptions = [10, 20, 50, 100];

  calibRows: any[] = []; // parent rows from wizard
  showTPOnly = true;

  loading = signal(false);
  error = signal<string | null>(null);
  private dialog = inject(MatDialog);
  // parent cols (includes explain link)
  calibDefaultColDef: ColDef = {
    sortable: true,
    //filter: true,
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

  ngOnInit(): void {
    // this.OpenWizard();
    //this.loading.set(false);
    console.log('MlDrivenComponent initialized');
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

  private isTP(r: any): boolean {
    const s = (x: any) => (typeof x === 'string' ? x.toLowerCase() : '');
    return s(r?.decision) === 'true positive';
  }

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

  // cleanup
  ngOnDestroy() {
    console.log('RuleGridComponent destroyed');
  }
}
