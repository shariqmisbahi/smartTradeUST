import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { trigger, transition, style, animate } from '@angular/animations';
import { timer, take, Subject, takeUntil } from 'rxjs';
import { GridOptions, ValueGetterParams } from 'ag-grid-community';
import { apiUrl } from '../../environments/environment';

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
export interface WizardData {
  start?: string; // ISO Z
  end?: string; // ISO Z
  params?: Partial<Params>;
  weights?: Partial<Weights>;
}
export interface ApiResponse {
  message: string;
  rule_name: string;
  csv: string;
  count: number;
  incidents: Incident[];
}

export interface Incident {
  ticker: string;
  start_ts: string;
  peak_ts: string;
  end_ts: string;
  pump_return_pct: number | null;
  dump_return_pct: number | null;
  pump_duration_min: number | null;
  dump_duration_min: number | null;
  peak_volume: number | null;
  baseline_volume: number | null;
  pump_volume_spike_mult: number | null;
  confidence: number | null;
}

@Component({
  selector: 'app-param-wizard-dialog',
  standalone: true,
  templateUrl: './param-wizard-dialog.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatStepperModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatDividerModule,
    MatSnackBarModule,
    HttpClientModule,
  ],
  animations: [
    trigger('fadeInOut', [
      transition('* => *', [
        style({ opacity: 0, transform: 'translateY(6px)' }),
        animate(
          '4000ms ease-out', // ⬅️ was 7000ms; show each message for 4s
          style({ opacity: 1, transform: 'translateY(0)' })
        ),
      ]),
    ]),
  ],
})
export class ParamWizardDialogComponent {
  private fb = inject(FormBuilder);
  private ref = inject(MatDialogRef<ParamWizardDialogComponent, unknown>);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);
  data: WizardData =
    inject<WizardData>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  readonly messages = [
    'Applying Rules...',
    'Filtering by Start and End Dates...',
    'Applying Parameters...',
    'Applying Weights...',
    'Creating Indexes...',
    'Finalizing Data...',
    'Hang on tightly...',
  ];

  currentIndex = 0;
  currentText = this.messages[0];

  private destroy$ = new Subject<void>();

  isSubmitting = false;
  apiUrl = (() => {
    const u = new URL(apiUrl('assets/verify-latest'));
    u.searchParams.set('explain', 'full');
    u.searchParams.set('limit', '20');
    return u.toString();
  })();

  resampleOptions = ['1min', '5min', '15min', '30min', '60min'];

  gridOptions: GridOptions = {
    defaultColDef: { resizable: true, sortable: true, filter: true },
    rowSelection: 'single',
    animateRows: true,
    getRowId: (p) => `${p.data?.ticker ?? 'NA'}|${p.data?.start_ts ?? ''}`,
    masterDetail: false, // set true if you wire a detail renderer
  };

  // -------- Helpers as METHODS (OK to reference from later property initializers) --------
  formatIso(p: any): string {
    const v = p?.value ?? p;
    return v ? String(v).replace('T', ' ').replace('Z', '') : '';
  }
  pct(n?: number | null, digits = 2): string {
    return n == null ? '' : `${Number(n).toFixed(digits)}%`;
  }
  timesuffix(n?: number | null, suffix = 'm'): string {
    return n == null ? '' : `${Number(n)}${suffix}`;
  }
  findGate(data: any, gateKey: string) {
    return data?.explain?.gates?.find((g: any) => g.gate === gateKey);
  }
  gatePassGetter(gateKey: string) {
    return (p: ValueGetterParams) =>
      this.findGate(p.data, gateKey)?.pass ?? null;
  }
  scoreGetter(key: string) {
    return (p: ValueGetterParams) =>
      p.data?.[key] ??
      p.data?.explain?.scores?.find((s: any) => s.key === key)?.value ??
      null;
  }
  magnitudeGetter(metric: string) {
    return (p: ValueGetterParams) => {
      const m = p.data?.explain?.magnitude_checks?.find(
        (x: any) => x.metric === metric
      );
      return m ? m.value_pct : null;
    };
  }
  ngOnInit(): void {
    // do NOT auto-run messages or API here; we run them when Execute is clicked
    if (this.messages?.length) {
      this.currentIndex = 0;
      this.currentText = this.messages[0];
    }
  }

  private startProgressThenCallApi(payload: {
    start: string;
    end: string;
    params: Params;
    weights: Weights;
  }): void {
    const count = this.messages?.length ?? 0;

    this.isSubmitting = true;
    this.currentIndex = 0;
    this.currentText = this.messages[0] ?? '';

    if (count === 0) {
      this.postToApi(payload);
      return;
    }

    timer(0, 2500)
      .pipe(
        take(count + 1), // one extra tick so last message stays up 4s
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (i) => {
          if (i < count) {
            this.currentIndex = i;
            this.currentText = this.messages[i];
          } else {
            // 4s after the last message
            this.postToApi(payload);
          }
        },
      });
  }

  /** The actual API call (same behavior you had, just factored out) */
  private postToApi(payload: {
    start: string;
    end: string;
    params: Params;
    weights: Weights;
  }): void {
    this.http.post<ApiResponse>(this.apiUrl, payload).subscribe({
      next: (res) => {
        this.isSubmitting = false;
        this.snack.open(`${res.message} (${res.count} incidents)`, 'OK', {
          duration: 3000,
        });
        this.ref.close({ payload, response: res });
      },
      error: (err) => {
        this.isSubmitting = false;
        console.error(err);
        this.snack.open(
          'Failed to execute rule. See console for details.',
          'OK',
          {
            duration: 3500,
          }
        );
      },
    });
  }
  // ngOnInit(): void {
  //   // Change message every 3s, stop after the last one
  //   interval(7000)
  //     .pipe(takeUntil(this.destroy$))
  //     .subscribe((i) => {
  //       const next = i + 1; // because i starts at 0 after 3s
  //       if (next < this.messages.length) {
  //         this.currentIndex = next;
  //         this.currentText = this.messages[next];
  //       } else {
  //         this.destroy$.next();
  //         this.destroy$.complete();
  //         // If you want it to loop forever, replace the block above with:
  //         // this.currentIndex = (this.currentIndex + 1) % this.messages.length;
  //         // this.currentText = this.messages[this.currentIndex];
  //       }
  //     });
  // }

  finish() {
    // (unchanged validation and payload build)
    if (
      this.rangeForm.invalid ||
      this.winForm.invalid ||
      this.pctForm.invalid ||
      this.volForm.invalid ||
      this.otherForm.invalid ||
      this.wForm.invalid
    ) {
      this.snack.open('Please complete all required fields.', 'OK', {
        duration: 2500,
      });
      return;
    }

    const startIso = new Date(
      this.rangeForm.value.startLocal as string
    ).toISOString();
    const endJS = new Date(this.rangeForm.value.endLocal as string);
    endJS.setSeconds(59, 0);
    const endIso = endJS.toISOString();

    const params: Params = {
      window_minutes: Number(this.winForm.value.window_minutes),
      dump_window_minutes: Number(this.winForm.value.dump_window_minutes),
      pump_pct: Number(this.pctForm.value.pump_pct),
      dump_pct: Number(this.pctForm.value.dump_pct),
      vol_window: Number(this.volForm.value.vol_window),
      vol_mult: Number(this.volForm.value.vol_mult),
      min_bars: Number(this.otherForm.value.min_bars),
      resample_rule: String(this.otherForm.value.resample_rule),
    };
    const weights: Weights = {
      pump_strength: Number(this.wForm.value.pump_strength),
      dump_strength: Number(this.wForm.value.dump_strength),
      volume_strength: Number(this.wForm.value.volume_strength),
    };
    const payload = { start: startIso, end: endIso, params, weights };

    // ⬇️ instead of posting immediately, run the 4s/message sequence first
    this.startProgressThenCallApi(payload);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  // --- datetime helpers ---
  private pad(n: number) {
    return String(n).padStart(2, '0');
  }
  private toLocalInputValue(d: Date) {
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(
      d.getDate()
    )}T${this.pad(d.getHours())}:${this.pad(d.getMinutes())}`;
  }
  private localFromISO(iso?: string): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : this.toLocalInputValue(d);
  }
  private defaultStartLocal(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return this.toLocalInputValue(d);
  }
  private defaultEndLocal(): string {
    const d = new Date();
    d.setHours(23, 59, 59, 0);
    return this.toLocalInputValue(d);
  }

  // --- forms ---
  rangeForm = this.fb.group(
    {
      startLocal: [
        this.localFromISO(this.data.start) ?? this.defaultStartLocal(),
        [Validators.required],
      ],
      endLocal: [
        this.localFromISO(this.data.end) ?? this.defaultEndLocal(),
        [Validators.required],
      ],
    },
    { validators: [this.startBeforeEndValidator] }
  );

  winForm = this.fb.group({
    window_minutes: [
      this.data?.params?.window_minutes ?? 30,
      [Validators.required, Validators.min(1)],
    ],
    dump_window_minutes: [
      this.data?.params?.dump_window_minutes ?? 60,
      [Validators.required, Validators.min(1)],
    ],
  });

  pctForm = this.fb.group({
    pump_pct: [this.data?.params?.pump_pct ?? 22.0, [Validators.required]],
    dump_pct: [this.data?.params?.dump_pct ?? 16.0, [Validators.required]],
  });

  volForm = this.fb.group({
    vol_window: [
      this.data?.params?.vol_window ?? 30,
      [Validators.required, Validators.min(1)],
    ],
    vol_mult: [
      this.data?.params?.vol_mult ?? 3.0,
      [Validators.required, Validators.min(0)],
    ],
  });

  otherForm = this.fb.group({
    min_bars: [
      this.data?.params?.min_bars ?? 15,
      [Validators.required, Validators.min(1)],
    ],
    resample_rule: [
      this.data?.params?.resample_rule ?? '1min',
      [Validators.required],
    ],
  });

  // keep step valid while typing; sum is shown on Review
  wForm = this.fb.group({
    pump_strength: [
      this.data?.weights?.pump_strength ?? 0.45,
      [Validators.required, Validators.min(0), Validators.max(1)],
    ],
    dump_strength: [
      this.data?.weights?.dump_strength ?? 0.45,
      [Validators.required, Validators.min(0), Validators.max(1)],
    ],
    volume_strength: [
      this.data?.weights?.volume_strength ?? 0.1,
      [Validators.required, Validators.min(0), Validators.max(1)],
    ],
  });

  get weightSum(): number {
    const w = this.wForm.value as Weights;
    return (
      Number(w.pump_strength || 0) +
      Number(w.dump_strength || 0) +
      Number(w.volume_strength || 0)
    );
  }

  close() {
    this.ref.close();
  }
  // --- Validators ---
  startBeforeEndValidator(group: AbstractControl): ValidationErrors | null {
    const s = group.get('startLocal')?.value;
    const e = group.get('endLocal')?.value;
    if (!s || !e) return null;
    return new Date(s) <= new Date(e) ? null : { rangeInvalid: true };
  }
}
