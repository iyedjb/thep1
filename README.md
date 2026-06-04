# 🚀 Ads Intelligence — README

> Plataforma de inteligência de campanhas Google Ads com IA integrada.

---

## 🗺️ Mapa da Arquitetura

```mermaid
graph TB
    subgraph FRONTEND["🖥️ Frontend — React + Vite (porta 3001)"]
        LOGIN["🔐 Login / Signup"]
        DASH["📊 Dashboard"]
        CAMP["📣 Campanhas"]
        KEYS["🔍 Palavras-chave"]
        REP["📄 Relatórios"]
    end

    subgraph BACKEND["⚙️ API Server — Express + Node.js (porta 3002)"]
        AUTH["🔑 /api/auth"]
        CAMPAIGNS_API["📣 /api/campaigns"]
        KEYWORDS_API["🔍 /api/keywords"]
        DASHBOARD_API["📊 /api/dashboard"]
    end

    subgraph DATABASE["💾 Banco de Dados — SQLite (local)"]
        USERS[("👥 users")]
        CAMPAIGNS_DB[("📣 campaigns")]
        KEYWORDS_DB[("🔍 keywords")]
        PERF[("📈 performance_data")]
        TRENDS[("📉 keyword_trends")]
    end

    subgraph EXTERNAL["☁️ APIs Externas (Google)"]
        GADS["📢 Google Ads API\nCampanhas reais"]
        KP["🔎 Keyword Planner\nDados de busca reais"]
        GEMINI["🤖 Gemini AI\nAnálise de palavras-chave"]
        GOAUTH["🔐 Google OAuth\nLogin com Google"]
    end

    LOGIN -->|JWT Token| AUTH
    DASH -->|fetch /api/dashboard| DASHBOARD_API
    CAMP -->|CRUD| CAMPAIGNS_API
    KEYS -->|pesquisa + análise| KEYWORDS_API

    AUTH -->|bcrypt + JWT| USERS
    CAMPAIGNS_API -->|cache local| CAMPAIGNS_DB
    KEYWORDS_API -->|cache local| KEYWORDS_DB
    DASHBOARD_API -->|métricas históricas| PERF

    CAMPAIGNS_API <-->|criar/pausar/editar| GADS
    KEYWORDS_API <-->|volume, CPC, concorrência| KP
    KEYWORDS_API -->|análise de IA| GEMINI
    AUTH <-->|verify token| GOAUTH
```

---

## 🧠 Brainstorm — Como Tudo se Conecta

```mermaid
mindmap
  root((Ads Intelligence))
    🖥️ Frontend React
      Login / Signup
        Email + Senha
        Google OAuth
      Dashboard
        Métricas Reais Google Ads
        Gráfico de Performance
        Conversões por Campanha
      Campanhas
        Listar do Google Ads
        Criar nova campanha
        Pausar / Ativar
        Excluir
      Palavras-chave
        Buscar volume real
        Análise com Gemini AI
        Tendências 12 meses
        Intenção de busca
      Relatórios
        Exportar CSV
        Métricas por campanha
    ⚙️ API Server Express
      Autenticação JWT
      CRUD Campanhas
      CRUD Palavras-chave
      Métricas Dashboard
    💾 SQLite Database
      Cache local
      Usuários
      Histórico de performance
    ☁️ Google APIs
      Google Ads API
        Keyword Planner
        Campaign Service
        Reporting GAQL
      Gemini AI
        Análise semântica
        Classificação de intenção
      Google OAuth 2.0
        Login social
```

---

## 🔄 Fluxo de uma Campanha (do clique ao Google Ads)

```mermaid
sequenceDiagram
    actor User as 👤 Usuário
    participant UI as 🖥️ Frontend
    participant API as ⚙️ API Server
    participant SQLite as 💾 SQLite
    participant GAds as 📢 Google Ads

    User->>UI: Clica "Nova Campanha"
    UI->>UI: Abre formulário
    User->>UI: Preenche Nome, Orçamento, Status
    UI->>API: POST /api/campaigns
    API->>GAds: campaignBudgets.create(orçamento)
    GAds-->>API: budget_resource_name
    API->>GAds: campaigns.create(nome, budget, status)
    GAds-->>API: campaign_id
    API->>SQLite: INSERT campaigns (google_campaign_id)
    SQLite-->>API: id local
    API-->>UI: { id, name, status, google_campaign_id }
    UI-->>User: ✅ "Campanha criada com sucesso!"
    Note over GAds: Campanha visível no painel<br/>Google Ads imediatamente
```

---

## 🔄 Fluxo de Pesquisa de Palavras-chave

