// src/app/pump-and-dumpV2/explain-dialog-ml/explain-dialog-ml.component.ts
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

type MaybeNum = number | string | boolean | null | undefined;

@Component({
  selector: 'app-explain-dialog-ml',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './explain-dialog-ml.component.html',
  styleUrls: ['../explain-dialog-ml/explain-dialog-ml.component.scss'], // reuse your existing styles
})
export class ExplainDialogMlComponent implements OnInit {
  private readonly data = inject(MAT_DIALOG_DATA) as {
    parent: any;
    explanations?: Explanation[];
  };
  private readonly dialogRef = inject(MatDialogRef<ExplainDialogMlComponent>);

  parent: any = {};
  exps: Explanation[] = [];

  /** Keys for a compact “Key Scores” summary at the top */
  scoreFields = [
    { key: 'final_ai_score', label: 'Final AI Score' },
    { key: 'rf_score', label: 'Random Forest Score' },
    { key: 'isolation_forest_anomaly', label: 'Isolation Forest (Anomaly)' },
    { key: 'ensemble_score', label: 'Ensemble Score' },
  ];

  ngOnInit(): void {
    this.parent = this.data?.parent ?? {};
    const fromData = Array.isArray(this.data?.explanations)
      ? this.data!.explanations!
      : null;

    const fromParent =
      (Array.isArray(this.parent?.ml_explanations) &&
        this.parent.ml_explanations) ||
      (Array.isArray(this.parent?.explanations) && this.parent.explanations) ||
      [];

    // Source explanations (may be in "signal/why" schema)
    const raw = (fromData ?? fromParent) as any[];

    // Normalize to Explanation shape expected by the template
    this.exps = (raw ?? []).map((r) => {
      const criterion = r?.criterion ?? r?.signal ?? '';
      const meaning =
        r?.meaning ?? r?.why ?? this.humanLabelForSignal(criterion);

      return {
        criterion,
        meaning,
        value: r?.value ?? null,
        threshold: r?.threshold ?? null,
        result: r?.result ?? null,
        weight: r?.weight ?? null,
        score: r?.score ?? null,
      } as Explanation;
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  // -------------- Helpers --------------
  up = (s: string | null | undefined) => (s ?? '').toString().toUpperCase();
  trackByCriterion = (_i: number, e: Explanation) => e?.criterion ?? _i;
  trackByCrit = (i: number, e: Explanation) => e?.criterion ?? i;
  trackByScore = (_i: number, s: { key: string; label: string }) => s.key;

  num(v: MaybeNum, d = 3): string {
    const n = Number(v);
    return isFinite(n) ? n.toFixed(d) : (v ?? '').toString();
  }
  pct(v: MaybeNum): string {
    const n = Number(v);
    return isFinite(n) ? `${n.toFixed(2)}%` : (v ?? '').toString();
    // Note: use if your values are in [0,100]; if in [0,1], multiply before showing.
  }

  tooltip(e: Explanation): string {
    return e?.meaning ? `${e.meaning}` : '';
  }

  /** Get the explanation object for a given signal key. */
  getExp(key: string): Explanation | undefined {
    const k = key.toLowerCase();
    return this.exps.find(
      (e) => (e?.criterion ?? '').toString().toLowerCase() === k
    );
  }
  getVal(key: string): string {
    const e = this.getExp(key);
    return e?.value != null ? this.num(e.value, 3) : '—';
  }
  getThr(key: string): string {
    const e = this.getExp(key);
    return e?.threshold != null ? this.num(e.threshold, 3) : '—';
  }
  getStatus(key: string): 'PASS' | 'FAIL' | '—' {
    const e = this.getExp(key);
    if (e?.result === false) return 'FAIL';
    if (e?.result === true || e?.result == null) return 'PASS';
    return '—';
  }

  // Add this helper inside the class:
  private humanLabelForSignal(sig: string): string {
    const s = (sig || '').toLowerCase();
    switch (s) {
      case 'final_ai_score':
        return 'Overall AI Score';
      case 'volume_surge':
        return 'Volume Surge vs Baseline';
      case 'price_dislocation_z':
        return 'Price Dislocation (z-score)';
      case 'time_gap_burst':
        return 'Trade Burstiness (time gaps)';
      case 'impact_est':
        return 'Estimated Market Impact';
      case 'rf_score':
        return 'Random Forest Score';
      case 'isolation_forest_anomaly':
        return 'Isolation Forest (Anomaly)';
      case 'ensemble_score':
        return 'Ensemble Consensus Score';
      case 'driver:time_gap':
        return 'Driver: Time Gap';
      case 'driver:volume':
        return 'Driver: Volume';
      default:
        return sig || 'Signal';
    }
  }

  /** Natural-language, risk-analyst style explanation for each criterion. */
  layman(e: Explanation): string {
    const c = (e.criterion ?? '').toString().toLowerCase();

    // ---------- ML signals (from your JSON) ----------
    // final_ai_score / volume_surge / price_dislocation_z / time_gap_burst / impact_est
    // rf_score / isolation_forest_anomaly / ensemble_score / driver:*  :contentReference[oaicite:3]{index=3}
    switch (c) {
      case 'final_ai_score':
        return `Overall confidence from the ML ensemble that this alert reflects suspicious behavior. 
        Observed ≈ ${this.num(e.value)} vs threshold ${this.num(
          e.threshold
        )} — higher implies stronger suspicion.`;
      case 'volume_surge':
        return `Was trading unusually busy relative to its normal baseline? A high multiple indicates a spike in participation. 
        Observed ≈ ${this.num(e.value)}; threshold ${this.num(
          e.threshold
        )} indicates what we consider unusual.`;
      case 'price_dislocation_z':
        return `How extreme the price move is versus recent history (z-score). 
        Observed ≈ ${this.num(e.value)}; values above ${this.num(
          e.threshold
        )} suggest sharp, atypical price shifts.`;
      case 'time_gap_burst':
        return `Are trades clustered tightly in time (burstiness)? 
        Observed ≈ ${this.num(e.value)} with threshold ${this.num(
          e.threshold
        )} — tighter clusters can indicate coordinated activity.`;
      case 'impact_est':
        return `Estimated market impact (|return| × volume) over a short window. 
        Observed ≈ ${this.num(e.value)} vs ${this.num(
          e.threshold
        )} — higher impact means trades likely moved the market.`;
      case 'rf_score':
        return `Supervised Random Forest model’s probability-like score for manipulation (trained on labeled patterns). 
        Higher is more suspicious. Observed ≈ ${this.num(e.value)}.`;
      case 'isolation_forest_anomaly':
        return `Unsupervised anomaly score — how rare this pattern looks compared to peers. 
        Observed ≈ ${this.num(e.value)} (threshold ${this.num(
          e.threshold
        )}). Higher indicates greater anomaly.`;
      case 'ensemble_score':
        return `Consensus score blending supervised (RF) and unsupervised (IF) views for robustness. 
        Observed ≈ ${this.num(e.value)}.`;
      case 'driver:time_gap':
        return `“Time gap/burstiness” contributed notably to the model’s decision (important driver for this alert).`;
      case 'driver:volume':
        return `“Volume surge” was a key driver — elevated participation influenced the decision.`;

      // ---------- Rule engine criteria you used in the classic dialog :contentReference[oaicite:4]{index=4}:contentReference[oaicite:5]{index=5} ----------
      case 'pump_vs_dump_increase_pct':
        return `How big the run-up was before the fall. We saw about ${this.pct(
          e.value
        )} vs a minimum of ${this.pct(
          e.threshold
        )} to consider it a real “pump”.`;
      case 'drop_pct_from_pump':
        return `How much price fell after the spike. A drop beyond ${this.pct(
          e.threshold
        )} supports the “dump”. Observed ≈ ${this.pct(e.value)}.`;
      case 'volume_uplift_multiple':
        return `Trading during the spike vs typical — about ${this.num(
          e.value,
          3
        )}× the usual. We look for ≥ ${this.num(e.threshold, 0)}×.`;
      case 'time_window_total_minutes':
        return `Duration of the pattern from pump to dump — ~${this.num(
          e.value,
          0
        )} minutes (must be within ${this.num(e.threshold, 0)} minutes).`;
      case 'min_bars_proxy_minutes':
        return `Data sufficiency check — ~${this.num(
          e.value,
          0
        )} minutes between legs; requires ≥ ${this.num(e.threshold, 0)}.`;
      case 'phase_order_ok':
        return `Event order sanity — pump before dump. This check ${
          e.result === false ? 'failed' : 'passed'
        } for this alert.`;

      default:
        // Fallback keeps everything understandable
        const val =
          e.value !== null && e.value !== undefined
            ? `Observed ≈ ${this.num(e.value)}`
            : '';
        const thr =
          e.threshold !== null && e.threshold !== undefined
            ? `, Threshold ${this.num(e.threshold)}`
            : '';
        return `${e.meaning ?? 'Check'} (${e.criterion ?? ''}). ${val}${thr}`;
    }
  }

  /** ---- Header field helpers with smart fallbacks ---- */

  // Return empty string by default so template can decide what to render
  getField(obj: any, candidates: string[], fallback: string = ''): string {
    for (const k of candidates) {
      const v = obj?.[k];
      if (v !== null && v !== undefined && `${v}`.trim() !== '') return `${v}`;
    }
    return fallback;
  }

  private isBlank(s?: string): boolean {
    return !s || s.trim() === '' || s === '—';
  }
  secName(): string {
    return this.getField(this.parent, [
      'security_name',
      'security',
      'name',
      'symbol',
      'ticker',
      'security_id',
    ]);
  }

  secType(): string {
    return this.getField(this.parent, ['security_type', 'asset_type', 'type']);
  }

  titleMain(): string {
    const name = this.secName();
    if (!this.isBlank(name)) return name;

    // fallback to something meaningful
    const id = this.getField(this.parent, ['alert_id', 'id']);
    if (!this.isBlank(id)) return `Alert ${id}`;
    return 'Alert';
  }

  titleType(): string {
    const t = this.secType();
    return this.isBlank(t) ? '' : t;
  }

  brokerage(): string {
    return this.getField(this.parent, ['brokerage', 'broker', 'broker_name']);
  }

  rubricScore(): string {
    // prefer parent.rubric_score, else use final_ai_score value as a proxy if present
    const p = this.getField(this.parent, ['rubric_score'], '');
    if (p !== '') return p;

    const e = this.getExp('final_ai_score');
    if (e?.value != null && e.value !== '') return this.num(e.value, 3);
    return '—';
  }

  riskBand(): string {
    return this.getField(this.parent, ['risk_band', 'risk', 'band']);
  }

  systemDecision(): string {
    // prefer explicit decision, else map risk band if available
    const dec = this.getField(this.parent, ['decision'], '');
    if (dec !== '') return dec;

    const rb = this.riskBand();
    return rb !== '—' ? rb : '—';
  }
}
