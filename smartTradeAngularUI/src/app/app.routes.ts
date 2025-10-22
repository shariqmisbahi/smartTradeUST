import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';

// import { PumpAndDumpComponent } from '../app/pump-and-dump/pump-and-dump.component';
// import { RealTimeMonitoringComponent } from '../app/real-time-monitoring/real-time-monitoring.component';
// import { DataIntegrationComponent } from '../app/data-integration/data-integration.component';
// import { ComplianceAssuranceComponent } from '../app/compliance-assurance/compliance-assurance.component';
// import { AdvancedAnalyticsComponent } from '../app/advanced-analytics/advanced-analytics.component';
// import { Home2Component } from '../app/home2/home2.component';
// import { WashTradeAlertsComponent } from '../app/wash-trade-alerts/wash-trade-alerts.component';
import { PumpandDumpV2Component } from '../app/pump-and-dumpV2/pump-and-dumpV2.component';
import { InsiderTradingComponent } from '../app/insider-trading/insider-trading.component';
import { PumpdumpWorkflowComponent } from './pumpdump-workflow/pumpdump-workflow.component';
export const routes: Routes = [
  { path: '', component: HomeComponent, pathMatch: 'full' },
  // Use the workflow wrapper for this route:
  {
    path: 'pump-and-dump',
    loadComponent: () =>
      import('./pumpdump-workflow/pumpdump-workflow.component').then(
        (m) => m.PumpdumpWorkflowComponent
      ),
  },
  {
    path: 'insider-trading',
    loadComponent: () =>
      import('../app/insider-trading/insider-trading.component').then(
        (m) => m.InsiderTradingComponent
      ),
  },
  {
    path: 'advanced-analytics',
    loadComponent: () =>
      import('../app/pump-and-dumpV2/pump-and-dumpV2.component').then(
        (m) => m.PumpandDumpV2Component
      ),
  },
  { path: '**', redirectTo: '' },
  //   // keep your existing pages here:
  //   {
  //     path: 'dashboard',
  //     loadComponent: () =>
  //       import('./reports/reports.component').then((m) => m.ReportsComponent),
  //   },
  //   {
  //     path: 'real-time-monitoring',
  //     loadComponent: () =>
  //       import('./real-time/real-time.component').then(
  //         (m) => m.RealTimeComponent
  //       ),
  //   },
  //   {
  //     path: 'wash-trade-alerts',
  //     loadComponent: () =>
  //       import('./wash/wash.component').then((m) => m.WashComponent),
  //   },
  //   {
  //     path: 'pump-and-dump2',
  //     loadComponent: () =>
  //       import('./layering/layering.component').then((m) => m.LayeringComponent),
  //   },
  //   {
  //     path: 'data-integration',
  //     loadComponent: () =>
  //       import('./spoofing/spoofing.component').then((m) => m.SpoofingComponent),
  //   },
  //   {
  //     path: 'compliance-assurance',
  //     loadComponent: () =>
  //       import('./churning/churning.component').then((m) => m.ChurningComponent),
  //   },
  //   {
  //     path: 'advanced-analytics',
  //     loadComponent: () =>
  //       import('./analytics/analytics.component').then(
  //         (m) => m.AnalyticsComponent
  //       ),
  //   },
];
