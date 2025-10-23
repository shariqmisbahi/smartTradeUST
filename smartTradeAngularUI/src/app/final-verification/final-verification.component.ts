import { Component, inject, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { VerificationDialogComponent } from '../pump-and-dumpV2/verification-dialog/verification-dialog.component';
import { apiUrl } from '../../app/config/api.config';

@Component({
  selector: 'app-final-verification',
  standalone: true,
  templateUrl: './final-verification.component.html',
  styleUrls: ['./final-verification.component.css'],
  imports: [
    CommonModule,
    FormsModule,
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
export class FinalVerificationComponent implements OnInit, OnDestroy {
  verifying = false;
  private dialog = inject(MatDialog);
  @Input() showAction2 = false;

  ngOnInit(): void {
    console.log('FinalVerificationComponent initialized');
  }

  verifyWithInternalData() {
    this.verifying = true;
    const ref = this.dialog.open(VerificationDialogComponent, {
      width: '775px',
      disableClose: true,
      data: {
        apiUrl: apiUrl('reports/template'),
      },
    });
    ref.afterClosed().subscribe(() => (this.verifying = false));
  }

  ngOnDestroy() {
    console.log('FinalVerificationComponent destroyed');
  }
}
