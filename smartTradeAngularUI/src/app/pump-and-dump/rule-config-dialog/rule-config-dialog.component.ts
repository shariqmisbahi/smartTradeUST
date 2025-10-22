import { Component, inject } from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
} from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { RuleEngineService } from './../../services/rule-engine.service';
import { ManualRequest } from '../rule-engine.models';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-rule-config-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    CommonModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Configure Pump & Dump Rules</h2>

    <mat-dialog-content [formGroup]="form" class="content-grid">
      <section class="section">
        <h3>Time Window</h3>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Start (ISO)</mat-label>
            <input
              matInput
              formControlName="start"
              placeholder="e.g., 2025-08-13T00:00:00Z"
            />
            <mat-error *ngIf="form.get('start')?.invalid"
              >Start is required</mat-error
            >
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>End (ISO)</mat-label>
            <input
              matInput
              formControlName="end"
              placeholder="e.g., 2025-08-13T23:59:59Z"
            />
            <mat-error *ngIf="form.get('end')?.invalid"
              >End is required</mat-error
            >
          </mat-form-field>
        </div>
      </section>

      <section formGroupName="params" class="section">
        <h3>Params</h3>
        <div class="grid-3">
          <mat-form-field appearance="outline">
            <mat-label>Window Minutes</mat-label>
            <input matInput type="number" formControlName="window_minutes" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Dump Window Minutes</mat-label>
            <input
              matInput
              type="number"
              formControlName="dump_window_minutes"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Pump %</mat-label>
            <input
              matInput
              type="number"
              step="0.1"
              formControlName="pump_pct"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Dump %</mat-label>
            <input
              matInput
              type="number"
              step="0.1"
              formControlName="dump_pct"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Vol Window</mat-label>
            <input matInput type="number" formControlName="vol_window" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Vol Mult</mat-label>
            <input
              matInput
              type="number"
              step="0.1"
              formControlName="vol_mult"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Min Bars</mat-label>
            <input matInput type="number" formControlName="min_bars" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="span-2">
            <mat-label>Resample Rule</mat-label>
            <mat-select formControlName="resample_rule">
              <mat-option value="1min">1min</mat-option>
              <mat-option value="5min">5min</mat-option>
              <mat-option value="15min">15min</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </section>

      <section formGroupName="weights" class="section">
        <h3>Weights</h3>
        <div class="grid-3">
          <mat-form-field appearance="outline">
            <mat-label>Pump Strength</mat-label>
            <input
              matInput
              type="number"
              step="0.01"
              formControlName="pump_strength"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Dump Strength</mat-label>
            <input
              matInput
              type="number"
              step="0.01"
              formControlName="dump_strength"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Volume Strength</mat-label>
            <input
              matInput
              type="number"
              step="0.01"
              formControlName="volume_strength"
            />
          </mat-form-field>
        </div>
      </section>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        color="primary"
        (click)="execute()"
        [disabled]="isSubmitting"
      >
        <ng-container *ngIf="!isSubmitting">Execute</ng-container>
        <mat-progress-spinner
          *ngIf="isSubmitting"
          mode="indeterminate"
          diameter="18"
        ></mat-progress-spinner>
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .content-grid {
        display: grid;
        gap: 16px;
        padding-top: 4px;
      }
      .section {
        background: #fafafa;
        border-radius: 12px;
        padding: 12px;
      }
      .row {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr 1fr;
      }
      .grid-3 {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(3, 1fr);
      }
      .span-2 {
        grid-column: span 2;
      }
      mat-dialog-content {
        max-height: 70vh;
      }
    `,
  ],
})
export class RuleConfigDialogComponent {
  private fb = inject(FormBuilder);
  private svc = inject(RuleEngineService);
  private snack = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<RuleConfigDialogComponent>);

  form: FormGroup = this.fb.group({
    start: [this.defaultStartISO(), Validators.required],
    end: [this.defaultEndISO(), Validators.required],
    params: this.fb.group({
      window_minutes: [30, [Validators.required, Validators.min(1)]],
      dump_window_minutes: [60, [Validators.required, Validators.min(1)]],
      pump_pct: [22.0, [Validators.required, Validators.min(0)]],
      dump_pct: [16.0, [Validators.required, Validators.min(0)]],
      vol_window: [30, [Validators.required, Validators.min(1)]],
      vol_mult: [3.0, [Validators.required, Validators.min(0)]],
      min_bars: [15, [Validators.required, Validators.min(1)]],
      resample_rule: ['1min', Validators.required],
    }),
    weights: this.fb.group({
      pump_strength: [
        0.45,
        [Validators.required, Validators.min(0), Validators.max(1)],
      ],
      dump_strength: [
        0.45,
        [Validators.required, Validators.min(0), Validators.max(1)],
      ],
      volume_strength: [
        0.1,
        [Validators.required, Validators.min(0), Validators.max(1)],
      ],
    }),
  });

  isSubmitting = false;

  execute() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.snack.open('Please fill all required fields correctly.', 'Close', {
        duration: 3000,
      });
      return;
    }
    const body = this.form.value as ManualRequest;
    this.isSubmitting = true;

    this.svc.runManual(body).subscribe({
      next: (resp) => {
        this.isSubmitting = false;
        this.snack.open(`Executed: ${resp.count} incident(s)`, 'Close', {
          duration: 3500,
        });
        this.dialogRef.close(resp);
      },
      error: (err) => {
        this.isSubmitting = false;
        const msg = err?.error?.detail || err?.message || 'Execution failed';
        this.snack.open(msg, 'Close', { duration: 4500 });
      },
    });
  }

  private defaultEndISO(): string {
    return new Date().toISOString();
  }
  private defaultStartISO(): string {
    return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // last 6 hours
  }
}
