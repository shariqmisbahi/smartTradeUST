// src/app/models/pumpdump.models.ts
export interface ApiPnDResponse {
  readonly count: number | null;
  readonly message: string;
  readonly folder?: string;
  readonly latest_parquet?: string;
  readonly total_rows?: number;
  readonly pump_and_dump_count?: number;
  readonly returned?: number;
  readonly csv_path?: string;
  readonly parquet_path?: string;
  results: PumpDumpRow[];
}

export interface PumpDumpRow {
  readonly alert_id: string;
  readonly report_short_name: string;
  readonly security_type: string;
  readonly security_name: string;
  readonly brokerage: string;
  readonly alert_type_category: string;
  readonly alert_type_description: string;
  readonly comments: string | null;
  readonly exchange_id: string;
  readonly message_type: string;
  readonly date: string; // e.g. "2025-08-23"
  readonly time: string; // e.g. "15:27:20"
  readonly order_id: string;
  readonly trade_id: string;
  readonly market_side: 'BUY' | 'SELL';
  readonly price: number | null;
  readonly total_volume: number | null;
  readonly value: number | null;
  readonly account: string;
  readonly account_type: string;
  readonly broker: string;
  readonly trader: string;
  readonly order_type: string;
  readonly executions_instructions: string;
  readonly order_received_date: string;
  readonly order_received_time: string;
  readonly order_code: string;
  readonly amend_received_datetime: string | null;
  readonly cancel_reason: string | null;
}
