import { environment } from '../../environments/environment';

/**
 * API Configuration
 * Centralized API endpoint configuration for the application
 */
export class ApiConfig {
  private static readonly BASE_URL = environment.apiUrl;

  // Simulation endpoints
  static readonly SIMULATE_ALERTS = `${this.BASE_URL}/simulate/alerts`;
  static readonly SIMULATE_LATEST_PUMPDUMP = `${this.BASE_URL}/simulate/alerts/latest/pumpdump`;
  static readonly SIMULATE_LATEST_INSIDER = `${this.BASE_URL}/simulate/alerts/latest/insidertrading`;

  // Calibration endpoints
  static readonly PUMPDUMP_CALIBRATE = `${this.BASE_URL}/simulate/alerts/calibrate`;
  static readonly PUMPDUMP_ML_DETECT = `${this.BASE_URL}/pumpdumpml/detect`;
  static readonly INSIDER_REFINE = `${this.BASE_URL}/insidertrading/refine`;

  // Report endpoints
  static readonly REPORTS_TEMPLATE = `${this.BASE_URL}/reports/template`;
  static readonly REPORTS_ML_HIGH_RISK = `${this.BASE_URL}/reports/ml/high-risk.pdf`;

  /**
   * Get the base API URL
   */
  static getBaseUrl(): string {
    return this.BASE_URL;
  }

  /**
   * Build a full URL with query parameters
   * @param endpoint - The endpoint path
   * @param params - Query parameters
   */
  static buildUrl(endpoint: string, params?: Record<string, any>): string {
    const url = new URL(endpoint, this.BASE_URL);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }
}
