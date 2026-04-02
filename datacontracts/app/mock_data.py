from datetime import datetime, timedelta

# ── Users ──────────────────────────────────────────────────────────────────────
USERS = {
    "creator": {
        "id": "u-001",
        "name": "Ana Silva",
        "email": "ana.silva@empresa.com",
        "role": "CREATOR",
    },
    "admin": {
        "id": "u-002",
        "name": "Carlos Mendes",
        "email": "carlos.mendes@empresa.com",
        "role": "ADMIN",
    },
    "viewer": {
        "id": "u-003",
        "name": "Beatriz Lima",
        "email": "beatriz.lima@empresa.com",
        "role": "VIEWER",
    },
}

# ── Contracts ──────────────────────────────────────────────────────────────────
CONTRACTS = {
    "c-001": {
        "id": "c-001",
        "name": "tb_orders_silver",
        "description": "Tabela de pedidos camada Silver com limpeza e enriquecimento",
        "status": "APPROVED",
        "version": "2.1.0",
        "environment": "PROD",
        "domain": "Commerce",
        "team": "Data Engineering",
        "owner": "ana.silva@empresa.com",
        "source_system": "OMS",
        "data_classification": "INTERNAL",
        "tags": ["orders", "silver", "commerce"],
        "created_at": "2025-01-10",
        "updated_at": "2025-03-01",
        "location": {
            "layer": "SILVER",
            "bucket": "s3://datalake-prod",
            "path": "/silver/commerce/orders/",
            "format": "PARQUET",
            "compression": "SNAPPY",
        },
        "sla": {
            "freshness": "hourly",
            "max_latency_minutes": 90,
            "availability_percent": 99.5,
            "retention_days": 365,
            "alert_email": "de-team@empresa.com",
        },
        "partitioning": {
            "strategy": "DATE",
            "partition_column": "order_date",
            "partition_format": "yyyy/MM/dd",
            "pruning_enabled": True,
        },
        "fields": [
            {"name": "order_id",     "type": "STRING",    "nullable": False, "pk": True,  "pii": "NONE", "description": "Identificador único do pedido"},
            {"name": "customer_id",  "type": "STRING",    "nullable": False, "pk": False, "pii": "NONE", "description": "ID do cliente"},
            {"name": "customer_cpf", "type": "STRING",    "nullable": True,  "pk": False, "pii": "CPF",  "description": "CPF do cliente"},
            {"name": "total_amount", "type": "DECIMAL",   "nullable": False, "pk": False, "pii": "NONE", "description": "Valor total do pedido"},
            {"name": "order_date",   "type": "TIMESTAMP", "nullable": False, "pk": False, "pii": "NONE", "description": "Data do pedido — chave de partição", "partition_key": True},
            {"name": "status",       "type": "STRING",    "nullable": False, "pk": False, "pii": "NONE", "description": "Status do pedido"},
        ],
        "history": [
            {"version": "1.0.0", "date": "2025-01-10", "author": "ana.silva@empresa.com", "note": "Versão inicial"},
            {"version": "2.0.0", "date": "2025-02-01", "author": "ana.silva@empresa.com", "note": "Adicionado campo customer_cpf e SLA atualizado"},
            {"version": "2.1.0", "date": "2025-03-01", "author": "carlos.mendes@empresa.com", "note": "Ajuste de freshness para hourly"},
        ],
    },
    "c-002": {
        "id": "c-002",
        "name": "tb_customers_gold",
        "description": "Tabela de clientes consolidada na camada Gold para analytics",
        "status": "APPROVED",
        "version": "1.3.0",
        "environment": "PROD",
        "domain": "CRM",
        "team": "Analytics",
        "owner": "beatriz.lima@empresa.com",
        "source_system": "CRM",
        "data_classification": "CONFIDENTIAL",
        "tags": ["customers", "gold", "crm", "analytics"],
        "created_at": "2025-02-05",
        "updated_at": "2025-03-10",
        "location": {
            "layer": "GOLD",
            "bucket": "s3://datalake-prod",
            "path": "/gold/crm/customers/",
            "format": "PARQUET",
            "compression": "GZIP",
        },
        "sla": {
            "freshness": "daily",
            "max_latency_minutes": 240,
            "availability_percent": 99.9,
            "retention_days": 730,
            "alert_email": "analytics-team@empresa.com",
        },
        "partitioning": {
            "strategy": "DATE",
            "partition_column": "updated_at",
            "partition_format": "yyyy/MM/dd",
            "pruning_enabled": True,
        },
        "fields": [
            {"name": "customer_id",   "type": "STRING",    "nullable": False, "pk": True,  "pii": "NONE", "description": "Identificador único do cliente"},
            {"name": "full_name",     "type": "STRING",    "nullable": False, "pk": False, "pii": "NAME", "description": "Nome completo do cliente"},
            {"name": "email",         "type": "STRING",    "nullable": True,  "pk": False, "pii": "EMAIL","description": "E-mail do cliente"},
            {"name": "phone",         "type": "STRING",    "nullable": True,  "pk": False, "pii": "PHONE","description": "Telefone do cliente"},
            {"name": "birth_date",    "type": "DATE",      "nullable": True,  "pk": False, "pii": "DATE", "description": "Data de nascimento"},
            {"name": "total_orders",  "type": "INTEGER",   "nullable": False, "pk": False, "pii": "NONE", "description": "Total de pedidos realizados"},
            {"name": "total_revenue", "type": "DECIMAL",   "nullable": False, "pk": False, "pii": "NONE", "description": "Receita total gerada"},
            {"name": "updated_at",    "type": "TIMESTAMP", "nullable": False, "pk": False, "pii": "NONE", "description": "Data da última atualização", "partition_key": True},
        ],
        "history": [
            {"version": "1.0.0", "date": "2025-02-05", "author": "beatriz.lima@empresa.com", "note": "Versão inicial"},
            {"version": "1.2.0", "date": "2025-02-20", "author": "beatriz.lima@empresa.com", "note": "Adicionados campos de receita total"},
            {"version": "1.3.0", "date": "2025-03-10", "author": "carlos.mendes@empresa.com", "note": "Classificação atualizada para CONFIDENTIAL"},
        ],
    },
    "c-003": {
        "id": "c-003",
        "name": "tb_events_raw",
        "description": "Eventos brutos de clique e navegação do app mobile",
        "status": "PENDING",
        "version": "0.9.0",
        "environment": "STAGING",
        "domain": "Product",
        "team": "Data Platform",
        "owner": "ana.silva@empresa.com",
        "source_system": "Kafka",
        "data_classification": "INTERNAL",
        "tags": ["events", "raw", "mobile", "clickstream"],
        "created_at": "2025-03-15",
        "updated_at": "2025-03-20",
        "location": {
            "layer": "RAW",
            "bucket": "s3://datalake-staging",
            "path": "/raw/product/events/",
            "format": "JSON",
            "compression": "NONE",
        },
        "sla": {
            "freshness": "real-time",
            "max_latency_minutes": 5,
            "availability_percent": 99.0,
            "retention_days": 90,
            "alert_email": "platform-team@empresa.com",
        },
        "partitioning": {
            "strategy": "DATE_HOUR",
            "partition_column": "event_ts",
            "partition_format": "yyyy/MM/dd/HH",
            "pruning_enabled": False,
        },
        "fields": [
            {"name": "event_id",   "type": "STRING",    "nullable": False, "pk": True,  "pii": "NONE",  "description": "ID único do evento"},
            {"name": "user_id",    "type": "STRING",    "nullable": True,  "pk": False, "pii": "NONE",  "description": "ID do usuário (pode ser anônimo)"},
            {"name": "session_id", "type": "STRING",    "nullable": False, "pk": False, "pii": "NONE",  "description": "ID da sessão"},
            {"name": "event_type", "type": "STRING",    "nullable": False, "pk": False, "pii": "NONE",  "description": "Tipo do evento (click, view, etc)"},
            {"name": "payload",    "type": "MAP",       "nullable": True,  "pk": False, "pii": "NONE",  "description": "Dados do evento em formato livre"},
            {"name": "ip_address", "type": "STRING",    "nullable": True,  "pk": False, "pii": "IP",    "description": "Endereço IP do dispositivo"},
            {"name": "event_ts",   "type": "TIMESTAMP", "nullable": False, "pk": False, "pii": "NONE",  "description": "Timestamp do evento", "partition_key": True},
        ],
        "history": [
            {"version": "0.9.0", "date": "2025-03-15", "author": "ana.silva@empresa.com", "note": "Versão inicial aguardando aprovação"},
        ],
    },
    "c-004": {
        "id": "c-004",
        "name": "tb_inventory_bronze",
        "description": "Dados de inventário e estoque na camada Bronze após ingestão do ERP",
        "status": "DRAFT",
        "version": "0.1.0",
        "environment": "DEV",
        "domain": "Supply Chain",
        "team": "Data Engineering",
        "owner": "ana.silva@empresa.com",
        "source_system": "ERP",
        "data_classification": "INTERNAL",
        "tags": ["inventory", "bronze", "supply-chain", "erp"],
        "created_at": "2025-03-22",
        "updated_at": "2025-03-22",
        "location": {
            "layer": "BRONZE",
            "bucket": "s3://datalake-dev",
            "path": "/bronze/supply/inventory/",
            "format": "DELTA",
            "compression": "SNAPPY",
        },
        "sla": {
            "freshness": "daily",
            "max_latency_minutes": 480,
            "availability_percent": 98.0,
            "retention_days": 180,
            "alert_email": "de-team@empresa.com",
        },
        "partitioning": {
            "strategy": "DATE",
            "partition_column": "ingestion_date",
            "partition_format": "yyyy/MM/dd",
            "pruning_enabled": True,
        },
        "fields": [
            {"name": "sku",            "type": "STRING",    "nullable": False, "pk": True,  "pii": "NONE", "description": "Código do produto"},
            {"name": "warehouse_id",   "type": "STRING",    "nullable": False, "pk": False, "pii": "NONE", "description": "ID do armazém"},
            {"name": "quantity",       "type": "INTEGER",   "nullable": False, "pk": False, "pii": "NONE", "description": "Quantidade em estoque"},
            {"name": "cost_price",     "type": "DECIMAL",   "nullable": True,  "pk": False, "pii": "NONE", "description": "Preço de custo"},
            {"name": "ingestion_date", "type": "DATE",      "nullable": False, "pk": False, "pii": "NONE", "description": "Data de ingestão", "partition_key": True},
        ],
        "history": [
            {"version": "0.1.0", "date": "2025-03-22", "author": "ana.silva@empresa.com", "note": "Rascunho inicial"},
        ],
    },
    "c-005": {
        "id": "c-005",
        "name": "tb_sessions_silver_v1",
        "description": "Sessões de usuário enriquecidas — versão legada substituída pela v2",
        "status": "DEPRECATED",
        "version": "1.0.0",
        "environment": "PROD",
        "domain": "Product",
        "team": "Analytics",
        "owner": "beatriz.lima@empresa.com",
        "source_system": "Kafka",
        "data_classification": "INTERNAL",
        "tags": ["sessions", "silver", "deprecated"],
        "created_at": "2024-06-01",
        "updated_at": "2025-01-15",
        "location": {
            "layer": "SILVER",
            "bucket": "s3://datalake-prod",
            "path": "/silver/product/sessions_v1/",
            "format": "PARQUET",
            "compression": "SNAPPY",
        },
        "sla": {
            "freshness": "hourly",
            "max_latency_minutes": 120,
            "availability_percent": 95.0,
            "retention_days": 30,
            "alert_email": "analytics-team@empresa.com",
        },
        "partitioning": {
            "strategy": "DATE",
            "partition_column": "session_date",
            "partition_format": "yyyy/MM/dd",
            "pruning_enabled": False,
        },
        "fields": [
            {"name": "session_id",   "type": "STRING",    "nullable": False, "pk": True,  "pii": "NONE", "description": "ID da sessão"},
            {"name": "user_id",      "type": "STRING",    "nullable": True,  "pk": False, "pii": "NONE", "description": "ID do usuário"},
            {"name": "duration_sec", "type": "INTEGER",   "nullable": False, "pk": False, "pii": "NONE", "description": "Duração da sessão em segundos"},
            {"name": "session_date", "type": "DATE",      "nullable": False, "pk": False, "pii": "NONE", "description": "Data da sessão", "partition_key": True},
        ],
        "history": [
            {"version": "1.0.0", "date": "2024-06-01", "author": "beatriz.lima@empresa.com", "note": "Versão inicial"},
        ],
    },
}

