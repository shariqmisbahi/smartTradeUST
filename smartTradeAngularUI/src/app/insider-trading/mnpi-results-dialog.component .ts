import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { MatButtonModule } from '@angular/material/button';
import { Component, inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ColDef, GetRowIdFunc, RowClickedEvent } from 'ag-grid-community';

type EmailItem = {
  id: string;
  name: string;
  path?: string;
  subject: string;
  from: string;
  date?: string;
  snippet: string;
  body: string;
};

@Component({
  selector: 'app-mnpi-results-dialog',
  standalone: true,
  imports: [CommonModule, AgGridAngular, MatButtonModule],
  template: `
    <h2 class="heading" style="margin-left: 10px">
      {{ rows.length || 0 }} Rows
    </h2>

    <div class="grid-wrap">
      <ag-grid-angular
        [theme]="'legacy'"
        class="ag-theme-alpine compact-grid trades-grid"
        style="width: 110%; height: 65vh; overflow-x: auto"
        [rowData]="rows"
        [columnDefs]="cols"
        [defaultColDef]="{ resizable: true, sortable: true, filter: true }"
        [pagination]="true"
        [paginationPageSize]="20"
        [getRowId]="getRowId"
        (rowClicked)="onEmailRowClicked($event)"
      ></ag-grid-angular>
    </div>

    <!-- EMAIL VIEWER PANEL -->
    <!-- <div class="email-panel" style="margin-top:16px">
      <h3 style="margin:0 0 8px">Browse & Scan Employees Emails</h3>

      <div
        class="picker-row"
        style="display:flex; gap:12px; align-items:center;"
      >
        <input
          type="file"
          (change)="onPickFolder($event)"
          webkitdirectory
          directory
          multiple
        />
        <span *ngIf="emailLoading">Parsing emails… ({{ emails.length }})</span>
        <span *ngIf="!emailLoading && emails.length"
          >Loaded {{ emails.length }} emails</span
        >
      </div>

      <div
        *ngIf="emails.length"
        class="email-grids"
        style="margin-top:10px; display:grid; grid-template-columns: 1fr; gap:10px;"
      >
        <ag-grid-angular
          [theme]="'legacy'"
          class="ag-theme-alpine compact-grid"
          style="width: 110%; height: 30vh; overflow-x: auto"
          [rowData]="emails"
          [columnDefs]="emailCols"
          [defaultColDef]="{ resizable: true, sortable: true, filter: true }"
          [pagination]="true"
          [paginationPageSize]="20"
          (rowClicked)="onEmailClicked($event.data)"
        ></ag-grid-angular>

        <div
          *ngIf="selectedEmail"
          class="email-preview"
          style="border:1px solid #ddd; border-radius:8px; padding:10px;"
        >
          <div
            style="display:flex; justify-content:space-between; align-items:center;"
          >
            <h4 style="margin:0;">
              {{ selectedEmail.subject || selectedEmail.name }}
            </h4>
            <small>{{ selectedEmail.date }}</small>
          </div>
          <div style="margin:6px 0; color:#444;">
            <strong>From:</strong> {{ selectedEmail.from || '—' }}
          </div>
          <pre
            style="white-space:pre-wrap; margin:0; max-height:35vh; overflow:auto;"
            [textContent]="selectedEmail.body || selectedEmail.snippet"
          ></pre>
        </div>
      </div>
    </div> -->

    <div class="button-row" style="justify-content: flex-end; margin-top: 10px">
      <button mat-raised-button (click)="close()">Close</button>
    </div>
  `,
})
export class MnpiResultsDialogComponent {
  // Inject first
  private readonly data = inject(MAT_DIALOG_DATA) as {
    rows: any[];
    cols: ColDef[];
  };
  private readonly ref = inject(MatDialogRef<MnpiResultsDialogComponent>);

  // Then derive
  rows: any[] = this.data?.rows ?? [];
  cols: ColDef[] = this.data?.cols ?? [];
  getRowId: GetRowIdFunc = (p) => p.data?.alert_id ?? p.data?.order_id;

