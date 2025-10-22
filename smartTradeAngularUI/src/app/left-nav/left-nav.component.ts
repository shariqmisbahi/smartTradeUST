import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NAV_LINKS } from '../nav-links';
import { CommonModule, NgFor, NgIf } from '@angular/common';

@Component({
  selector: 'app-left-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, NgFor, NgIf],
  templateUrl: './left-nav.component.html',
  styleUrls: ['./left-nav.component.css'],
})
export class LeftNavComponent {
  links = NAV_LINKS;
}