# ── Change Requests ────────────────────────────────────────────────────────────
CHANGE_REQUESTS = {
    "r-001": {
        "id": "r-001",
        "title": "Remover CPF e adicionar e-mail criptografado",
        "type": "SCHEMA_CHANGE",
        "contract_id": "c-001",
        "contract_name": "tb_orders_silver",
        "requester": "ana.silva@empresa.com",
        "requester_name": "Ana Silva",
        "status": "OPEN",
        "created_at": "2025-03-20",
        "updated_at": "2025-03-22",
        "description": "Substituir o campo customer_cpf por customer_email_hash para reduzir exposição de PII conforme nova política de dados.",
        "diff": {
            "version_from": "2.1.0",
            "version_to": "2.2.0",
            "changes": [
                {"op": "remove", "field": "customer_cpf",       "old": "STRING  NULL  PII:CPF",   "new": None},
                {"op": "add",    "field": "customer_email_hash","old": None,                      "new": "STRING  NULL  PII:NONE"},
                {"op": "modify", "field": "sla.freshness",      "old": "hourly",                  "new": "real-time"},
            ],
        },
        "comments": [
            {"author": "Ana Silva",    "date": "2025-03-20", "text": "Necessário para compliance com LGPD."},
            {"author": "Carlos Mendes","date": "2025-03-21", "text": "Em análise. Vou verificar o impacto nos consumers."},
        ],
    },
    "r-002": {
        "id": "r-002",
        "title": "Aumentar retenção de customers_gold para 2 anos",
        "type": "SLA_CHANGE",
        "contract_id": "c-002",
        "contract_name": "tb_customers_gold",
        "requester": "beatriz.lima@empresa.com",
        "requester_name": "Beatriz Lima",
        "status": "APPROVED",
        "created_at": "2025-03-05",
        "updated_at": "2025-03-10",
        "description": "Time de analytics precisa de histórico maior para modelos de churn com lookback de 2 anos.",
        "diff": {
            "version_from": "1.2.0",
            "version_to": "1.3.0",
            "changes": [
                {"op": "modify", "field": "sla.retention_days",       "old": "365",        "new": "730"},
                {"op": "modify", "field": "data_classification",       "old": "INTERNAL",   "new": "CONFIDENTIAL"},
            ],
        },
        "comments": [
            {"author": "Beatriz Lima", "date": "2025-03-05", "text": "Solicitação do time de ML para modelo de churn."},
            {"author": "Carlos Mendes","date": "2025-03-10", "text": "Aprovado. Retenção ajustada e classificação elevada por precaução."},
        ],
    },
    "r-003": {
        "id": "r-003",
        "title": "Adicionar coluna device_type em tb_events_raw",
        "type": "SCHEMA_CHANGE",
        "contract_id": "c-003",
        "contract_name": "tb_events_raw",
        "requester": "ana.silva@empresa.com",
        "requester_name": "Ana Silva",
        "status": "REJECTED",
        "created_at": "2025-03-12",
        "updated_at": "2025-03-14",
        "description": "Adicionar campo device_type para segmentar eventos por tipo de dispositivo (mobile/desktop/tablet).",
        "diff": {
            "version_from": "0.8.0",
            "version_to": "0.9.0",
            "changes": [
                {"op": "add", "field": "device_type", "old": None, "new": "STRING  NULL  PII:NONE"},
            ],
        },
        "comments": [
            {"author": "Ana Silva",    "date": "2025-03-12", "text": "Necessário para análise de comportamento por plataforma."},
            {"author": "Carlos Mendes","date": "2025-03-14", "text": "Rejeitado — esta informação já está no payload. Evitar duplicação de dados."},
        ],
    },
}