  // Email viewer state
  emails: EmailItem[] = [];
  selectedEmail: EmailItem | null = null;

  emailLoading = false;

  // Small grid for emails
  emailCols: ColDef<EmailItem>[] = [
    { headerName: 'Subject', field: 'subject', flex: 2 },
    { headerName: 'From', field: 'from', flex: 1 },
    { headerName: 'Date', field: 'date', width: 180 },
    { headerName: 'File', field: 'name', flex: 1, tooltipField: 'path' },
    { headerName: 'Snippet', field: 'snippet', flex: 2 },
  ];

  // ===== Folder picker handler =====
  async onPickFolder(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const files = input.files;
    this.emails = [];
    this.selectedEmail = null;

    if (!files || files.length === 0) return;

    this.emailLoading = true;
    try {
      // Read supported files
      const supported = Array.from(files).filter((f) =>
        /\.(eml|txt|json)$/i.test(f.name)
      );

      for (const file of supported) {
        const text = await this.readFileAsText(file);
        const parsed = this.parseEmailFile(file.name, text);
        // If JSON may return multiple
        if (Array.isArray(parsed)) {
          for (const p of parsed) this.emails.push(p);
        } else if (parsed) {
          this.emails.push(parsed);
        }
      }

      // Simple sort by date desc if present
      this.emails.sort(
        (a, b) =>
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      );
    } finally {
      this.emailLoading = false;
    }
  }

  onEmailClicked(email?: EmailItem) {
    if (!email) return;
    this.selectedEmail = email;
  }

  onEmailRowClicked(ev: RowClickedEvent<EmailItem>) {
    if (ev && ev.data) {
      this.selectedEmail = ev.data; // now always EmailItem, not undefined
    }
  }

  // ===== Utilities =====
  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error);
      fr.onload = () => resolve(String(fr.result || ''));
      fr.readAsText(file);
    });
  }

  private parseEmailFile(
    name: string,
    content: string
  ): EmailItem | EmailItem[] | null {
    if (/\.json$/i.test(name)) {
      // Accept either an array of emails or a single email object
      try {
        const obj = JSON.parse(content);
        const list = Array.isArray(obj) ? obj : [obj];
        const normalized = list
          .map((o: any, idx: number) =>
            this.normalizeEmailFromJson(o, `${name}#${idx}`)
          )
          .filter(Boolean);
        return normalized as EmailItem[];
      } catch {
        return null;
      }
    }

    // Naive .eml/.txt parse: split headers and body on first blank line
    const parts = content.split(/\r?\n\r?\n/);
    const headersRaw = parts[0] || '';
    const body = parts.slice(1).join('\n\n') || content;

    const headers: Record<string, string> = {};
    for (const line of headersRaw.split(/\r?\n/)) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) headers[m[1].toLowerCase()] = m[2];
    }

    const subject =
      headers['subject'] || this.firstLine(body) || '(no subject)';
    const from = headers['from'] || '';
    const date = headers['date'] || '';

    return {
      id: cryptoRandomId(),
      name,
      subject,
      from,
      date,
      snippet: this.snippet(body),
      body,
    };
  }

  private normalizeEmailFromJson(o: any, fallbackId: string): EmailItem | null {
    if (!o) return null;
    const subject = o.subject ?? o.title ?? '(no subject)';
    const from = o.from?.email ?? o.from?.name ?? o.from ?? '';
    const date = o.date ?? o.sentAt ?? o.internalDate ?? '';
    const body = o.body ?? o.textBody ?? o.snippet ?? '';
    return {
      id: String(o.id ?? fallbackId),
      name: String(o.filename ?? o.name ?? 'email.json'),
      path: o.path,
      subject,
      from,
      date: String(date || ''),
      snippet: this.snippet(o.snippet ?? body),
      body: String(body || ''),
    };
  }

  private firstLine(s: string): string {
    return (s.split(/\r?\n/)[0] || '').trim();
  }

  private snippet(s: string): string {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .slice(0, 180);
  }

  close() {
    this.ref.close();
  }
}

// Small helper for IDs without pulling extra libs
function cryptoRandomId(): string {
  // Best-effort in browser
  try {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}
