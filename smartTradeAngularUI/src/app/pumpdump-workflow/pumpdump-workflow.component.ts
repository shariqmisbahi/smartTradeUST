import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StepSectionComponent } from '../step-section/step-section.component';

// TODO: Import your actual grid components instead of placeholders.
//import { RuleGridComponent } from '../rule-grid/rule-grid.component';
import { RuleDrivenCalibrationComponent } from '../rule-driven-calibaration/rule-driven-calibration.component';
import { MLDrivenCalibrationComponent } from '../ml-driven-calibration/ml-driven-calibration.component';
import { FinalVerificationComponent } from '../final-verification/final-verification.component';
import { IconsModule } from '../icons.module';

@Component({
  selector: 'app-pumpdump-workflow',
  templateUrl: './pumpdump-workflow.component.html',
  styleUrls: ['./pumpdump-workflow.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    StepSectionComponent,
    FinalVerificationComponent,
    MLDrivenCalibrationComponent,
    RuleDrivenCalibrationComponent,
    IconsModule,
  ],
})
export class PumpdumpWorkflowComponent {
  // 1..3

  step = signal(1);
  // completion flags for steps [1,2,3]
  done = signal<[boolean, boolean, boolean]>([false, false, false]);

  onComplete(which: 1 | 2 | 3) {
    const next = [...this.done()] as [boolean, boolean, boolean];
    next[which - 1] = true;
    this.done.set(next);
    this.step.set(Math.min(which + 1, 3));
  }
}