# ── Helper counters ────────────────────────────────────────────────────────────
_contract_seq = 6
_request_seq = 4


def next_contract_id() -> str:
    global _contract_seq
    cid = f"c-{_contract_seq:03d}"
    _contract_seq += 1
    return cid


def next_request_id() -> str:
    global _request_seq
    rid = f"r-{_request_seq:03d}"
    _request_seq += 1
    return rid


# ── Derived stats (computed on-the-fly) ───────────────────────────────────────
def get_stats():
    contracts = list(CONTRACTS.values())
    total = len(contracts)
    pending = sum(1 for c in contracts if c["status"] == "PENDING")

    # Approved this month (mock: approved + created in last 30 days isn't tracked, just approved count)
    approved = sum(1 for c in contracts if c["status"] == "APPROVED")

    pii_fields = sum(
        1
        for c in contracts
        for f in c.get("fields", [])
        if f.get("pii", "NONE") != "NONE"
    )

    layer_counts = {}
    for c in contracts:
        layer = c["location"]["layer"]
        layer_counts[layer] = layer_counts.get(layer, 0) + 1

    return {
        "total": total,
        "pending": pending,
        "approved_this_month": approved,
        "pii_fields": pii_fields,
        "by_layer": layer_counts,
    }


def recent_requests(limit: int = 5):
    return sorted(CHANGE_REQUESTS.values(), key=lambda r: r["updated_at"], reverse=True)[:limit]
