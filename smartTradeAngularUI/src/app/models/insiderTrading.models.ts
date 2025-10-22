// src/app/shared/models.ts
export interface InsiderTradingApiResponse {
  message: string;
  folder: string;
  latest_parquet: string;
  total_rows: number;
  pump_and_dump_count: number; // re-used for Insider Trading count
  returned: number;
  results: InsiderTradingRow[];
}

// Keep only the fields you want to display in the grid.
// You can add more later—these all exist in the sample file.
export interface InsiderTradingRow {
  alert_id: string;
  report_short_name: string;
  security_type: string;
  security_name: string;
  brokerage: string;
  alert_type_category: string;
  alert_type_description: string | null;
  comments: string | null;
  exchange_id: string;
  message_type: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm:ss"
  order_id: string;
  trade_id: string;
  market_side: 'BUY' | 'SELL';
  price: number;
  total_volume: number;
  value: number;
  account: string;
  account_type: string;
  broker: string;
  trader: string;
  order_type: string;
  executions_instructions: string;
  order_received_date: string;
  order_received_time: string;
  order_code: string;
  amend_received_datetime: string | null;
  cancel_reason: string | null;
}
