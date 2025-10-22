// src/app/rule-engine/rule-engine.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { PumpAndDumpComponent } from './pump-and-dump.component';
import { RuleConfigDialogComponent } from './rule-config-dialog/rule-config-dialog.component';

@NgModule({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    // Material
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    PumpAndDumpComponent,
    RuleConfigDialogComponent,
  ],
  exports: [PumpAndDumpComponent, RuleConfigDialogComponent],
})
export class RuleEngineModule {}
