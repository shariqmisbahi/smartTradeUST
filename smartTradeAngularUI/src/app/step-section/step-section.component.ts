import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-step-section',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './step-section.component.html',
  styleUrls: ['./step-section.component.css'],
})
export class StepSectionComponent {
  @Input() index = 1;
  @Input() showIndex = true;
  @Input() title = '';
  @Input() subtitle = '';
  @Input() enabled = true;
  @Input() completeLabel = 'Mark Complete';
  @Input() completeDisabled = false;
  @Output() complete = new EventEmitter<void>();
}
