// src/app/app.component.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LeftNavComponent } from './left-nav/left-nav.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, LeftNavComponent],
  template: `
    <div class="app-shell">
      <app-left-nav></app-left-nav>
      <main class="app-main">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [
    `
      .app-shell {
        display: flex;
        min-height: 100dvh;
        background: #f8fafc;
      }
      .app-main {
        flex: 1;
        min-width: 0;
        padding: 16px;
      }
    `,
  ],
})
export class AppComponent {}
