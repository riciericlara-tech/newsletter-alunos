// Servidor Express: serve a interface e expõe a API REST.
// Roda tudo num processo só — `npm start` localmente ou no host na nuvem.

import 'dotenv/config' // carrega variáveis de um arquivo .env (uso local)
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { connect, logout, fetchGroups, state as waState } from './whatsapp.js'
import {
  listNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletter,
  deleteNewsletter,
  getSettings,
  updateSettings,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from './db.js'
import { startScheduler, sendNewsletter, isSending } from './scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const PASSWORD = process.env.APP_PASSWORD // proteção de acesso (obrigatória na nuvem)

app.use(express.json({ limit: '2mb' }))

// --- Senha de acesso (HTTP Basic Auth) ---
// Se APP_PASSWORD estiver definida, todo acesso exige a senha. O navegador
// mostra uma janelinha de login. Sem senha definida (uso local), fica aberto.
if (PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || ''
    const [, b64] = header.split(' ')
    const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':')
    if (pass === PASSWORD) return next()
    res.set('WWW-Authenticate', 'Basic realm="Newsletter Alunos"')
    return res.status(401).send('Acesso restrito. Informe a senha.')
  })
}

app.use(express.static(path.join(__dirname, 'public')))

// Wrapper para rotas async: encaminha erros como 500.
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('Erro na rota:', err?.message)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  })

// --- Status da conexão WhatsApp ---
app.get('/api/status', (req, res) => {
  res.json({
    status: waState.status,
    qr: waState.qr,
    me: waState.me,
    groupCount: waState.groups.length,
    sending: isSending(),
  })
})

app.post('/api/connect', h(async (req, res) => {
  await connect()
  res.json({ ok: true })
}))

app.post('/api/logout', h(async (req, res) => {
  await logout()
  res.json({ ok: true })
}))

// --- Grupos ---
app.get('/api/groups', (req, res) => {
  res.json(waState.groups)
})

app.post('/api/groups/refresh', h(async (req, res) => {
  res.json(await fetchGroups())
}))

// --- Newsletters ---
app.get('/api/newsletters', h(async (req, res) => {
  res.json(await listNewsletters())
}))

app.get('/api/newsletters/:id', h(async (req, res) => {
  const nl = await getNewsletter(req.params.id)
  if (!nl) return res.status(404).json({ error: 'Não encontrada' })
  res.json(nl)
}))

app.post('/api/newsletters', h(async (req, res) => {
  const { title, blocks, groupJids, scheduledAt, repeatDaily, projectId, projectName } = req.body
  if (!Array.isArray(blocks) || blocks.length === 0)
    return res.status(400).json({ error: 'Sem blocos para enviar' })
  if (!Array.isArray(groupJids) || groupJids.length === 0)
    return res.status(400).json({ error: 'Selecione ao menos um grupo' })
  if (!scheduledAt) return res.status(400).json({ error: 'Defina data e horário' })
  const nl = await createNewsletter({ title, blocks, groupJids, scheduledAt, repeatDaily, projectId, projectName })
  res.json(nl)
}))

app.put('/api/newsletters/:id', h(async (req, res) => {
  const nl = await updateNewsletter(req.params.id, req.body)
  if (!nl) return res.status(404).json({ error: 'Não encontrada' })
  res.json(nl)
}))

app.delete('/api/newsletters/:id', h(async (req, res) => {
  await deleteNewsletter(req.params.id)
  res.json({ ok: true })
}))

// Dispara imediatamente (teste / envio manual).
app.post('/api/newsletters/:id/send-now', (req, res) => {
  res.json({ ok: true, started: true })
  // Roda em background para não travar a resposta.
  sendNewsletter(req.params.id).catch((e) => console.error('Erro no disparo manual:', e?.message))
})

// --- Projetos (conjuntos de grupos) ---
app.get('/api/projects', h(async (req, res) => {
  res.json(await listProjects())
}))

app.post('/api/projects', h(async (req, res) => {
  const { name, groupJids } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: 'Dê um nome ao projeto' })
  if (!Array.isArray(groupJids) || groupJids.length === 0)
    return res.status(400).json({ error: 'Selecione ao menos um grupo' })
  res.json(await createProject({ name, groupJids }))
}))

app.put('/api/projects/:id', h(async (req, res) => {
  const p = await updateProject(req.params.id, req.body)
  if (!p) return res.status(404).json({ error: 'Projeto não encontrado' })
  res.json(p)
}))

app.delete('/api/projects/:id', h(async (req, res) => {
  await deleteProject(req.params.id)
  res.json({ ok: true })
}))

// --- Configurações ---
app.get('/api/settings', h(async (req, res) => res.json(await getSettings())))
app.put('/api/settings', h(async (req, res) => res.json(await updateSettings(req.body))))

app.listen(PORT, () => {
  console.log(`\n📬 Newsletter Alunos rodando na porta ${PORT}\n`)
  if (!PASSWORD) console.log('⚠️  Sem APP_PASSWORD definida — acesso SEM senha (ok local, NÃO use assim na nuvem).')
  startScheduler()
  // Tenta reconectar automaticamente se já houver sessão salva.
  connect().catch((e) => console.error('Conexão inicial:', e?.message))
})
