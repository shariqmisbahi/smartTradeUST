export interface PumpandDumpApiresponse {
  count: number;
  csv_path: string;
  csv_rows: number;
  results: PumpandDumpSecondGridData[];
  message: string;
  rule_nam: string;
}
export interface PumpandDumpSecondGridData {
  ticker: string;
  start_ts: string;
  peak_ts: string;
  end_ts: string;
  pump_return_pct: number;
  dump_return_pct: number;
  pump_volume_spike_mult: number;
  peak_volume: number;
  baseline_volume: number;
  pump_duration_min: number;
  dump_duration_min: number;
  confidence: number;
}

export interface Params {
  window_minutes: number;
  dump_window_minutes: number;
  pump_pct: number;
  dump_pct: number;
  vol_window: number;
  vol_mult: number;
  min_bars: number;
  resample_rule: string;
}
export interface Weights {
  pump_strength: number;
  dump_strength: number;
  volume_strength: number;
}
export interface ApiPnDResponse {
  count: number | null;
  message: string;
  folder: string;
  latest_parquet: string;
  total_rows: number;
  pump_and_dump_count: number;
  returned: number;
  results: PumpandDumpResult[];
}

export interface PumpDumpRow {
  alertId: string;
  reportShortName: string;
  securityType: string;
  securityName: string;
  brokerage: string;
  alertTypeCategory: string;
  alertTypeDescription: string;
  comments: string | null;
  exchangeId: string;
  messageType: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  orderId: string;
  tradeId: string;
  marketSide: 'BUY' | 'SELL';
  price: number | null;
  totalVolume: number | null;
  value: number | null;
  account: string;
  accountType: string;
  broker: string;
  trader: string;
  orderType: string;
  executionsInstructions: string;
  orderReceivedDate: string;
  orderReceivedTime: string;
  orderCode: string;
  amendReceivedDateTime: string | null;
  cancelReason: string | null;
  timestamp: string; // `${date}T${time}`
}

export type PumpandDumpResult = PumpDumpRow;

// Raw shapes mirror backend (space/case-sensitive)
export interface PumpDumpRowRaw {
  'Alert ID': string;
  'Report short name': string;
  'Security type': string;
  'Security name': string;
  Brokerage: string;
  'Alert type category': string;
  'Alert type description': string;
  Comments: string | null;
  'Exchange ID': string;
  'Message type': string;
  date: string;
  time: string;
  'Order id': string;
  'Trade id': string;
  'Market side': 'BUY' | 'SELL';
  Price: number | null;
  'Total Volume': number | null;
  value: number | null;
  Account: string;
  'Account type': string;
  Broker: string;
  Trader: string;
  'order type': string;
  'Executions instructions': string;
  'Order received date': string;
  'Order received time': string;
  'Order Code': string;
  'Ammend received date / time': string | null;
  'Cancel reason': string | null;
}

// Optional: raw API wrapper if you want to map whole responses
export interface ApiPnDResponseRaw {
  count: number | null;
  message: string;
  folder: string;
  latest_parquet: string;
  total_rows: number;
  pump_and_dump_count: number;
  returned: number;
  results: PumpDumpRowRaw[];
}

// ---------- Mappers (optimized) ----------

// Row mapper uses destructuring with key aliasing (fast + typo-proof)
export function mapPumpDumpRow(raw: PumpDumpRowRaw): PumpDumpRow {
  const {
    ['Alert ID']: alertId,
    ['Report short name']: reportShortName,
    ['Security type']: securityType,
    ['Security name']: securityName,
    Brokerage: brokerage,
    ['Alert type category']: alertTypeCategory,
    ['Alert type description']: alertTypeDescription,
    Comments: comments,
    ['Exchange ID']: exchangeId,
    ['Message type']: messageType,
    date,
    time,
    ['Order id']: orderId,
    ['Trade id']: tradeId,
    ['Market side']: marketSide,
    Price: price,
    ['Total Volume']: totalVolume,
    value,
    Account: account,
    ['Account type']: accountType,
    Broker: broker,
    Trader: trader,
    ['order type']: orderType,
    ['Executions instructions']: executionsInstructions,
    ['Order received date']: orderReceivedDate,
    ['Order received time']: orderReceivedTime,
    ['Order Code']: orderCode,
    ['Ammend received date / time']: amendReceivedDateTime,
    ['Cancel reason']: cancelReason,
  } = raw;

  // compute timestamp without constructing Date (no tz surprises)
  const timestamp = `${date}T${time}`;

  return {
    alertId,
    reportShortName,
    securityType,
    securityName,
    brokerage,
    alertTypeCategory,
    alertTypeDescription,
    comments,
    exchangeId,
    messageType,
    date,
    time,
    orderId,
    tradeId,
    marketSide,
    price,
    totalVolume,
    value,
    account,
    accountType,
    broker,
    trader,
    orderType,
    executionsInstructions,
    orderReceivedDate,
    orderReceivedTime,
    orderCode,
    amendReceivedDateTime,
    cancelReason,
    timestamp,
  };
}
export const mapPumpDumpRows = (rows: PumpDumpRowRaw[]): PumpandDumpResult[] =>
  rows.map(mapPumpDumpRow);
