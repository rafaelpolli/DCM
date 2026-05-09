# DCM — Data Contract Manager

> Plataforma centralizada para gestão de **Data Contracts** em ambientes de Data Engineering e Data Governance.

---
 
## Índice

1. [Visão Geral](#1-visão-geral)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Estrutura de Diretórios](#3-estrutura-de-diretórios)
4. [Modelo de Dados](#4-modelo-de-dados)
5. [API — Rotas e Endpoints](#5-api--rotas-e-endpoints)
6. [Autenticação e Autorização (RBAC)](#6-autenticação-e-autorização-rbac)
7. [Frontend e Componentes de UI](#7-frontend-e-componentes-de-ui)
8. [Como Executar Localmente](#8-como-executar-localmente)
9. [Estado Atual de Implementação](#9-estado-atual-de-implementação)
10. [O Que Falta para Produção](#10-o-que-falta-para-produção)
11. [Roadmap Técnico Sugerido](#11-roadmap-técnico-sugerido)

---

## 1. Visão Geral

O **DCM (Data Contract Manager)** é uma aplicação web para definição, versionamento e rastreamento de **Data Contracts** — acordos formais entre produtores e consumidores de dados que descrevem esquema, SLA, localização de armazenamento, classificação de dados e política de particionamento.

**Casos de uso principais:**
- Catalogar contratos de dados com schema, SLA e metadados de localização (S3, Delta Lake, etc.)
- Gerenciar um fluxo de aprovação de mudanças (Change Requests) com diff visual
- Controlar acesso por papel (viewer / creator / admin)
- Exportar contratos em JSON, YAML ou DDL SQL

**Estado atual:** Prova de Conceito (PoC) — funcional em memória, sem persistência real.

---

## 2. Stack Tecnológico

| Camada | Tecnologia | Versão / Detalhes |
|--------|-----------|-------------------|
| **Linguagem** | Python | 3.12+ |
| **Framework Web** | FastAPI | latest |
| **ASGI Server** | Uvicorn | standard |
| **Template Engine** | Jinja2 | via FastAPI |
| **CSS Framework** | Tailwind CSS | CDN (play.tailwindcss.com) |
| **Interatividade** | HTMX | 1.9.10 via CDN |
| **JavaScript** | Vanilla JS | Inline, sem bundler |
| **Serialização** | PyYAML | para export YAML |
| **Form Parsing** | python-multipart | para POST forms |
| **Banco de Dados** | *Nenhum* | In-memory (mock_data.py) |
| **Auth** | Cookies HTTP | Sem JWT/OAuth — demo only |

**Dependências Python (`requirements.txt`):**
```
fastapi
uvicorn[standard]
jinja2
python-multipart
pyyaml
```

---

## 3. Estrutura de Diretórios

```
Gestaodecontrato/
├── .claude/
│   ├── launch.json                   # Configuração do servidor de dev (Claude Code)
│   └── settings.local.json           # Permissões do CLI Claude
├── datacontracts/
│   ├── requirements.txt              # Dependências Python
│   └── app/
│       ├── __init__.py
│       ├── main.py                   # Aplicação FastAPI — todas as rotas e lógica
│       ├── mock_data.py              # Banco de dados em memória (fixtures)
│       └── static/
│       │   └── images/
│       │       └── logo.png          # Logo da plataforma (JaguarData)
│       └── templates/
│           ├── base.html             # Layout base (navbar, toast, estilos globais)
│           ├── login.html            # Tela de login com animação Canvas
│           ├── dashboard.html        # Página inicial com métricas
│           ├── contracts/
│           │   ├── list.html         # Catálogo de contratos com filtros
│           │   ├── detail.html       # Detalhe do contrato com abas
│           │   ├── form.html         # Wizard de criação (3 etapas)
│           │   ├── export.html       # Exportação (JSON / YAML / DDL)
│           │   ├── _table.html       # Partial: tabela de contratos (HTMX)
│           │   ├── _tab_overview.html    # Partial: metadados, classificação, SLA
│           │   ├── _tab_schema.html      # Partial: tabela de campos
│           │   ├── _tab_location.html    # Partial: localização de armazenamento
│           │   ├── _tab_partitioning.html # Partial: estratégia de particionamento
│           │   ├── _tab_history.html     # Partial: histórico de versões
│           │   └── _tab_requests.html    # Partial: change requests vinculadas
│           ├── requests/
│           │   ├── list.html         # Lista de change requests
│           │   ├── detail.html       # Detalhe com diff visual e comentários
│           │   ├── _table.html       # Partial: tabela de requests (HTMX)
│           │   └── _comments.html    # Partial: thread de comentários
│           └── partials/
│               └── _status_badge.html  # Componente: badge de status reutilizável
└── README.md
```

---

## 4. Modelo de Dados

> Atualmente toda a camada de dados vive em `app/mock_data.py` como dicionários Python em memória. Os modelos abaixo representam a estrutura de dados em uso hoje e servem como referência para a modelagem real no banco de dados futuro.

### 4.1 User

```python
{
    "id":    str,           # ex: "u-001"
    "name":  str,           # ex: "Ana Silva"
    "email": str,           # ex: "ana.silva@empresa.com"
    "role":  Literal["CREATOR", "ADMIN", "VIEWER"]
}
```

**Usuários de demo disponíveis:**
| Login | Senha | Role |
|-------|-------|------|
| `ana.silva` | `ana` | CREATOR |
| `carlos.mendes` | `carlos` | ADMIN |
| `beatriz.lima` | `beatriz` | VIEWER |

---

### 4.2 Contract

```python
{
    "id":                  str,          # ex: "c-001"
    "name":                str,          # ex: "tb_orders_silver"
    "description":         str,
    "status":              Literal["DRAFT", "PENDING", "APPROVED", "REJECTED", "DEPRECATED"],
    "version":             str,          # Semantic versioning — ex: "2.1.0"
    "environment":         Literal["DEV", "STAGING", "PROD"],
    "domain":              str,          # ex: "Commerce", "CRM", "Finance"
    "team":                str,
    "owner":               str,          # email do responsável
    "source_system":       str,          # sistema de origem
    "data_classification": Literal["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
    "tags":                list[str],

    "location": {
        "layer":       Literal["RAW", "BRONZE", "SILVER", "GOLD"],
        "bucket":      str,              # ex: "s3://datalake-prod"
        "path":        str,              # ex: "/commerce/orders/silver/"
        "format":      str,              # ex: "PARQUET", "DELTA", "JSON"
        "compression": str               # ex: "SNAPPY", "GZIP", "NONE"
    },

    "sla": {
        "freshness":              str,   # ex: "hourly", "daily", "real-time"
        "max_latency_minutes":    int,
        "availability_percent":   float, # ex: 99.9
        "retention_days":         int,
        "alert_email":            str
    },

    "partitioning": {
        "strategy":         str,         # ex: "DATE", "DATE_HOUR"
        "partition_column": str,         # ex: "dt_ref"
        "partition_format": str,         # ex: "yyyy/MM/dd"
        "pruning_enabled":  bool
    },

    "fields": [
        {
            "name":          str,
            "type":          str,        # STRING, INTEGER, DECIMAL, TIMESTAMP, MAP, ARRAY, etc.
            "nullable":      bool,
            "pk":            bool,       # primary key
            "pii":           Literal["NONE","NAME","CPF","EMAIL","PHONE","DATE","IP"],
            "description":   str,
            "partition_key": bool        # opcional, para colunas de partição
        }
    ],

    "history": [
        {
            "version": str,
            "date":    str,             # YYYY-MM-DD
            "author":  str,
            "note":    str
        }
    ],

    "created_at": str,                   # YYYY-MM-DD
    "updated_at": str
}
```

---

### 4.3 Change Request

```python
{
    "id":             str,               # ex: "r-001"
    "title":          str,
    "type":           Literal["SCHEMA_CHANGE", "SLA_CHANGE", "CREATE", "DEPRECATE"],
    "contract_id":    str,               # FK → Contract.id
    "contract_name":  str,
    "requester":      str,               # email
    "requester_name": str,
    "status":         Literal["OPEN", "IN_REVIEW", "APPROVED", "REJECTED"],
    "created_at":     str,
    "updated_at":     str,
    "description":    str,

    "diff": {
        "version_from": str | None,
        "version_to":   str,
        "changes": [
            {
                "op":    Literal["add", "remove", "modify"],
                "field": str,
                "old":   Any,
                "new":   Any
            }
        ]
    },

    "comments": [
        {
            "author": str,
            "date":   str,
            "text":   str
        }
    ]
}
```

---

## 5. API — Rotas e Endpoints

Toda a lógica de rotas vive em `app/main.py`. A aplicação usa **FastAPI** com **Jinja2** para server-side rendering e **HTMX** para atualizações parciais de página (sem SPA completo).

### Autenticação

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/login` | Renderiza a tela de login |
| `POST` | `/login` | Valida credenciais e define cookies `logged_in` + `role` |
| `GET` | `/logout` | Limpa cookies e redireciona para `/login` |

### Dashboard

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Dashboard com métricas e atividade recente |

### Contratos

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/contracts` | Lista de contratos com filtros (`status`, `layer`, `q`) |
| `GET` | `/contracts` *(HX-Request)* | Retorna partial `_table.html` para HTMX |
| `GET` | `/contracts/new` | Wizard de criação de contrato (3 etapas) |
| `POST` | `/contracts/new` | Submete novo contrato |
| `GET` | `/contracts/{cid}` | Detalhe do contrato (aba Overview por padrão) |
| `GET` | `/contracts/{cid}?tab={tab}` *(HX-Request)* | Retorna partial da aba solicitada |
| `GET` | `/contracts/{cid}/export?format={fmt}` | Exporta contrato como `json`, `yaml` ou `ddl` |

**Abas disponíveis em `/contracts/{cid}`:**
- `overview` — metadados, classificação, SLA
- `schema` — tabela de campos (nome, tipo, nullable, PK, PII, descrição)
- `location` — localização (bucket, path, format, compression)
- `partitioning` — estratégia de particionamento
- `history` — histórico de versões
- `requests` — change requests vinculadas ao contrato

### Change Requests

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/requests` | Lista de change requests com filtro por `status` |
| `GET` | `/requests` *(HX-Request)* | Partial `_table.html` para HTMX |
| `GET` | `/requests/{rid}` | Detalhe com diff visual e comentários |
| `POST` | `/requests/{rid}/approve` | Aprovar request *(admin only)* |
| `POST` | `/requests/{rid}/reject` | Rejeitar com justificativa *(admin only)* |
| `POST` | `/requests/{rid}/comment` | Adicionar comentário |

### Utilitários

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/set-role?role={role}` | Troca de papel para demo (viewer/creator/admin) |
| `GET` | `/static/...` | Servindo assets estáticos |

---

## 6. Autenticação e Autorização (RBAC)

### Mecanismo Atual (Demo)

- **Sessão:** Cookie HTTP `logged_in=1` + `role=<papel>` com TTL de 30 dias
- **Validação:** Função `require_auth(request)` em `main.py` — verifica presença do cookie
- **Senhas:** Mapeamento hardcoded em `LOGIN_MAP`, sem hash — apenas para demo
- **Role switching:** Rota `/set-role` troca o cookie `role` em tempo real (para demonstração)

### Papéis e Permissões

| Ação | VIEWER | CREATOR | ADMIN |
|------|:------:|:-------:|:-----:|
| Visualizar contratos | ✅ | ✅ | ✅ |
| Visualizar change requests | ✅ | ✅ | ✅ |
| Criar contratos | ❌ | ✅ | ✅ |
| Submeter change request | ❌ | ✅ | ✅ |
| Aprovar / Rejeitar request | ❌ | ❌ | ✅ |
| Comentar em requests | ✅ | ✅ | ✅ |
| Exportar contratos | ✅ | ✅ | ✅ |

---

## 7. Frontend e Componentes de UI

### Arquitetura

- **Rendering:** Server-Side Rendering (SSR) via Jinja2
- **Interatividade:** HTMX para atualização de tabelas e troca de abas — sem recarregamento de página
- **Estilo:** Tailwind CSS via CDN (sem build step)
- **JavaScript:** Vanilla JS inline para animações, validações de formulário e dropdowns

### Componentes Implementados

| Componente | Localização | Descrição |
|-----------|------------|-----------|
| Navbar | `base.html` | Logo, links de nav, seletor de papel, avatar, logout |
| Toast Notifications | `base.html` | Notificações auto-dismiss no canto inferior direito |
| Dashboard Cards | `dashboard.html` | Métricas: total contratos, pendentes, aprovados, campos PII |
| Layer Distribution | `dashboard.html` | Barras de progresso RAW/BRONZE/SILVER/GOLD |
| Contract Table | `contracts/_table.html` | Tabela filtrável com badges de status e layer |
| Contract Form Wizard | `contracts/form.html` | 3 etapas: Identificação → Schema → Localização/SLA |
| Contract Detail Tabs | `contracts/detail.html` | Navegação por abas com carregamento HTMX |
| Schema Table | `contracts/_tab_schema.html` | Grid de campos com tipos, PK, PII, nullable |
| Export Modal | `contracts/export.html` | Exportação JSON / YAML / DDL SQL |
| Diff Viewer | `requests/detail.html` | Visualização colorida de adições/remoções/modificações |
| Comments Thread | `requests/_comments.html` | Thread de comentários com timestamp e autor |
| Status Badge | `partials/_status_badge.html` | Badge reutilizável com cores por status |
| Login Canvas | `login.html` | Animação de partículas em Canvas HTML5 |

### Paleta de Cores

| Elemento | Cor | Hex |
|---------|-----|-----|
| Brand primary | Laranja | `#FF6200` |
| Brand secondary | Azul | `#185FA5` |
| DRAFT | Cinza | `#9ca3af` |
| PENDING | Laranja | `#FF6200` |
| APPROVED | Verde | `#16a34a` |
| REJECTED | Vermelho | `#dc2626` |
| DEPRECATED | Roxo | `#7c3aed` |
| Layer RAW | Cinza | `#6b7280` |
| Layer BRONZE | Marrom | `#c2713a` |
| Layer SILVER | Azul-cinza | `#64748b` |
| Layer GOLD | Âmbar | `#ca8a04` |

---

## 8. Como Executar Localmente

### Pré-requisitos

- Python 3.12+
- pip

### Passos

```bash
# 1. Clone o repositório
git clone https://github.com/<seu-usuario>/DCM.git
cd DCM

# 2. Crie e ative o virtual environment
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# macOS/Linux
source .venv/bin/activate

# 3. Instale as dependências
cd datacontracts
pip install -r requirements.txt

# 4. Inicie o servidor de desenvolvimento
python -m uvicorn app.main:app --reload --port 8000
```

### Acesso

- **URL:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Login demo:**

| Usuário | Senha | Papel |
|---------|-------|-------|
| `ana.silva` | `ana` | Creator |
| `carlos.mendes` | `carlos` | Admin |
| `beatriz.lima` | `beatriz` | Viewer |

---

## 9. Estado Atual de Implementação

### ✅ Implementado e Funcional

- [x] Autenticação com cookies e troca de papel (demo)
- [x] Dashboard com métricas e atividade recente
- [x] Listagem de contratos com filtro por status, camada (layer) e busca textual
- [x] Wizard de criação de contrato (3 etapas)
- [x] Tela de detalhe do contrato com 6 abas (overview, schema, location, partitioning, history, requests)
- [x] Exportação de contratos em JSON, YAML e DDL SQL
- [x] Listagem de change requests com filtro por status
- [x] Tela de detalhe de change request com diff visual (add/remove/modify)
- [x] Fluxo de aprovação/rejeição de change requests (admin only)
- [x] Sistema de comentários em change requests
- [x] RBAC (viewer / creator / admin) com controle de visibilidade na UI
- [x] Integração HTMX para filtros e troca de abas sem reload
- [x] Toast notifications para feedback de ações
- [x] UI responsiva (Tailwind CSS)
- [x] Animação de partículas Canvas na tela de login
- [x] 5 contratos e 3 change requests de exemplo (mock data)

### ⚠️ Parcialmente Implementado

- [ ] Wizard de criação de contrato — etapas 2 e 3 (adição dinâmica de campos via JS)
- [ ] Submissão de change request a partir do detalhe de contrato
- [ ] Validação de formulários no backend (hoje só no frontend)

### ❌ Não Implementado

- [ ] Persistência de dados (banco de dados real)
- [ ] Autenticação segura (JWT, OAuth2, SSO)
- [ ] Gerenciamento de usuários (CRUD)
- [ ] Audit log (rastreamento de quem fez o quê e quando)
- [ ] Notificações por e-mail (SLA alert, aprovação pendente)
- [ ] Busca full-text avançada
- [ ] Lineagem de dados (data lineage)
- [ ] Integrações com ferramentas externas (dbt, Great Expectations, OpenMetadata)
- [ ] Testes automatizados (unit, integration, e2e)
- [ ] Deploy / infraestrutura (Docker, CI/CD)

---

## 10. O Que Falta para Produção

Esta seção descreve em detalhe o delta técnico entre o estado atual (PoC) e um sistema pronto para uso em produção.

---

### 10.1 Banco de Dados e Persistência

**Problema:** Todo o estado da aplicação vive em `mock_data.py`. Ao reiniciar o servidor, todos os dados são perdidos.

**Solução:**
- Adotar **PostgreSQL** como banco relacional principal
- Usar **SQLModel** ou **SQLAlchemy** como ORM
- Implementar **Alembic** para migrações de schema
- Modelar as entidades `User`, `Contract`, `ContractField`, `ChangeRequest`, `Comment`, `AuditLog`

**Schema relacional sugerido:**
```sql
users            (id, name, email, password_hash, role, created_at)
contracts        (id, name, description, status, version, domain, team, owner_id FK, ...)
contract_fields  (id, contract_id FK, name, type, nullable, pk, pii, description, sort_order)
contract_sla     (id, contract_id FK, freshness, max_latency_minutes, availability_percent, ...)
contract_location(id, contract_id FK, layer, bucket, path, format, compression)
contract_partitioning (id, contract_id FK, strategy, partition_column, ...)
contract_history (id, contract_id FK, version, note, author_id FK, created_at)
change_requests  (id, title, type, contract_id FK, requester_id FK, status, description, ...)
request_diffs    (id, request_id FK, op, field_path, old_value JSONB, new_value JSONB)
comments         (id, request_id FK, author_id FK, text, created_at)
audit_logs       (id, user_id FK, action, entity_type, entity_id, payload JSONB, created_at)
```

---

### 10.2 Autenticação e Segurança

**Problema:** Senhas em texto plano, sem hashing, sem tokens seguros, sem expiração real.

**Solução:**
- Implementar **OAuth2 + JWT** (access token + refresh token)
- Hash de senhas com **bcrypt** ou **argon2**
- Integração com **SSO corporativo** via SAML/OIDC (Azure AD, Okta)
- Proteção contra CSRF em formulários POST
- Rate limiting nas rotas de login
- HTTPS obrigatório (TLS via reverse proxy — Nginx/Caddy)
- Cabeçalhos de segurança HTTP (CSP, HSTS, X-Frame-Options)

**Bibliotecas sugeridas:**
```
python-jose[cryptography]    # JWT
passlib[bcrypt]              # password hashing
authlib                      # OAuth2/OIDC
slowapi                      # rate limiting
```

---

### 10.3 Validação de Dados no Backend

**Problema:** Formulários submetidos não passam por validação robusta no servidor.

**Solução:**
- Criar **Pydantic models** para todos os payloads de entrada
- Validar tipos, ranges, enums e campos obrigatórios
- Retornar erros estruturados com campo + mensagem
- Sanitizar inputs para prevenir XSS e injection

**Exemplo:**
```python
class ContractCreateRequest(BaseModel):
    name:                str = Field(..., min_length=3, max_length=100, pattern=r"^[a-z_]+$")
    domain:              str = Field(..., min_length=2)
    data_classification: DataClassification
    environment:         Environment
    fields:              list[FieldDefinition] = Field(..., min_items=1)
    sla:                 SLADefinition
    location:            LocationDefinition
```

---

### 10.4 Testes Automatizados

**Problema:** Zero cobertura de testes.

**Solução:**
```
tests/
├── unit/
│   ├── test_contract_export.py     # Testa geração de DDL/JSON/YAML
│   ├── test_rbac.py                # Testa controle de acesso por papel
│   └── test_diff_engine.py        # Testa geração de diff entre versões
├── integration/
│   ├── test_contract_api.py        # CRUD de contratos via TestClient
│   └── test_request_workflow.py    # Fluxo completo de aprovação
└── e2e/
    └── test_ui_flows.py            # Playwright para fluxos de UI
```

**Frameworks:**
```
pytest
pytest-asyncio
httpx              # TestClient assíncrono para FastAPI
pytest-cov         # coverage
playwright         # testes E2E de UI
```

---

### 10.5 Containerização e CI/CD

**Problema:** Sem empacotamento, sem pipeline de entrega.

**Dockerfile sugerido:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY datacontracts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY datacontracts/ .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**docker-compose.yml sugerido:**
```yaml
services:
  app:
    build: .
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql://user:pass@db:5432/dcm
    depends_on: [db]
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: dcm
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes: [pgdata:/var/lib/postgresql/data]
volumes:
  pgdata:
```

**Pipeline CI/CD (GitHub Actions):**
```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r datacontracts/requirements.txt pytest httpx
      - run: pytest tests/ --cov=app --cov-report=xml
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install ruff mypy
      - run: ruff check datacontracts/app/
      - run: mypy datacontracts/app/
```

---

### 10.6 Observabilidade

**Problema:** Sem logging estruturado, sem métricas, sem tracing.

**Solução:**
- **Logging:** `structlog` ou `loguru` com output JSON para ingestão em ELK/Datadog
- **Métricas:** `prometheus-fastapi-instrumentator` para expor `/metrics`
- **Tracing:** OpenTelemetry com exportador para Jaeger ou Tempo
- **Health check:** Endpoint `/health` com status do banco de dados e dependências

```python
# Exemplo de health check
@app.get("/health")
async def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        raise HTTPException(503, detail={"status": "degraded", "db": str(e)})
```

---

### 10.7 Funcionalidades de Produto Faltantes

| Feature | Prioridade | Complexidade |
|---------|-----------|-------------|
| Gerenciamento de usuários (CRUD) | Alta | Baixa |
| Notificação por e-mail (aprovações/alertas) | Alta | Média |
| Audit log completo | Alta | Média |
| Submissão de change request a partir do contrato | Alta | Baixa |
| Busca full-text (campos, descrições, domínios) | Média | Média |
| API REST pública com OpenAPI/Swagger UI | Média | Baixa |
| Lineagem de dados (grafo de dependências) | Média | Alta |
| Integração com dbt (parsing de YAML de modelos) | Média | Alta |
| Integração com Great Expectations (quality rules) | Baixa | Alta |
| Integração com Apache Atlas / OpenMetadata | Baixa | Alta |
| Suporte a múltiplos tenants (multi-tenancy) | Baixa | Alta |
| Webhooks para eventos (criação, aprovação, etc.) | Baixa | Média |

---

## 11. Roadmap Técnico Sugerido

```
FASE 1 — Fundação (Sprint 1-2)
├── Adicionar PostgreSQL + SQLAlchemy + Alembic
├── Migrar mock_data.py para models ORM reais
├── Implementar autenticação com JWT + bcrypt
└── Criar testes básicos de integração

FASE 2 — Core Features (Sprint 3-4)
├── Validação Pydantic em todos os endpoints
├── Submissão de change request via UI
├── Gerenciamento de usuários (admin)
├── Audit log
└── Notificações por e-mail (SMTP / SendGrid)

FASE 3 — Qualidade e Deploy (Sprint 5-6)
├── Cobertura de testes > 80%
├── Dockerização + docker-compose
├── Pipeline CI/CD (GitHub Actions)
├── Endpoint /health + métricas Prometheus
└── Deploy inicial (Railway / Fly.io / AWS ECS)

FASE 4 — Produto (Sprint 7+)
├── API REST pública + Swagger UI
├── Busca full-text
├── Lineagem de dados
└── Integrações (dbt, Great Expectations, OpenMetadata)
```

---

## Licença

A definir.

---

*Documentação gerada em 2026-04-02.*
