// src/app/icons.module.ts
import { NgModule } from '@angular/core';
import { AlertRow } from './pump-and-dumpV2/pump-and-dumpV2.component';
import {
  LucideAngularModule,
  LucideCircleAlert,
  TrendingUp,
  Shield,
  Clock,
  ArrowDown,
  ArrowUp,
  CircleAlert,
} from 'lucide-angular';

@NgModule({
  // Register only the icons you use
  imports: [
    LucideAngularModule.pick({
      LucideCircleAlert,
      TrendingUp,
      Shield,
      Clock,
      ArrowDown,
      ArrowUp,
      CircleAlert,
    }),
  ],
  // Re-export so components can use <lucide-icon>
  exports: [LucideAngularModule],
})
export class IconsModule {}
