// Conexão com o WhatsApp via Baileys (aparelho vinculado, igual ao WhatsApp Web).
// Mantém o estado em memória e expõe funções para o resto do app.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import QRCode from 'qrcode'
import path from 'path'
import { fileURLToPath } from 'url'
import { USE_SUPABASE, supabase } from './supabase.js'
import { useSupabaseAuthState } from './wa-auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.join(__dirname, 'data', 'auth')

// Carrega a sessão do Supabase (na nuvem) ou de arquivos locais.
let clearSupabaseAuth = null
async function loadAuth() {
  if (USE_SUPABASE) {
    const a = await useSupabaseAuthState()
    clearSupabaseAuth = a.clearAuth
    return a
  }
  return useMultiFileAuthState(AUTH_DIR)
}

const logger = pino({ level: 'silent' })

// Estado compartilhado, lido pela API.
export const state = {
  status: 'disconnected', // disconnected | connecting | qr | connected
  qr: null, // data URL da imagem do QR Code
  me: null, // { id, name }
  groups: [], // [{ jid, name, size }]
  lastError: null,
}

let sock = null
let connecting = false // trava só a fase de setup, não o ciclo todo

async function refreshGroups() {
  try {
    const all = await sock.groupFetchAllParticipating()
    state.groups = Object.values(all)
      .map((g) => ({
        jid: g.id,
        name: g.subject || '(sem nome)',
        size: g.participants?.length ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    // Salva a lista no Supabase para o site online (que não tem WhatsApp) poder lê-la.
    if (USE_SUPABASE && supabase && state.groups.length) {
      const rows = state.groups.map((g) => ({ jid: g.jid, data: g }))
      await supabase.from('wa_groups').upsert(rows)
    }
  } catch (err) {
    console.error('Falha ao buscar grupos:', err?.message)
  }
}

export async function connect() {
  // `connecting` trava apenas a montagem do socket (evita setup duplicado).
  // Não usamos state.status aqui, senão a reconexão pós-scan (515) nunca roda.
  if (connecting || state.status === 'connected') return
  connecting = true
  state.status = 'connecting'
  state.lastError = null

  try {
    const { state: authState, saveCreds } = await loadAuth()
    let version
    try {
      ;({ version } = await fetchLatestBaileysVersion())
    } catch {
      /* sem internet pra checar a versão — usa a padrão do Baileys */
    }

    sock = makeWASocket({
      version,
      auth: authState,
      logger,
      printQRInTerminal: false,
      browser: ['Newsletter Alunos', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
    })

    sock.ev.on('creds.update', saveCreds)

    // Monitoramento: registra entradas e saídas de pessoas nos grupos.
    sock.ev.on('group-participants.update', async (ev) => {
      if (!USE_SUPABASE || !supabase) return
      if (ev.action !== 'add' && ev.action !== 'remove') return
      const g = state.groups.find((x) => x.jid === ev.id)
      const gname = g?.name || ev.id
      try {
        await supabase.from('group_events').insert(
          ev.participants.map((p) => ({ jid: ev.id, group_name: gname, action: ev.action, participant: p }))
        )
        if (g) {
          const delta = ev.action === 'add' ? ev.participants.length : -ev.participants.length
          g.size = Math.max(0, g.size + delta)
          await supabase.from('wa_groups').upsert({ jid: g.jid, data: g })
        }
      } catch (e) {
        console.error('Falha ao registrar evento de grupo:', e?.message)
      }
    })

    // Reações: conta reações às mensagens que ENVIAMOS (engajamento dos devocionais).
    sock.ev.on('messages.reaction', async (reactions) => {
      if (!USE_SUPABASE || !supabase) return
      for (const r of reactions) {
        const keyId = r.key?.id
        if (!keyId) continue
        try {
          // só registra se for reação a uma mensagem nossa (está em sent_messages)
          const { data: sm } = await supabase.from('sent_messages').select('key_id').eq('key_id', keyId).maybeSingle()
          if (!sm) continue
          const reactor = r.reaction?.key?.participant || r.reaction?.key?.remoteJid || 'desconhecido'
          const emoji = r.reaction?.text || ''
          if (!emoji) {
            await supabase.from('reactions').delete().eq('key_id', keyId).eq('reactor', reactor)
          } else {
            await supabase.from('reactions').upsert({ key_id: keyId, reactor, emoji, at: new Date().toISOString() })
          }
        } catch (e) {
          console.error('Falha ao registrar reação:', e?.message)
        }
      }
    })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        state.status = 'qr'
        state.qr = await QRCode.toDataURL(qr, { margin: 1, scale: 6 })
        console.log('📱 QR Code pronto — abra http://localhost:3000 e escaneie.')
      }

      if (connection === 'open') {
        state.status = 'connected'
        state.qr = null
        state.me = {
          id: sock.user?.id,
          name: sock.user?.name || sock.user?.verifiedName || 'WhatsApp',
        }
        await refreshGroups()
        console.log(`✅ WhatsApp conectado como "${state.me.name}" · ${state.groups.length} grupos.`)
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut
        sock = null

        if (loggedOut) {
          // Sessão encerrada (desvinculou pelo celular). Limpa estado.
          state.status = 'disconnected'
          state.qr = null
          state.me = null
          state.groups = []
        } else {
          // Inclui o 515 (restart required) que o WhatsApp manda logo após
          // escanear o QR — precisamos religar o socket para a conexão abrir.
          state.status = 'connecting'
          console.log(`↻ Reconectando (motivo ${code ?? '?'})…`)
          setTimeout(() => {
            connect().catch((e) => console.error('Reconexão falhou:', e?.message))
          }, 2000)
        }
      }
    })
  } catch (err) {
    // Falhou ANTES de abrir o socket (ex: internet caiu, Mac acabou de acordar).
    // Em vez de travar em "connecting", tenta de novo em 15s — auto-recupera.
    console.error('⚠️ Falha ao conectar — nova tentativa em 15s:', err?.message)
    sock = null
    state.status = 'connecting'
    setTimeout(() => connect().catch(() => {}), 15000)
  } finally {
    connecting = false
  }
}

export async function logout() {
  try {
    if (sock) await sock.logout()
  } catch {
    /* ignore */
  }
  try {
    if (clearSupabaseAuth) await clearSupabaseAuth()
  } catch {
    /* ignore */
  }
  sock = null
  state.status = 'disconnected'
  state.qr = null
  state.me = null
  state.groups = []
}

export async function fetchGroups() {
  if (state.status !== 'connected') throw new Error('WhatsApp não está conectado')
  await refreshGroups()
  return state.groups
}

// Envia um texto para um grupo. Lança erro se não conectado.
// Retorna a mensagem enviada (com .key.id) para rastrear reações.
export async function sendText(jid, text) {
  if (state.status !== 'connected' || !sock) {
    throw new Error('WhatsApp não está conectado')
  }
  return await sock.sendMessage(jid, { text })
}

export function isConnected() {
  return state.status === 'connected'
}

// Envia uma mensagem para o próprio número da Clara (chat "Você"/mensagens salvas),
// usada para confirmar o resultado de cada disparo. Falha silenciosamente.
export async function sendSelfNotification(text) {
  try {
    if (state.status !== 'connected' || !sock?.user?.id) return
    const me = jidNormalizedUser(sock.user.id)
    await sock.sendMessage(me, { text })
  } catch (err) {
    console.error('Falha ao enviar notificação própria:', err?.message)
  }
}