```mermaid
sequenceDiagram
    actor User as 👤 Usuário
    participant UI as 🖥️ Frontend
    participant API as ⚙️ API Server
    participant KP as 🔎 Keyword Planner
    participant Gemini as 🤖 Gemini AI
    participant SQLite as 💾 SQLite

    User->>UI: Digita "tênis nike masculino"
    UI->>API: POST /api/keywords { keyword, location }
    API->>KP: generateKeywordIdeas("tênis nike masculino")
    KP-->>API: { volume: 49500, cpc: 2.35, competition: "alta" }
    API->>SQLite: INSERT keywords (dados reais)
    API-->>UI: keyword com métricas reais

    User->>UI: Clica 🤖 "Analisar com IA"
    UI->>API: POST /api/keywords/:id/analyze
    API->>Gemini: "Analise esta keyword para Google Ads..."
    Gemini-->>API: { analysis: "...", intent: "Transacional" }
    API->>SQLite: UPDATE keywords SET analysis, intent
    API-->>UI: { analysis, intent }
    UI-->>User: Análise exibida na tabela
```

---

## 🏗️ Estrutura do Projeto

```mermaid
graph LR
    subgraph ROOT["📁 thep1-main/"]
        ENV[".env 🔑\nCredenciais das APIs"]
        SERVER["server/index.ts\nOrquestrador de serviços"]

        subgraph ARTIFACTS["📁 artifacts/"]
            subgraph ADS["📁 ads-intelligence/\n🖥️ Frontend React"]
                PAGES["📁 src/pages/\nlogin, dashboard\ncampaigns, keywords\nreports"]
                LIB_FE["📁 src/lib/\nAPI client gerado"]
            end

            subgraph API_S["📁 api-server/\n⚙️ Backend Express"]
                ROUTES["📁 src/routes/\nauth, campaigns\nkeywords, dashboard"]
                LIB_BE["📁 src/lib/\ngoogle-ads.ts 🔗\ngemini.ts 🤖\nsqlite.ts 💾"]
            end
        end

        subgraph LIBS["📁 lib/"]
            API_CLIENT["📁 api-client-react/\nHooks React gerados\npelo Orval"]
            API_SPEC["📁 api-spec/\nOpenAPI schema\nopenapi.yaml"]
            API_ZOD["📁 api-zod/\nValidação Zod\ntipos compartilhados"]
        end
    end
```

---

## 🔑 GUIA PASSO A PASSO — Como Obter Cada API

---

### 🤖 PASSO 1 — Gemini AI (MAIS FÁCIL, 2 minutos)

**O que dá:** Análise inteligente de palavras-chave com IA real.

1. Acesse: **https://aistudio.google.com/apikey**
2. Clique em **"Create API key"**
3. Selecione um projeto Google (ou crie um novo)
4. Copie a chave gerada
5. Cole no `.env`:
   ```
   GEMINI_API_KEY=AIza...sua_chave_aqui
   ```

✅ **Pronto! Custo: R$ 0/mês** (60 requests/minuto grátis)

---

### 🔐 PASSO 2 — Google OAuth (Login com Google, 10 minutos)

**O que dá:** Botão "Entrar com Google" funcional.

1. Acesse: **https://console.cloud.google.com/**
2. Clique em **"Selecionar projeto"** → **"Novo projeto"**
   - Nome: `Ads Intelligence`
3. No menu lateral: **APIs e serviços** → **Tela de permissão OAuth**
   - Tipo: **Externo** → Salvar
   - Preencha: nome do app, e-mail de suporte
4. **APIs e serviços** → **Credenciais** → **Criar credenciais** → **ID do cliente OAuth 2.0**
   - Tipo: **Aplicativo da Web**
   - Origens autorizadas: `http://localhost:3001`
   - URIs de redirecionamento: `http://localhost:3001`
5. Copie o **Client ID** e cole no `.env`:
   ```
   GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   ```

✅ **Pronto! Custo: R$ 0/mês**

---

### 📢 PASSO 3 — Google Ads API (20–30 minutos)

**O que dá:** Dados reais de busca, criação de campanhas no Google Ads.

#### 3a. Criar Conta de Manager Google Ads (MCC)
1. Acesse: **https://ads.google.com/intl/pt-BR/home/tools/manager-accounts/**
2. Clique em **"Criar uma conta de gerente"**
3. Siga o processo (não precisa colocar cartão de crédito para conta Manager)

#### 3b. Obter Developer Token
1. Dentro do Google Ads Manager → **Ferramentas e configurações** (ícone de chave inglesa)
2. → **Configuração** → **Central de API**
3. Clique em **"Solicitar acesso"** → escolha **"Token de teste"** (aprovação imediata)
4. Copie o token e cole no `.env`:
   ```
   GOOGLE_ADS_DEVELOPER_TOKEN=seu_developer_token_aqui
   ```

