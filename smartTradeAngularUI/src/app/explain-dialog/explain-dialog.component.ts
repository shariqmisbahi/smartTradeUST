import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface Explanation {
  criterion: string;
  meaning: string;
  value?: number | string | boolean | null;
  threshold?: number | string | boolean | null;
  result?: boolean | null;
  weight?: number | null;
  score?: number | null;
}

@Component({
  selector: 'app-explain-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: '../explain-dialog/explain-dialog.component.html',
  styleUrls: ['../explain-dialog/explain-dialog.component.scss'],
})
export class ExplainDialogComponent implements OnInit {
  private readonly data = inject(MAT_DIALOG_DATA) as {
    parent: any;
    explanations: Explanation[];
  };
  private readonly dialogRef = inject(MatDialogRef<ExplainDialogComponent>);

  parent: any = {};
  exps: Explanation[] = [];

  trackByCriterion = (_index: number, item: Explanation) =>
    item?.criterion ?? _index;

  ngOnInit(): void {
    this.parent = this.data?.parent ?? {};
    this.exps = Array.isArray(this.data?.explanations)
      ? this.data.explanations
      : [];
  }

  close(): void {
    this.dialogRef.close();
  }

  tooltip(e: Explanation): string {
    const parts: string[] = [];
    if (e.meaning) parts.push(e.meaning);
    return parts.join(' • ');
  }

  up(s: string | null | undefined) {
    return (s ?? '').toString().toUpperCase();
  }

  trackByCrit = (i: number, e: Explanation) => e?.criterion ?? i;

  // Format helpers
  pct = (v: any) => (v == null || isNaN(+v) ? '' : `${Number(v).toFixed(2)}%`);
  num = (v: any, d = 3) => (v == null || isNaN(+v) ? '' : Number(v).toFixed(d));

  /** Layman’s explanation for each criterion (numbers inserted). */
  layman(e: Explanation): string {
    const c = (e.criterion ?? '').toString().toLowerCase();
    switch (c) {
      case 'pump_vs_dump_increase_pct':
        // value is a percent
        return `How big the spike was compared to the later dump price — about ${this.pct(
          e.value
        )}. 
              We expect at least ${this.pct(
                e.threshold
              )} to call it a true “pump”.`;

      case 'drop_pct_from_pump':
        return `How much price fell after the spike — about ${this.pct(
          e.value
        )}. 
              A fall beyond ${this.pct(
                e.threshold
              )} supports that a real dump happened.`;

      case 'volume_uplift_multiple':
        return `How busy trading was during the spike versus typical activity — about ${this.num(
          e.value,
          3
        )}× the usual median volume. 
              We look for at least ${this.num(
                e.threshold,
                0
              )}×; below that is weaker evidence.`;

      case 'time_window_total_minutes':
        return `How quickly the full pattern played out — around ${this.num(
          e.value,
          0
        )} minutes from pump to dump. 
              It must be within ${this.num(e.threshold, 0)} minutes to count.`;

      case 'min_bars_proxy_minutes':
        return `Did we have enough bars between legs? We saw ~${this.num(
          e.value,
          0
        )} minutes; 
              the rule needs at least ${this.num(e.threshold, 0)} minutes.`;

      case 'phase_order_ok':
        return `Did the order of events make sense? Buy activity (pump) happened before sell activity (dump) — this check ${
          e.result === false ? 'failed' : 'passed'
        }.`;

      default:
        // generic fall-back that reuses the given meaning
        const val = e.value != null ? ` value=${e.value}` : '';
        const thr = e.threshold != null ? `, threshold=${e.threshold}` : '';
        return `${e.meaning ?? 'Check'} (${(
          e.criterion ?? ''
        ).toString()}):${val}${thr}.`;
    }
  }
}
