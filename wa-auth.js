// Guarda a sessão do WhatsApp (credenciais + chaves do Baileys) no Supabase,
// na tabela wa_auth. Assim a sessão sobrevive a reinícios e re-deploys do host,
// e a Clara não precisa reescanear o QR. Espelha a lógica do useMultiFileAuthState.
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'

const TABLE = 'wa_auth'

async function readKey(key) {
  const { data, error } = await supabase.from(TABLE).select('value').eq('key', key).maybeSingle()
  if (error) throw error
  if (!data) return null
  // Reconstrói Buffers etc. a partir do JSON.
  return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver)
}

async function writeKey(key, value) {
  const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer))
  const { error } = await supabase.from(TABLE).upsert({ key, value: serialized })
  if (error) throw error
}

async function removeKey(key) {
  await supabase.from(TABLE).delete().eq('key', key)
}

export async function useSupabaseAuthState() {
  const creds = (await readKey('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await readKey(`${type}-${id}`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              result[id] = value
            })
          )
          return result
        },
        set: async (data) => {
          const tasks = []
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id]
              const key = `${type}-${id}`
              tasks.push(value ? writeKey(key, value) : removeKey(key))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: () => writeKey('creds', creds),
    // Apaga toda a sessão (usado no logout).
    clearAuth: async () => {
      await supabase.from(TABLE).delete().neq('key', '')
    },
  }
}
