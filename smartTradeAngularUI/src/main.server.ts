import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http'; // 👈
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { config } from './app/app.config.server';

export default () =>
  bootstrapApplication(AppComponent, {
    providers: [
      provideRouter(routes),
      provideHttpClient(), // 👈 server too
      ...(config?.providers ?? []),
    ],
  });
