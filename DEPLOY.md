# 🚀 Colocar no ar de graça (GitHub Actions + Supabase)

Sem mensalidade, sem cartão. O GitHub roda um robôzinho a cada ~10 min que
confere o Supabase e dispara o que estiver na hora — com seu Mac desligado.

> Seu Mac só precisa ligar **quando você for escrever** uma newsletter nova.
> O **envio** é o GitHub que faz.

---

## Parte A — Supabase (dados + sessão do WhatsApp)

1. No seu projeto Supabase → **SQL Editor** → New query.
2. Cole todo o `schema.sql` e clique em **Run** (cria as tabelas).
3. Em **Project Settings → API**, copie:
   - **Project URL** (ex: `https://abcd.supabase.co`)
   - **service_role** (clique em *Reveal*) — secreta, não compartilhe.

---

## Parte B — No seu Mac: escanear o QR 1x e compor

1. Crie um arquivo chamado `.env` na pasta do projeto, com:
   ```
   SUPABASE_URL=https://SEU-PROJETO.supabase.co
   SUPABASE_SERVICE_KEY=sua-service-role-key
   ```
2. Rode o app:
   ```bash
   cd "/Users/clararicieri/Newsletter-WhatsApp"
   npm start
   ```
   No log deve aparecer **🗄️ Armazenamento: Supabase**.
3. Abra http://localhost:3000 → aba **Conexão** → escaneie o QR.
   - Pronto: a sessão ficou salva no Supabase (não precisa escanear de novo).
4. Crie/agende suas newsletters normalmente. Elas ficam salvas no Supabase.

---

## Parte C — GitHub (o robô que dispara 24h)

1. Crie uma conta em https://github.com (grátis), se ainda não tiver.
2. Suba o projeto pro GitHub (eu te ajudo com os comandos — `git` + `gh`).
   - 💡 Recomendo repositório **público**: o código não tem nenhuma senha
     (as chaves ficam nos *Secrets*), e público dá minutos de execução ilimitados.
3. No repositório → **Settings → Secrets and variables → Actions → New repository secret**, crie dois:
   - `SUPABASE_URL` → sua Project URL
   - `SUPABASE_SERVICE_KEY` → sua service_role
4. Pronto! Em **Actions**, o fluxo "Disparar newsletter" roda a cada ~10 min.
   - Dá pra testar na hora pelo botão **Run workflow**.

---

## Como fica o dia a dia
- **Escrever newsletter nova**: liga o Mac, `npm start`, compõe, agenda. Pode desligar.
- **Enviar**: o GitHub faz sozinho, no horário (com até ~10-15 min de variação).

## Detalhes importantes
- O horário do GitHub não é exato ao minuto (pode atrasar uns minutos). Pro
  devocional da manhã, costuma ser tranquilo.
- O QR só precisa ser escaneado de novo se você desconectar o aparelho pelo
  celular ou ficar ~14 dias sem o robô rodar.
- Evite deixar o app aberto no Mac exatamente na hora de um disparo agendado,
  pra não concorrer com o GitHub (os dois têm trava, mas melhor não arriscar).
- O GitHub pausa fluxos agendados se o repositório ficar 60 dias sem novidade —
  um disparo manual ou commit de vez em quando mantém ativo.
