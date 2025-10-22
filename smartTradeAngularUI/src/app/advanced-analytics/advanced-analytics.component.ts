import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridModule } from 'ag-grid-angular';
import { RouterLink } from '@angular/router';
import { NgChartsModule } from 'ng2-charts';

@Component({
  selector: 'app-advanced-analytics',
  standalone: true,
  imports: [NgChartsModule, CommonModule, FormsModule, AgGridModule],
  templateUrl: './advanced-analytics.component.html',
  styleUrls: ['./advanced-analytics.component.css'],
})
export class AdvancedAnalyticsComponent implements OnInit {
  totalFaults = 396577;

  faultLabels = [
    'Wash Trade',
    'Front Running',
    'Ramping',
    'Spoofing',
    'Churning',
    'Marking Open/Close',
  ];

  faultCounts = [
    19806, // Wash Trade
    9652, // Front Running
    97140, // Ramping
    48315, // Spoofing
    192360, // Churning
    29304, // Marking Open/Close
  ];

  pieChartData: any;
  barChartData: any;

  ngOnInit(): void {
    this.pieChartData = {
      labels: this.faultLabels,
      datasets: [
        {
          data: this.faultCounts,
          backgroundColor: [
            '#92bee2ff',
            '#9ce5a0ff',
            '#f1c98dff',
            '#eea5a4ff',
            '#e09cecff',
            '#f0dfabff',
          ],
        },
      ],
    };

    this.barChartData = {
      labels: this.faultLabels,
      datasets: [
        {
          label: 'Fault Type Count',
          data: this.faultCounts,
          backgroundColor: '#42A5F5',
        },
      ],
    };
  }
}
