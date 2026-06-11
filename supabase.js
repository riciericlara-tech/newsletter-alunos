// Cliente Supabase compartilhado. Só é ativado se as variáveis de ambiente
// estiverem definidas; caso contrário o app usa armazenamento local (data/db.json).
import { createClient } from '@supabase/supabase-js'

export const USE_SUPABASE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)

export const supabase = USE_SUPABASE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })
  : null

if (USE_SUPABASE) console.log('🗄️  Armazenamento: Supabase')
else console.log('🗄️  Armazenamento: arquivo local (data/db.json)')
