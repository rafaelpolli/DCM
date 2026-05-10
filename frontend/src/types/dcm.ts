export type ContractStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type RequestStatus = 'OPEN' | 'APPROVED' | 'REJECTED';
export type RequestType = 'CREATE' | 'UPDATE' | 'DELETE';
export type DataLayer = 'RAW' | 'BRONZE' | 'SILVER' | 'GOLD';
export type DataFormat = 'PARQUET' | 'AVRO' | 'ORC' | 'JSON' | 'CSV' | 'DELTA';
export type CompressionType = 'NONE' | 'SNAPPY' | 'ZSTD' | 'GZIP';
export type PartitionStrategy = 'NONE' | 'DATE' | 'HOUR' | 'CUSTOM';
export type PiiLevel = 'NONE' | 'EMAIL' | 'PHONE' | 'CPF' | 'CNPJ' | 'ADDRESS' | 'FULL_NAME';

export interface Location {
  layer: DataLayer;
  bucket: string;
  path: string;
  format: DataFormat;
  compression: CompressionType;
}

export interface SLA {
  freshness: string;
  max_latency_minutes: number;
  availability_percent: number;
  retention_days: number;
  alert_email: string;
}

export interface Partitioning {
  strategy: PartitionStrategy;
  partition_column: string;
  partition_format: string;
  pruning_enabled: boolean;
}

export interface FieldSchema {
  name: string;
  type: string;
  description: string;
  nullable: boolean;
  pii: PiiLevel;
  partition_key: boolean;
  business_key: boolean;
}

export interface HistoryEntry {
  version: string;
  date: string;
  author: string;
  note: string;
}

export interface DQRule {
  category: string;
  check: string;
  column: string;
  params: Record<string, string>;
  severity: 'CRITICAL' | 'ALERT';
}

export interface BusinessLogic {
  sql?: string;
  dependencies?: { table: string; contract_id?: string }[];
}

export interface Contract {
  id: string;
  name: string;
  description: string;
  status: ContractStatus;
  version: string;
  environment: string;
  domain: string;
  team: string;
  owner: string;
  source_system: string;
  data_classification: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  location: Location;
  sla: SLA;
  partitioning: Partitioning;
  fields: FieldSchema[];
  history: HistoryEntry[];
  data_quality?: DQRule[];
  business_logic?: BusinessLogic;
  paired_contract_id?: string;
}

export interface DiffChange {
  field: string;
  path: string;
  from: unknown;
  to: unknown;
}

export interface Diff {
  version_from: string | null;
  version_to: string;
  changes: DiffChange[];
}

export interface Comment {
  author: string;
  date: string;
  text: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  type: RequestType;
  contract_id: string;
  contract_name: string;
  requester: string;
  requester_name: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  description: string;
  diff: Diff;
  comments: Comment[];
}

// ── API responses ──

export interface DashboardData {
  stats: {
    total: number;
    pending: number;
    approved_this_month: number;
    pii_fields: number;
    by_layer: Record<string, number>;
  };
  recent: ChangeRequest[];
}

export interface ContractListResponse {
  contracts: Contract[];
  total: number;
}

export interface RequestListResponse {
  requests: ChangeRequest[];
  total: number;
}

export interface ExportResponse {
  content: string;
  lang: string;
  format: string;
  contract_name: string;
}

// ── Create/Update bodies ──

export interface ContractCreateBody {
  name: string;
  description: string;
  domain: string;
  team: string;
  owner: string;
  source_system: string;
  data_classification: string;
  tags: string;
  layer: DataLayer;
  bucket: string;
  path: string;
  fmt: DataFormat;
  compression: CompressionType;
  freshness: string;
  max_latency_minutes: number;
  availability_percent: number;
  retention_days: number;
  alert_email: string;
  partition_strategy: PartitionStrategy;
  partition_column: string;
  partition_format: string;
  pruning_enabled: boolean;
  fields: Omit<FieldSchema, 'name'>[];
}
