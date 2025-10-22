// src/app/pump-and-dumpV2/verification-dialog/verification-dialog.component.ts
import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  Signal,
  computed,
  signal,
  inject,
} from '@angular/core';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpClientModule } from '@angular/common/http';
import {
  concatMap,
  EMPTY,
  Subscription,
  catchError,
  finalize,
  of,
  tap,
  timer, // ⬅️ added
  map, // ⬅️ added
} from 'rxjs';

import {
  InternalVerificationService,
  VerifyApiResult,
} from '../../services/internal-verification.service';

type StepState = 'pending' | 'running' | 'done' | 'error';

interface Step {
  id: 'auth' | 'login' | 'internal' | 'crm' | 'chat';
  label: string;
  state: StepState;
  run: () => ReturnType<VerificationDialogComponent['_simulate']>; // ⬅️ each step now uses exact timing
  error?: string;
}

export interface VerificationDialogData {
  apiUrl: string;
}

@Component({
  selector: 'app-verification-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    HttpClientModule,
  ],
  templateUrl: './verification-dialog.component.html',
  styleUrls: ['./verification-dialog.component.css'],
})
export class VerificationDialogComponent implements OnInit, OnDestroy {
  private svc = inject<InternalVerificationService>(
    InternalVerificationService
  );
  private ref = inject<MatDialogRef<VerificationDialogComponent>>(MatDialogRef);
  data = inject<VerificationDialogData>(MAT_DIALOG_DATA);

  // ⬇️ Each step runs for a fixed duration: 1s, 2s, 3s, 4s
  readonly steps = signal<Step[]>([
    {
      id: 'auth',
      label: 'Establishing secure connection',
      state: 'pending',
      run: () => this._simulate(1000),
    },
    {
      id: 'login',
      label: 'Login to APIs',
      state: 'pending',
      run: () => this._simulate(1000),
    },
    {
      id: 'internal',
      label: 'Accessing data sources',
      state: 'pending',
      run: () => this._simulate(2000),
    },
    {
      id: 'crm',
      label: 'Analyzing data sources',
      state: 'pending',
      run: () => this._simulate(3000),
    },
    {
      id: 'chat',
      label: 'Generating report',
      state: 'pending',
      run: () => this._simulate(4000),
    },
  ]);

  private sub?: Subscription;
  private _busy = signal(false);
  private _apiCalling = signal(false);
  private _apiDone = signal(false);
  private _hasError = signal(false);
  private _result?: VerifyApiResult;

  busy: Signal<boolean> = computed(() => this._busy());
  apiCalling: Signal<boolean> = computed(() => this._apiCalling());
  apiDone: Signal<boolean> = computed(() => this._apiDone());
  hasError: Signal<boolean> = computed(() => this._hasError());

  ngOnInit(): void {
    console.log('API URL:', this.data.apiUrl);
  }
  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Run a dummy step for exactly `ms` milliseconds */
  private _simulate(ms: number) {
    return timer(ms).pipe(map(() => void 0));
  }

  start(): void {
    this._busy.set(true);
    this._hasError.set(false);

    const run$ = of(null).pipe(
      concatMap(() => this._runStep('auth')),
      concatMap(() => this._runStep('login')),
      concatMap(() => this._runStep('internal')),
      concatMap(() => this._runStep('crm')),
      concatMap(() => this._runStep('chat')),
      tap(() => this._apiCalling.set(true)),
      concatMap(() => this.svc.callVerificationPdf$(this.data.apiUrl)),
      tap((res) => {
        this._result = res;
        this._apiDone.set(true);
      }),
      catchError(() => {
        this._hasError.set(true);
        return EMPTY;
      }),
      finalize(() => {
        this._apiCalling.set(false);
        this._busy.set(false);
      })
    );

    this.sub?.unsubscribe();
    this.sub = run$.subscribe();
  }

  private _runStep(id: Step['id']) {
    const list = this.steps();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return of(null);

    const step = {
      ...list[idx],
      state: 'running' as StepState,
      error: undefined,
    };
    this._patchStep(idx, step);

    return step.run().pipe(
      tap({
        next: () => this._patchStep(idx, { ...step, state: 'done' }),
        error: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'Failed';
          this._patchStep(idx, { ...step, state: 'error', error: msg });
          this._hasError.set(true);
        },
      }),
      catchError(() => EMPTY)
    );
  }

  private _patchStep(index: number, next: Step) {
    const arr = this.steps().slice();
    arr[index] = next;
    this.steps.set(arr);
  }

  openPdf(): void {
    if (!this._result) return;
    const url = URL.createObjectURL(this._result.blob);
    window.open(url, '_blank');
  }

  downloadPdf(): void {
    if (!this._result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(this._result.blob);
    a.download = this._result.filename || 'report.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  close(): void {
    this.ref.close(this._apiDone());
  }
}
