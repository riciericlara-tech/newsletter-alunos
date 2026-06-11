// Agendador: a cada 20s verifica newsletters vencidas e dispara.
// O envio é feito grupo por grupo, bloco por bloco, com intervalos
// aleatórios entre as mensagens para reduzir a chance de bloqueio.

import { listNewsletters, getNewsletter, updateNewsletter, getSettings } from './db.js'
import { sendText, isConnected, state as waState } from './whatsapp.js'

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

  for (let gi = 0; gi < nl.groupJids.length; gi++) {
    const jid = nl.groupJids[gi]
    const gname = groupName(jid)

    for (let bi = 0; bi < nl.blocks.length; bi++) {
      const block = nl.blocks[bi]
      if (!block.trim()) continue
      try {
        await sendText(jid, block)
        addLog('sent', `Bloco ${bi + 1}/${nl.blocks.length} → ${gname}`)
      } catch (err) {
        hadError = true
        addLog('error', `Falha no bloco ${bi + 1} → ${gname}: ${err?.message}`)
      }
      // Pausa entre blocos (menos no último bloco do grupo).
      if (bi < nl.blocks.length - 1) {
        await sleep(rand(settings.blockDelayMin, settings.blockDelayMax) * 1000)
      }
    }

    // Persiste o progresso depois de cada grupo.
    await updateNewsletter(id, { log })

    // Pausa maior entre grupos (menos depois do último grupo).
    if (gi < nl.groupJids.length - 1) {
      await sleep(rand(settings.groupDelayMin, settings.groupDelayMax) * 1000)
    }
  }

  const finalStatus = hadError ? 'failed' : 'sent'
  addLog('end', hadError ? 'Concluído com erros' : 'Concluído com sucesso')

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