> ⚠️ O token de teste funciona apenas com contas de teste. Para produção, você precisa solicitar acesso básico (leva 1–3 dias de aprovação pelo Google).

#### 3c. Criar Credenciais OAuth para o Google Ads
1. No **Google Cloud Console** (projeto criado no Passo 2)
2. **APIs e serviços** → **Biblioteca** → buscar **"Google Ads API"** → Ativar
3. **Credenciais** → **Criar credenciais** → **ID do cliente OAuth 2.0**
   - Tipo: **Aplicativo para computador** (Desktop)
4. Copie **Client ID** e **Client Secret** para o `.env`:
   ```
   GOOGLE_ADS_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   GOOGLE_ADS_CLIENT_SECRET=GOCSPX-seu_secret_aqui
   ```

#### 3d. Gerar Refresh Token
Execute o script helper (que vou criar):
```bash
npx tsx scripts/get-refresh-token.ts
```
- O script abrirá o browser para você autorizar
- Cole o token gerado no `.env`:
  ```
  GOOGLE_ADS_REFRESH_TOKEN=1//04...seu_refresh_token
  ```

#### 3e. Encontrar seu Customer ID
1. No Google Ads → olhe no canto superior direito
2. Você verá algo como **123-456-7890** — este é seu Customer ID
3. Cole no `.env`:
   ```
   GOOGLE_ADS_CUSTOMER_ID=1234567890
   GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890
   ```

✅ **Pronto! Custo: R$ 0** (API gratuita, você paga apenas pelos anúncios que rodar)

---

## 🎯 Resumo de Custos

| API | Gratuito | Limite grátis |
|-----|----------|---------------|
| Gemini AI (análise) | ✅ Sim | 60 req/min, 1500/dia |
| Google OAuth (login) | ✅ Sim | Ilimitado |
| Google Ads API | ✅ Sim | Rate limits generosos |
| Keyword Planner | ✅ Sim* | *Dados exatos exigem spend |
| SQLite (banco) | ✅ Sim | Ilimitado |
| **TOTAL** | **R$ 0/mês** | — |

---

## ⚡ Próximos Passos de Desenvolvimento

```mermaid
graph LR
    A["✅ Fase 1\nGemini AI\n(Análise de keywords)"]
    B["✅ Fase 2\nCSV Export\n(Relatórios)"]
    C["✅ Fase 3\nGoogle OAuth\nendpoint"]
    D["🔄 Fase 4\nGoogle Ads API\nWrapper criado"]
    E["⏳ Fase 5\nKeywords Route\n+ Keyword Planner"]
    F["⏳ Fase 6\nCampaigns Route\n+ Google Ads sync"]
    G["⏳ Fase 7\nDashboard\n+ métricas reais"]
    H["⏳ Fase 8\nLogin Google\nUI + Protected Routes"]
    I["⏳ Fase 9\nScript OAuth\nRefresh Token helper"]
    J["🚀 PRODUÇÃO"]

    A --> B --> C --> D --> E --> F --> G --> H --> I --> J
```

### 🔄 O Que Falta Fazer Agora:

1. **Atualizar `keywords.ts`** — usar Keyword Planner para dados reais
2. **Atualizar `campaigns.ts`** — sincronizar com Google Ads
3. **Atualizar `dashboard.ts`** — métricas reais do Google Ads
4. **Criar `scripts/get-refresh-token.ts`** — helper para autenticação
5. **Atualizar `login.tsx`** — botão Google funcional
6. **Atualizar `App.tsx`** — rotas protegidas reais

---

## 🏃 Como Rodar Localmente

```bash
# 1. Instalar dependências
npx pnpm install

# 2. Configurar as APIs (preencher o .env)
# Siga o guia acima

# 3. Iniciar todos os serviços
npx tsx server/index

# Serviços rodando:
# - Frontend: http://localhost:3001
# - API Server: http://localhost:3002
# - Sandbox: http://localhost:3000
```

---

## 📊 Modelo de Dados

```mermaid
erDiagram
    USERS {
        int id PK
        text email UK
        text name
        text password_hash
        text created_at
    }

    CAMPAIGNS {
        int id PK
        text name
        text status
        real budget
        real cpc
        real ctr
        real roas
        int conversions
        text google_campaign_id
        text created_at
    }

    KEYWORDS {
        int id PK
        text keyword
        int search_volume
        text competition
        real cpc
        text location
        text period
        text analysis
        text intent
        text created_at
    }

    KEYWORD_TRENDS {
        int id PK
        int keyword_id FK
        text month
        int volume
    }

    PERFORMANCE_DATA {
        int id PK
        text date
        int clicks
        int conversions
        real cost
    }

    KEYWORDS ||--o{ KEYWORD_TRENDS : "has trends"
```
