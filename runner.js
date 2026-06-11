// Script de disparo de UMA vez, executado pelo GitHub Actions a cada ~10 min.
//
// Estratégia leve e segura:
//  1. Pergunta ao Supabase: tem newsletter vencida pra enviar agora?
//  2. Se NÃO → sai na hora, sem nem tocar no WhatsApp.
//  3. Se SIM → conecta no WhatsApp (sessão salva no Supabase), dispara e sai.
//
// Pré-requisito: a sessão do WhatsApp precisa já estar no Supabase — isso é
// feito escaneando o QR UMA vez localmente (npm start com as variáveis do
// Supabase). Aqui no GitHub não há tela pra escanear.

import 'dotenv/config'
import { listNewsletters } from './db.js'
import { connect, isConnected, state } from './whatsapp.js'
import { runDueOnce } from './scheduler.js'
import { USE_SUPABASE } from './supabase.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!USE_SUPABASE) {
    console.error('❌ SUPABASE_URL/SUPABASE_SERVICE_KEY não definidas. Configure os Secrets do GitHub.')
    process.exit(1)
  }

  // 1. Há algo vencido? (só consulta o banco, não mexe no WhatsApp)
  const now = Date.now()
  const all = await listNewsletters()
  const due = all.filter((n) => n.status === 'pending' && new Date(n.scheduledAt).getTime() <= now)

  if (due.length === 0) {
    console.log('✓ Nada a enviar agora. Saindo.')
    process.exit(0)
  }

  console.log(`📤 ${due.length} newsletter(s) vencida(s). Conectando ao WhatsApp…`)

  // 2. Conecta usando a sessão salva no Supabase.
  await connect()
  for (let i = 0; i < 90 && !isConnected(); i++) {
    if (state.status === 'qr') {
      console.error('❌ Sem sessão salva. Rode `npm start` localmente e escaneie o QR primeiro.')
      process.exit(1)
    }
    await sleep(1000)
  }
  if (!isConnected()) {
    console.error('❌ Não foi possível conectar ao WhatsApp.')
    process.exit(1)
  }

  // 3. Dispara o que está vencido.
  const result = await runDueOnce()
  console.log(`✅ Concluído. Enviadas: ${result.sent}.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Erro no runner:', err)
  process.exit(1)
})
