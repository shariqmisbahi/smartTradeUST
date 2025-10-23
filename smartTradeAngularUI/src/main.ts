import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http'; // 👈
import {
  LucideAngularModule,
  Search,
  AlarmClock,
  Hammer,
  Database,
  Shield,
  TrendingUp,
  User,
  Settings,
  Target,
  Lock,
  Handshake,
  Package,
  SlidersHorizontal,
  TrendingDown,
  Receipt,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-angular';
import { importProvidersFrom } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(withFetch()),
    importProvidersFrom(
      LucideAngularModule.pick({
        Search,
        AlarmClock,
        Hammer,
        Database,
        Shield,
        TrendingUp,
        User,
        Settings,
        Target,
        Lock,
        Handshake,
        Package,
        SlidersHorizontal,
        TrendingDown,
        Receipt,
        Clock,
        ArrowDownLeft,
        ArrowUpRight,
        // Home page groups
      })
    ), // 👈 for HttpClient in standalone
  ],
});

// // src/main.ts
// import { bootstrapApplication } from '@angular/platform-browser';
// import { provideHttpClient } from '@angular/common/http';
// import { provideRouter } from '@angular/router';

// import { AppComponent } from './app/app.component'; // ✅ root entry point

// import { HomeComponent } from './app/home/home.component';

// import { PumpAndDumpComponent } from './app/pump-and-dump/pump-and-dump.component';
// import { RealTimeMonitoringComponent } from './app/real-time-monitoring/real-time-monitoring.component';
// import { DataIntegrationComponent } from './app/data-integration/data-integration.component';
// import { ComplianceAssuranceComponent } from './app/compliance-assurance/compliance-assurance.component';
// import { AdvancedAnalyticsComponent } from './app/advanced-analytics/advanced-analytics.component';
// import { InsiderTradingComponent } from './app/insider-trading/insider-trading.component';
// import { Home2Component } from './app/home2/home2.component';
// import { WashTradeAlertsComponent } from './app/wash-trade-alerts/wash-trade-alerts.component';
// import { PumpandDumpV2Component } from './app/pump-and-dumpV2/pump-and-dumpV2.component';
// import { provideAnimations } from '@angular/platform-browser/animations';
// import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
// // EITHER register *all* Enterprise features (quickest path):
// ModuleRegistry.registerModules([AllCommunityModule]);

// bootstrapApplication(AppComponent, {
//   providers: [
//     provideAnimations(),
//     provideHttpClient(),
//     provideRouter([
//       { path: '', component: HomeComponent }, // default landing page
//       { path: 'pump-and-dump2', component: PumpAndDumpComponent },
//       { path: 'wash-trade-alerts', component: WashTradeAlertsComponent },
//       { path: 'real-time-monitoring', component: RealTimeMonitoringComponent },
//       { path: 'data-integration', component: DataIntegrationComponent },
//       { path: 'compliance-assurance', component: ComplianceAssuranceComponent },
//       { path: 'advanced-analytics', component: AdvancedAnalyticsComponent },
//       { path: 'insider-trading', component: InsiderTradingComponent },
//       {
//         path: 'pump-and-dump',
//         component: PumpandDumpV2Component,
//       },
//       { path: 'app-home2', component: Home2Component },
//     ]),
//   ],
// });
