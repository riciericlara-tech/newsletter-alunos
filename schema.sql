-- ============================================================
-- Esquema do Newsletter Alunos para o Supabase
-- Rode isto no SQL Editor do seu projeto Supabase (uma vez).
-- ============================================================

-- Cada registro é guardado como JSON, espelhando exatamente a estrutura
-- que o app já usava localmente. Simples e sem mapeamento de colunas.

create table if not exists newsletters (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);

create table if not exists projects (
  id text primary key,
  data jsonb not null
);

create table if not exists app_settings (
  id int primary key default 1,
  data jsonb not null
);

-- Sessão do WhatsApp (Baileys). Fica aqui para você não precisar escanear o
-- QR de novo a cada reinício do servidor.
create table if not exists wa_auth (
  key text primary key,
  value jsonb not null
);

-- Segurança: as tabelas só são acessadas pelo servidor com a SERVICE KEY,
-- que ignora RLS. Habilitamos RLS sem políticas públicas para que ninguém
-- com a chave pública (anon) consiga ler/escrever.
alter table newsletters  enable row level security;
alter table projects     enable row level security;
alter table app_settings enable row level security;
alter table wa_auth      enable row level security;
