// Agendador: a cada 20s verifica newsletters vencidas e dispara.
// O envio é feito grupo por grupo, bloco por bloco, com intervalos
// aleatórios entre as mensagens para reduzir a chance de bloqueio.

import { listNewsletters, getNewsletter, updateNewsletter, getSettings } from './db.js'
import { sendText, isConnected, sendSelfNotification, state as waState } from './whatsapp.js'
import { supabase, USE_SUPABASE } from './supabase.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (min, max) => Math.floor(min + Math.random() * (max - min))

let running = false // trava para não disparar duas vezes em paralelo

function groupName(jid) {
  return waState.groups.find((g) => g.jid === jid)?.name || jid
}

// Dispara uma newsletter agora. Retorna { ok, error }.
// O log é acumulado em memória e persistido a cada grupo (não a cada bloco),
// para não fazer dezenas de gravações no banco durante um único disparo.
export async function sendNewsletter(id) {
  const nl = await getNewsletter(id)
  if (!nl) return { ok: false, error: 'Newsletter não encontrada' }
  if (!isConnected()) return { ok: false, error: 'WhatsApp não está conectado' }

  const settings = await getSettings()
  const log = []
  const addLog = (type, msg) => log.push({ at: new Date().toISOString(), type, msg })

  addLog('start', 'Disparo iniciado')
  await updateNewsletter(id, { status: 'sending', log })

  let hadError = false
  const okGroups = []
  const failedGroups = []
  const sentKeys = [] // ids das mensagens enviadas (p/ rastrear reações)

  // Envia um bloco com 1 tentativa extra em caso de falha. Retorna a msg ou null.
  async function sendBlockWithRetry(jid, block) {
    try {
      return await sendText(jid, block)
    } catch {
      await sleep(8000) // espera e tenta de novo uma vez
      try {
        return await sendText(jid, block)
      } catch (err2) {
        addLog('error', `Falha após retry: ${err2?.message}`)
        return null
      }
    }
  }

  for (let gi = 0; gi < nl.groupJids.length; gi++) {
    const jid = nl.groupJids[gi]
    const gname = groupName(jid)
    let groupOk = true
    let sentThisGroup = 0

    for (let bi = 0; bi < nl.blocks.length; bi++) {
      const block = nl.blocks[bi]
      if (!block.trim()) continue
      const msg = await sendBlockWithRetry(jid, block)
      if (msg) {
        addLog('sent', `Bloco ${bi + 1}/${nl.blocks.length} → ${gname}`)
        if (msg.key?.id) sentKeys.push({ key_id: msg.key.id, newsletter_id: id, project_name: nl.projectName || null, jid })
        sentThisGroup++
      } else {
        groupOk = false
        hadError = true
        addLog('error', `Bloco ${bi + 1} → ${gname} não enviado`)
        // Se nem o primeiro bloco saiu, o grupo está travado — pula pro próximo.
        if (sentThisGroup === 0) {
          addLog('error', `Grupo "${gname}" sem resposta — pulando para o próximo`)
          break
        }
      }
      // Pausa entre blocos (menos no último bloco do grupo).
      if (bi < nl.blocks.length - 1) {
        await sleep(rand(settings.blockDelayMin, settings.blockDelayMax) * 1000)
      }
    }

    ;(groupOk ? okGroups : failedGroups).push(gname)

    // Persiste o progresso depois de cada grupo.
    await updateNewsletter(id, { log })

    // Pausa maior entre grupos (menos depois do último grupo).
    if (gi < nl.groupJids.length - 1) {
      await sleep(rand(settings.groupDelayMin, settings.groupDelayMax) * 1000)
    }
  }

  const finalStatus = hadError ? 'failed' : 'sent'
  addLog('end', hadError ? 'Concluído com erros' : 'Concluído com sucesso')

  // Guarda os ids das mensagens enviadas para contabilizar reações depois.
  if (USE_SUPABASE && supabase && sentKeys.length) {
    try {
      await supabase.from('sent_messages').insert(sentKeys)
    } catch (e) {
      console.error('Falha ao guardar sent_messages:', e?.message)
    }
  }

  // Avisa a Clara no próprio WhatsApp como foi o disparo.
  const total = nl.groupJids.length
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  let aviso = hadError
    ? `⚠️ *${nl.title}*\nEnviado em ${okGroups.length}/${total} grupos.\nFalhou em: ${failedGroups.join(', ')}\n🕒 ${hora} (Brasília)`
    : `✅ *${nl.title}*\nEnviado com sucesso nos ${total} grupos!\n🕒 ${hora} (Brasília)`
  await sendSelfNotification(aviso)

  if (nl.repeatDaily) {
    // Reagenda para o mesmo horário no dia seguinte.
    const next = new Date(nl.scheduledAt)
    next.setDate(next.getDate() + 1)
    addLog('reschedule', `Reagendado para ${next.toISOString()}`)
    await updateNewsletter(id, {
      status: 'pending',
      scheduledAt: next.toISOString(),
      sentAt: new Date().toISOString(),
      log,
    })
  } else {
    await updateNewsletter(id, { status: finalStatus, sentAt: new Date().toISOString(), log })
  }

  return { ok: !hadError }
}

async function tick() {
  if (running) return
  if (!isConnected()) return

  const now = Date.now()
  const all = await listNewsletters()
  const due = all.filter(
    (n) => n.status === 'pending' && new Date(n.scheduledAt).getTime() <= now
  )
  if (due.length === 0) return

  running = true
  try {
    for (const nl of due) {
      await sendNewsletter(nl.id)
    }
  } finally {
    running = false
  }
}

export function startScheduler() {
  setInterval(() => {
    tick().catch((e) => console.error('Erro no agendador:', e?.message))
  }, 20_000)
  console.log('⏰ Agendador ativo (verifica a cada 20s)')
}

// Verifica e dispara o que está vencido UMA vez (usado pelo GitHub Actions).
export async function runDueOnce() {
  if (!isConnected()) return { ok: false, error: 'WhatsApp não conectado', sent: 0 }
  const now = Date.now()
  const all = await listNewsletters()
  const due = all.filter((n) => n.status === 'pending' && new Date(n.scheduledAt).getTime() <= now)
  for (const nl of due) {
    await sendNewsletter(nl.id)
  }
  return { ok: true, sent: due.length }
}

export function isSending() {
  return running
}
