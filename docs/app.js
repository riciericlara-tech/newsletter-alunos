// Site online: fala DIRETO com o Supabase (sem servidor). Mesma interface.

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

// ---------- Conexão com o Supabase (direto do navegador) ----------
const SB_URL = 'https://gtptvzitekmlobisazmz.supabase.co'
const SB_ANON = 'sb_publishable_0JcR3zYliWmMm2ppDHksyg_bWLSAFh2' // chave pública (segura no navegador)
const sb = window.supabase.createClient(SB_URL, SB_ANON)

const newId = (p) => p + Date.now().toString(36) + Math.floor(performance.now()).toString(36)
const DEFAULT_SETTINGS = { blockDelayMin: 4, blockDelayMax: 9, groupDelayMin: 30, groupDelayMax: 75 }

// Adaptador: traduz as mesmas chamadas "/api/..." para operações no Supabase,
// assim toda a interface continua funcionando sem alteração.
const api = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase()
  const body = opts.body ? JSON.parse(opts.body) : null
  const [, res, id, action] = url.match(/^\/api\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/) || []
  const fail = (e) => { throw new Error(e.message || String(e)) }

  if (res === 'newsletters') {
    if (action === 'send-now') {
      const { data } = await sb.from('newsletters').select('data').eq('id', id).maybeSingle()
      if (data?.data) {
        const merged = { ...data.data, scheduledAt: new Date().toISOString(), status: 'pending' }
        await sb.from('newsletters').update({ data: merged }).eq('id', id)
      }
      return { ok: true }
    }
    if (method === 'GET' && !id) {
      const { data, error } = await sb.from('newsletters').select('data')
      if (error) fail(error)
      return data.map((r) => r.data)
    }
    if (method === 'GET') {
      const { data } = await sb.from('newsletters').select('data').eq('id', id).maybeSingle()
      return data?.data || null
    }
    if (method === 'POST') {
      const item = {
        id: newId('nl_'), title: body.title || 'Newsletter', blocks: body.blocks || [],
        groupJids: body.groupJids || [], projectId: body.projectId || null,
        projectName: body.projectName || null, scheduledAt: body.scheduledAt,
        repeatDaily: !!body.repeatDaily, status: body.status || 'pending',
        createdAt: new Date().toISOString(), sentAt: null, log: [],
      }
      const { error } = await sb.from('newsletters').insert({ id: item.id, data: item })
      if (error) fail(error)
      return item
    }
    if (method === 'PUT') {
      const { data } = await sb.from('newsletters').select('data').eq('id', id).maybeSingle()
      if (!data) fail({ message: 'Não encontrada' })
      const merged = { ...data.data, ...body }
      await sb.from('newsletters').update({ data: merged }).eq('id', id)
      return merged
    }
    if (method === 'DELETE') {
      await sb.from('newsletters').delete().eq('id', id)
      return { ok: true }
    }
  }

  if (res === 'projects') {
    if (method === 'GET') {
      const { data, error } = await sb.from('projects').select('data')
      if (error) fail(error)
      return data.map((r) => r.data)
    }
    if (method === 'POST') {
      if (!body.name || !body.name.trim()) fail({ message: 'Dê um nome ao projeto' })
      if (!Array.isArray(body.groupJids) || !body.groupJids.length) fail({ message: 'Selecione ao menos um grupo' })
      const item = { id: newId('pj_'), name: body.name.trim(), groupJids: body.groupJids }
      const { error } = await sb.from('projects').insert({ id: item.id, data: item })
      if (error) fail(error)
      return item
    }
    if (method === 'PUT') {
      const { data } = await sb.from('projects').select('data').eq('id', id).maybeSingle()
      if (!data) fail({ message: 'Projeto não encontrado' })
      const item = { ...data.data }
      if (body.name !== undefined) item.name = body.name.trim()
      if (body.groupJids !== undefined) item.groupJids = body.groupJids
      await sb.from('projects').update({ data: item }).eq('id', id)
      return item
    }
    if (method === 'DELETE') {
      await sb.from('projects').delete().eq('id', id)
      return { ok: true }
    }
  }

  if (res === 'settings') {
    if (method === 'GET') {
      const { data } = await sb.from('app_settings').select('data').eq('id', 1).maybeSingle()
      return { ...DEFAULT_SETTINGS, ...(data?.data || {}) }
    }
    if (method === 'PUT') {
      const cur = (await sb.from('app_settings').select('data').eq('id', 1).maybeSingle()).data?.data || {}
      const merged = { ...DEFAULT_SETTINGS, ...cur, ...body }
      await sb.from('app_settings').upsert({ id: 1, data: merged })
      return merged
    }
  }

  if (res === 'groups') {
    const { data, error } = await sb.from('wa_groups').select('data')
    if (error) fail(error)
    return data.map((r) => r.data).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  throw new Error('Rota não suportada: ' + url)
}

// ---------- Fuso horário ----------
// O público está no Brasil. Você digita sempre no HORÁRIO DE BRASÍLIA, esteja
// onde estiver. Estas funções convertem entre "hora de parede de Brasília" e o
// instante absoluto (UTC) que é gravado e disparado.
const TZ = 'America/Sao_Paulo'

// Quanto o fuso `timeZone` está adiantado/atrasado em relação ao UTC num dado instante (ms).
function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = {}
  dtf.formatToParts(date).forEach((x) => (p[x.type] = x.value))
  const hour = p.hour === '24' ? '00' : p.hour
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second)
  return asUTC - date.getTime()
}

// Converte "2026-06-11 07:00" (hora de parede de Brasília) no instante UTC correto.
function zonedToUTC(localStr) {
  const [d, t] = localStr.split(/[ T]/)
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, da, h, mi)
  const off = tzOffsetMs(TZ, new Date(guess))
  let utc = guess - off
  const off2 = tzOffsetMs(TZ, new Date(utc)) // reajuste para bordas de horário de verão
  if (off2 !== off) utc = guess - off2
  return new Date(utc)
}

// Descreve um horário escolhido nos dois fusos, para a Clara não se confundir.
function describeSchedule(localStr) {
  if (!localStr) return ''
  const utc = zonedToUTC(localStr)
  const opts = { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
  const br = utc.toLocaleString('pt-BR', { ...opts, timeZone: TZ })
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (localTz === TZ) return `🇧🇷 ${br} (horário de Brasília)`
  const here = utc.toLocaleString('pt-BR', opts) // fuso do navegador (onde a Clara está)
  const city = localTz.split('/').pop().replace(/_/g, ' ')
  return `🇧🇷 ${br} em Brasília  ·  ⏰ ${here} aqui (${city})`
}

// Converte um instante UTC (ISO) na "hora de parede de Brasília" no formato do
// calendário ("YYYY-MM-DD HH:mm"), para preencher o campo ao editar.
function utcToZonedInput(iso) {
  const p = {}
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso)).forEach((x) => (p[x.type] = x.value))
  const hour = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}`
}

let groups = []
let selectedJids = new Set()
let projects = []
let groupFilter = '' // busca na aba Compor

// ---------- Abas ----------
function showTab(name) {
  $$('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name))
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name))
  if (name === 'agenda') loadNewsletters()
  if (name === 'projetos') { renderPjGroupList(); renderProjectsList() }
  if (name === 'dashboard' && typeof loadDashboard === 'function') loadDashboard()
}
$$('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))

// ---------- Grupos ----------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

async function loadGroups() {
  try {
    groups = await api('/api/groups')
    await loadProjects()
    renderProjectCards()
  } catch {
    /* ignora */
  }
}

// Monta a lista de checkboxes de grupos num container, filtrando pela busca.
// `selSet` é o conjunto de selecionados; `onChange` roda a cada marcação.
function renderGroupCheckboxes(boxSel, selSet, filter, onChange) {
  const box = $(boxSel)
  if (groups.length === 0) {
    box.innerHTML = '<p class="text-sm text-slate-400 col-span-2">Nenhum grupo sincronizado ainda. Rode o app no seu Mac (<code>npm start</code>) uma vez para carregar a lista.</p>'
    return
  }
  const f = filter.trim().toLowerCase()
  const shown = groups.filter((g) => !f || g.name.toLowerCase().includes(f))
  if (shown.length === 0) {
    box.innerHTML = '<p class="text-sm text-slate-400 col-span-2">Nenhum grupo encontrado.</p>'
    return
  }
  box.innerHTML = shown
    .map(
      (g) => `
      <label class="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
        <input type="checkbox" value="${esc(g.jid)}" class="grp-cb w-4 h-4 accent-brand" ${selSet.has(g.jid) ? 'checked' : ''} />
        <span class="text-sm truncate" title="${esc(g.name)}">${esc(g.name)}</span>
        <span class="text-xs text-slate-400 ml-auto">${g.size}</span>
      </label>`
    )
    .join('')
  box.querySelectorAll('.grp-cb').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? selSet.add(cb.value) : selSet.delete(cb.value)
      onChange()
    })
  )
}

// Soma de membros de uma lista de grupos (usa o tamanho salvo em wa_groups).
function memberCount(jids) {
  return jids.reduce((s, j) => s + (groups.find((g) => g.jid === j)?.size || 0), 0)
}

// Seleção por CARDS DE PROJETO no Input de Envios.
function renderProjectCards() {
  const box = $('#project-cards')
  if (!box) return
  if (projects.length === 0) {
    box.innerHTML = '<p class="text-sm text-wa-muted col-span-2">Crie um projeto na aba <b>Projetos</b> para selecionar aqui.</p>'
    updateSelCount()
    return
  }
  box.innerHTML = projects
    .map((p) => {
      const active = projectIsActive(p)
      const members = memberCount(p.groupJids)
      return `<button type="button" data-pjcard="${p.id}" class="text-left p-3 rounded-2xl border-2 transition ${
        active ? 'border-wa-teal bg-wa-bubble/60' : 'border-white/60 glass hover:border-wa-greenlight'
      }">
        <div class="font-semibold text-wa-ink">${active ? '✅ ' : '📁 '}${esc(p.name)}</div>
        <div class="text-xs text-wa-muted mt-1">${p.groupJids.length} grupos · 👥 ${members} membros</div>
      </button>`
    })
    .join('')
  box.querySelectorAll('[data-pjcard]').forEach((b) =>
    b.addEventListener('click', () => applyProject(b.dataset.pjcard))
  )
  updateSelCount()
}

function updateSelCount() {
  const el = $('#sel-count')
  if (el) el.textContent = `${selectedJids.size} grupos selecionados`
}

async function loadProjects() {
  try {
    projects = await api('/api/projects')
  } catch {
    projects = []
  }
  renderProjectCards()
}

function projectIsActive(p) {
  return p.groupJids.length > 0 && p.groupJids.every((j) => selectedJids.has(j))
}

// Aplica/desaplica um projeto: se todos os grupos dele já estão marcados, desmarca; senão marca.
function applyProject(id) {
  const p = projects.find((x) => x.id === id)
  if (!p) return
  const valid = p.groupJids.filter((j) => groups.some((g) => g.jid === j))
  if (projectIsActive(p)) {
    valid.forEach((j) => selectedJids.delete(j))
  } else {
    valid.forEach((j) => selectedJids.add(j))
  }
  renderProjectCards()
}

// ---------- Aba Projetos (gerenciar) ----------
let pjSelected = new Set()
let pjFilter = ''
let editingProjectId = null

function renderPjGroupList() {
  renderGroupCheckboxes('#pj-group-list', pjSelected, pjFilter, updatePjCount)
  updatePjCount()
}
function updatePjCount() {
  $('#pj-sel-count').textContent = `${pjSelected.size} selecionados`
}

$('#pj-search').addEventListener('input', (e) => {
  pjFilter = e.target.value
  renderPjGroupList()
})

function pjResetForm() {
  editingProjectId = null
  pjSelected = new Set()
  pjFilter = ''
  $('#pj-name').value = ''
  $('#pj-search').value = ''
  $('#pj-form-title').textContent = 'Novo projeto'
  $('#pj-cancel').classList.add('hidden')
  $('#pj-msg').textContent = ''
  renderPjGroupList()
}

$('#pj-cancel').addEventListener('click', pjResetForm)

$('#pj-save').addEventListener('click', async () => {
  const name = $('#pj-name').value.trim()
  const msg = $('#pj-msg')
  if (!name) { msg.textContent = '⚠️ Dê um nome ao projeto.'; msg.className = 'text-sm text-amber-600'; return }
  if (pjSelected.size === 0) { msg.textContent = '⚠️ Selecione ao menos um grupo.'; msg.className = 'text-sm text-amber-600'; return }
  try {
    const body = JSON.stringify({ name, groupJids: [...pjSelected] })
    if (editingProjectId) {
      await api(`/api/projects/${editingProjectId}`, { method: 'PUT', body })
    } else {
      await api('/api/projects', { method: 'POST', body })
    }
    await loadProjects()
    pjResetForm()
    renderProjectsList()
    msg.textContent = '✅ Salvo!'
    msg.className = 'text-sm text-green-600'
    setTimeout(() => (msg.textContent = ''), 2000)
  } catch (e) {
    msg.textContent = '❌ ' + e.message
    msg.className = 'text-sm text-red-600'
  }
})

function renderProjectsList() {
  const box = $('#pj-list')
  if (projects.length === 0) {
    box.innerHTML = '<p class="text-sm text-slate-400 px-1">Nenhum projeto criado ainda.</p>'
    return
  }
  const groupName = (jid) => groups.find((g) => g.jid === jid)?.name || '(grupo saiu da lista)'
  box.innerHTML = projects
    .map(
      (p) => `
      <div class="bg-white rounded-2xl shadow-sm p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h4 class="font-semibold text-slate-800">📁 ${esc(p.name)}</h4>
            <p class="text-xs text-slate-400 mt-1">${p.groupJids.map((j) => esc(groupName(j))).join(', ')}</p>
          </div>
          <span class="text-xs text-slate-500 whitespace-nowrap">${p.groupJids.length} grupos</span>
        </div>
        <div class="flex gap-3 mt-3 text-sm">
          <button data-apply="${p.id}" class="text-brand-dark hover:underline">Usar na newsletter</button>
          <button data-edit="${p.id}" class="text-slate-500 hover:underline">Editar</button>
          <button data-delpj="${p.id}" class="text-red-500 hover:underline ml-auto">Excluir</button>
        </div>
      </div>`
    )
    .join('')

  box.querySelectorAll('[data-apply]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = projects.find((x) => x.id === b.dataset.apply)
      if (!p) return
      p.groupJids.filter((j) => groups.some((g) => g.jid === j)).forEach((j) => selectedJids.add(j))
      renderProjectCards()
      showTab('compor')
    })
  )
  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = projects.find((x) => x.id === b.dataset.edit)
      if (!p) return
      editingProjectId = p.id
      pjSelected = new Set(p.groupJids)
      $('#pj-name').value = p.name
      $('#pj-form-title').textContent = 'Editar projeto'
      $('#pj-cancel').classList.remove('hidden')
      renderPjGroupList()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  )
  box.querySelectorAll('[data-delpj]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = projects.find((x) => x.id === b.dataset.delpj)
      if (!confirm(`Excluir o projeto "${p?.name}"? (os grupos não são afetados)`)) return
      await api(`/api/projects/${b.dataset.delpj}`, { method: 'DELETE' })
      await loadProjects()
      renderProjectsList()
    })
  )
}

// ---------- Compor ----------
// Divide o texto em blocos. Separador = uma linha só com tracinhos/underlines
// (ex: ______ ou ------). Cada bloco vira uma mensagem do WhatsApp.
function parseBlocks(text) {
  return text
    .split(/^[ \t]*[_\-—–]{3,}[ \t]*$/m)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
}

// Converte o texto para HTML imitando a formatação do WhatsApp,
// para a prévia mostrar exatamente como o aluno vai ver.
function waFormat(text) {
  let t = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // ```monospace```
  t = t.replace(/```([\s\S]+?)```/g, '<code class="font-mono text-[13px]">$1</code>')
  // *negrito*  _itálico_  ~riscado~  (conteúdo não pode começar/terminar com espaço)
  t = t.replace(/(^|[\s(])\*(\S(?:[^*]*?\S)?)\*(?=[\s.,!?:;)]|$)/g, '$1<b>$2</b>')
  t = t.replace(/(^|[\s(])_(\S(?:[^_]*?\S)?)_(?=[\s.,!?:;)]|$)/g, '$1<i>$2</i>')
  t = t.replace(/(^|[\s(])~(\S(?:[^~]*?\S)?)~(?=[\s.,!?:;)]|$)/g, '$1<s>$2</s>')
  return t
}

$('#f-content').addEventListener('input', (e) => {
  $('#block-count').textContent = parseBlocks(e.target.value).length
})

$('#f-datetime').addEventListener('input', (e) => {
  $('#dt-helper').textContent = describeSchedule(e.target.value)
})

// Calendário visual (flatpickr) no campo de data/horário.
let fp = null
let editingNewsletterId = null // id da newsletter em edição (null = criando nova)

if (window.flatpickr) {
  if (window.flatpickr.l10ns?.pt) window.flatpickr.localize(window.flatpickr.l10ns.pt)
  fp = window.flatpickr('#f-datetime', {
    enableTime: true,
    time_24hr: true,
    dateFormat: 'Y-m-d H:i', // valor interno (que o código converte)
    altInput: true,
    altFormat: 'D, d/m/Y \\à\\s H:i', // exibição amigável
    minuteIncrement: 5,
    defaultHour: 7,
    defaultMinute: 0,
    onChange: () => $('#f-datetime').dispatchEvent(new Event('input')),
  })
}

function setMsg(text, kind) {
  const msg = $('#compor-msg')
  const colors = { ok: 'text-green-600', warn: 'text-amber-600', err: 'text-red-600' }
  msg.textContent = text
  msg.className = 'text-sm w-full sm:w-auto ' + (colors[kind] || '')
}

// Valida e devolve os dados do formulário, ou null se inválido (já mostra aviso).
function collectForm({ needDate }) {
  const blocks = parseBlocks($('#f-content').value)
  const groupJids = [...selectedJids]
  const dt = $('#f-datetime').value
  if (blocks.length === 0) { setMsg('⚠️ Escreva o conteúdo.', 'warn'); return null }
  if (groupJids.length === 0) { setMsg('⚠️ Selecione ao menos um grupo.', 'warn'); return null }
  if (needDate && !dt) { setMsg('⚠️ Defina data e horário.', 'warn'); return null }
  return {
    title: $('#f-title').value || 'Newsletter',
    blocks,
    groupJids,
    dt,
    repeatDaily: $('#f-repeat').checked,
  }
}

function resetForm() {
  $('#f-title').value = ''
  $('#f-content').value = ''
  if (fp) fp.clear()
  else $('#f-datetime').value = ''
  $('#dt-helper').textContent = ''
  $('#f-repeat').checked = false
  $('#block-count').textContent = '0'
  selectedJids.clear()
  renderProjectCards()
  setEditMode(false)
}

// Alterna a interface entre "criar nova" e "editar existente".
function setEditMode(on) {
  if (!on) editingNewsletterId = null
  $('#edit-banner').classList.toggle('hidden', !on)
  $('#btn-cancel-edit').classList.toggle('hidden', !on)
  $('#btn-draft').textContent = on ? '💾 Salvar alterações' : '💾 Salvar rascunho'
}

// Carrega uma newsletter agendada no formulário para visualizar/editar.
function loadNewsletterIntoForm(nl) {
  editingNewsletterId = nl.id
  $('#f-title').value = nl.title || ''
  $('#f-content').value = nl.blocks.join('\n\n______\n\n')
  $('#block-count').textContent = nl.blocks.length
  selectedJids = new Set(nl.groupJids)
  renderProjectCards()
  $('#f-repeat').checked = !!nl.repeatDaily
  if (fp) fp.setDate(utcToZonedInput(nl.scheduledAt), true)
  else {
    $('#f-datetime').value = utcToZonedInput(nl.scheduledAt)
    $('#f-datetime').dispatchEvent(new Event('input'))
  }
  setEditMode(true)
  setMsg('', null)
  showTab('compor')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Cria a newsletter. Se sendNow=true, agenda para agora e dispara na hora.
// Descobre a qual projeto a seleção pertence (match exato dos grupos, senão
// o maior projeto totalmente contido na seleção). Usado para agrupar a lista.
function matchProject(jids) {
  const sel = new Set(jids)
  const exact = projects.find(
    (p) => p.groupJids.length === sel.size && p.groupJids.every((j) => sel.has(j))
  )
  if (exact) return exact
  const contained = projects
    .filter((p) => p.groupJids.length > 0 && p.groupJids.every((j) => sel.has(j)))
    .sort((a, b) => b.groupJids.length - a.groupJids.length)
  return contained[0] || null
}

// mode: 'draft' (salvar rascunho) | 'schedule' (agendar p/ data) | 'now' (enviar já)
async function submitNewsletter(mode) {
  const editing = editingNewsletterId
  const data = collectForm({ needDate: mode === 'schedule' })
  if (!data) return
  setMsg('', null)
  const proj = matchProject(data.groupJids)
  const payload = {
    title: data.title,
    blocks: data.blocks,
    groupJids: data.groupJids,
    projectId: proj?.id || null,
    projectName: proj?.name || null,
    status: mode === 'draft' ? 'draft' : 'pending',
    scheduledAt: mode === 'schedule' ? zonedToUTC(data.dt).toISOString() : new Date().toISOString(),
    repeatDaily: mode === 'schedule' ? data.repeatDaily : false,
  }
  try {
    let nlId = editing
    if (editing) {
      await api(`/api/newsletters/${editing}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      const nl = await api('/api/newsletters', { method: 'POST', body: JSON.stringify(payload) })
      nlId = nl.id
    }
    if (mode === 'now') {
      await api(`/api/newsletters/${nlId}/send-now`, { method: 'POST' })
      setMsg('🚀 Disparo iniciado! Acompanhe em "Disparos".', 'ok')
    } else if (mode === 'draft') {
      setMsg('💾 Rascunho salvo! Dispare quando quiser na aba "Disparos".', 'ok')
    } else {
      setMsg('✅ Agendada com sucesso!', 'ok')
    }
    resetForm()
    setTimeout(() => showTab('agenda'), 900)
  } catch (e) {
    setMsg('❌ ' + e.message, 'err')
  }
}

$('#btn-draft').addEventListener('click', () => submitNewsletter('draft'))
$('#btn-sendnow').addEventListener('click', () => {
  if (!confirm('Enviar AGORA para os grupos selecionados? As mensagens vão sair de imediato.')) return
  submitNewsletter('now')
})
$('#btn-cancel-edit').addEventListener('click', () => {
  resetForm()
  showTab('agenda')
})

// ---------- Pré-visualização (estilo WhatsApp) ----------
function openPreview() {
  const blocks = parseBlocks($('#f-content').value)
  if (blocks.length === 0) { setMsg('⚠️ Escreva o conteúdo para pré-visualizar.', 'warn'); return }

  const firstGroup = groups.find((g) => selectedJids.has(g.jid))
  $('#preview-group-name').textContent = firstGroup ? firstGroup.name : 'Grupo de alunos'

  $('#preview-chat').innerHTML = blocks
    .map(
      (b) => `
      <div class="flex justify-end">
        <div class="bg-wa-bubble rounded-lg rounded-tr-sm px-2.5 py-1.5 max-w-[85%] shadow-sm">
          <div class="text-[14px] leading-snug text-wa-ink whitespace-pre-wrap break-words">${waFormat(b)}</div>
          <div class="text-[10px] text-wa-muted text-right mt-0.5">agora <span class="text-wa-tick">✓✓</span></div>
        </div>
      </div>`
    )
    .join('')

  const nGroups = selectedJids.size
  const dt = $('#f-datetime').value
  $('#preview-summary').textContent =
    `${blocks.length} mensagens` +
    (nGroups ? ` · ${nGroups} grupo(s)` : ' · nenhum grupo selecionado') +
    (dt ? ` · 🇧🇷 ${fmtDate(zonedToUTC(dt).toISOString())}` : '')

  $('#preview-modal').classList.remove('hidden')
}

function closePreview() {
  $('#preview-modal').classList.add('hidden')
}

$('#btn-preview').addEventListener('click', openPreview)
$('#preview-close').addEventListener('click', closePreview)
$('#preview-modal').addEventListener('click', (e) => {
  if (e.target.id === 'preview-modal') closePreview()
})
$('#preview-schedule').addEventListener('click', () => {
  closePreview()
  submitNewsletter('draft')
})
$('#preview-sendnow').addEventListener('click', () => {
  if (!confirm('Enviar AGORA para os grupos selecionados? As mensagens vão sair de imediato.')) return
  closePreview()
  submitNewsletter('now')
})

// ---------- Disparos (Agendadas + Enviadas) ----------
// Sempre exibe em horário de Brasília (o público está no Brasil).
function fmtDate(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function statusInfo(nl) {
  switch (nl.status) {
    case 'draft': return { label: 'Rascunho', cls: 'bg-wa-bubble text-wa-tealdark', icon: '📝' }
    case 'pending': return { label: 'Agendada', cls: 'bg-amber-50 text-amber-700', icon: '🕓' }
    case 'sending': return { label: 'Enviando…', cls: 'bg-blue-50 text-blue-700', icon: '📤' }
    case 'sent': return { label: 'Enviada', cls: 'bg-wa-green/10 text-wa-teal', icon: '<span class="text-wa-tick">✓✓</span>' }
    case 'failed': return { label: 'Com erros', cls: 'bg-red-50 text-red-600', icon: '⚠️' }
    default: return { label: nl.status, cls: 'bg-slate-100 text-slate-500', icon: '' }
  }
}

// Texto sem marcadores de formatação, para o resumo (snippet) do card.
function plainText(s) {
  return String(s || '').replace(/```/g, '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim()
}

// ---------- Leitura inteligente do conteúdo (heurística) ----------
// Detecta referência bíblica tipo "Salmos 28:7", "Lamentações 3:22-23", "1 João 4:8".
function extractVerse(text) {
  const m = String(text).match(/\b((?:[1-3]\s)?[A-Za-zÀ-ú]{3,}(?:\sdos?\s[A-Za-zÀ-ú]+|\s[A-Za-zÀ-ú]+)?)\s+(\d{1,3}):(\d{1,3}(?:-\d{1,3})?)/)
  return m ? `${m[1].trim()} ${m[2]}:${m[3]}` : null
}
// Extrai uma data do título/conteúdo (ex: "Devocional 20/06") → objeto Date.
function extractDate(nl) {
  const src = (nl.title || '') + ' ' + (nl.blocks?.[0] || '')
  const m = src.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (!m) return null
  let yr = m[3] ? +m[3] : new Date().getFullYear()
  if (yr < 100) yr += 2000
  const d = new Date(yr, +m[2] - 1, +m[1])
  return isNaN(d.getTime()) ? null : d
}
function weekdayTag(d) {
  if (!d) return null
  return d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/-feira/, '')
}
// "Tema" = trecho após o bloco de "Reflexão", senão o bloco mais longo.
function extractTheme(blocks) {
  const plain = (blocks || []).map(plainText)
  const idx = plain.findIndex((b) => /reflex/i.test(b))
  let cand = idx >= 0 && plain[idx + 1] ? plain[idx + 1] : null
  if (!cand) cand = plain.slice(1).filter((b) => !extractVerse(b)).sort((a, b) => b.length - a.length)[0] || plain[0]
  if (!cand) return null
  const sentence = cand.split(/(?<=[.!?])\s/)[0]
  return sentence.length > 90 ? sentence.slice(0, 90) + '…' : sentence
}

// Card "inteligente" da Agenda de Envios (para rascunhos prontos).
function renderAgendaCard(nl) {
  const verse = (nl.blocks || []).map(extractVerse).find(Boolean)
  const wd = weekdayTag(extractDate(nl))
  const theme = extractTheme(nl.blocks)
  const members = memberCount(nl.groupJids)
  return `
    <div class="glass rounded-2xl p-3 flex flex-col">
      <div class="flex items-center justify-between mb-1">
        ${wd
          ? `<span class="text-[10px] uppercase tracking-wide font-bold text-wa-teal bg-wa-bubble px-2 py-0.5 rounded-full">${esc(wd)}</span>`
          : `<span class="text-[10px] uppercase tracking-wide font-bold text-wa-muted bg-wa-panel px-2 py-0.5 rounded-full">pronto</span>`}
        <span class="text-[11px] text-wa-muted truncate ml-2">${nl.projectName ? '📁 ' + esc(nl.projectName) : ''}</span>
      </div>
      <h3 class="font-semibold text-wa-ink leading-tight">${esc(nl.title)}</h3>
      ${verse ? `<p class="text-[12px] text-wa-teal mt-1">📖 ${esc(verse)}</p>` : ''}
      ${theme ? `<p class="text-[12px] text-wa-muted mt-1 line-clamp-2">${esc(theme)}</p>` : ''}
      <p class="text-[11px] text-wa-muted/80 mt-2">${nl.blocks.length} msgs · ${nl.groupJids.length} grupos · 👥 ${members}</p>
      <div class="flex items-center gap-2 mt-3 pt-2 border-t border-white/50">
        <button data-send="${nl.id}" class="flex-1 bg-wa-green hover:bg-wa-teal text-white text-sm font-semibold py-1.5 rounded-lg transition">🚀 Disparar</button>
        <button data-editnl="${nl.id}" class="text-wa-teal text-sm hover:underline px-2" title="Editar">✏️</button>
        <button data-del="${nl.id}" class="text-red-500 text-sm hover:underline px-2" title="Excluir">🗑</button>
      </div>
    </div>`
}

function renderNewsletterCard(nl) {
  const st = statusInfo(nl)
  const snippet = plainText(nl.blocks[0])
  const editable = nl.status === 'draft' || nl.status === 'pending'
  const when = nl.status === 'draft' ? 'rascunho' : fmtDate(nl.scheduledAt)
  return `
    <div class="glass rounded-2xl overflow-hidden">
      <div class="flex items-start gap-3 p-3">
        <div class="w-11 h-11 rounded-2xl bg-wa-green/15 grid place-items-center text-lg shrink-0">📬</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-wa-ink truncate">${esc(nl.title)}</span>
            <span class="text-[11px] text-wa-muted shrink-0">${when}</span>
          </div>
          <p class="text-[13px] text-wa-muted truncate mt-0.5">${esc(snippet)}</p>
          <p class="text-[11px] text-wa-muted/80 mt-1">${nl.blocks.length} msgs · ${nl.groupJids.length} grupos${nl.repeatDaily ? ' · 🔁 diária' : ''}</p>
        </div>
        <span class="text-[11px] px-2 py-1 rounded-full whitespace-nowrap shrink-0 ${st.cls}">${st.icon} ${st.label}</span>
      </div>
      <div class="flex gap-3 px-3 py-2 bg-white/40 border-t border-white/50 text-sm">
        ${editable ? `<button data-send="${nl.id}" class="text-wa-teal font-semibold hover:underline">🚀 Disparar agora</button>` : ''}
        ${editable ? `<button data-editnl="${nl.id}" class="text-wa-teal hover:underline">✏️ Ver / editar</button>` : ''}
        <button data-del="${nl.id}" class="text-red-500 hover:underline ml-auto">Excluir</button>
      </div>
    </div>`
}

// Renderiza uma lista já ordenada, agrupando por projeto (cabeçalho por projeto).
function renderNlInto(boxSel, list, emptyMsg) {
  const box = $(boxSel)
  if (list.length === 0) {
    box.innerHTML = `<p class="text-sm text-wa-muted px-1">${emptyMsg}</p>`
    return
  }
  const byProject = new Map()
  list.forEach((nl) => {
    const key = nl.projectName || 'Avulsas'
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key).push(nl)
  })
  let html = ''
  for (const [proj, items] of byProject) {
    const label = proj === 'Avulsas' ? '📄 Avulsas' : '📁 ' + esc(proj)
    html += `<div class="text-[11px] font-semibold text-wa-teal uppercase tracking-wide px-1 pt-2 pb-0.5">${label} <span class="text-wa-muted">(${items.length})</span></div>`
    html += `<div class="space-y-2">${items.map(renderNewsletterCard).join('')}</div>`
  }
  box.innerHTML = html
}

async function loadNewsletters() {
  const list = await api('/api/newsletters')
  const drafts = list
    .filter((n) => n.status === 'draft')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  const done = list
    .filter((n) => n.status !== 'draft')
    .sort((a, b) => new Date(b.sentAt || b.scheduledAt) - new Date(a.sentAt || a.scheduledAt)) // recentes primeiro

  $('#count-draft').textContent = drafts.length
  $('#count-sent').textContent = done.length

  // Agenda: cards inteligentes (topo)
  const draftBox = $('#nl-draft')
  draftBox.innerHTML = drafts.length
    ? drafts.map(renderAgendaCard).join('')
    : '<p class="text-sm text-wa-muted col-span-2">Nenhuma mensagem na agenda. Escreva em <b>Input de Envios</b> e salve aqui.</p>'

  // Enviados (fim, marcados como feito)
  renderNlInto('#nl-sent', done, 'Nada enviado ainda.')

  $$('[data-send]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Disparar esta newsletter AGORA para os grupos selecionados?')) return
      await api(`/api/newsletters/${b.dataset.send}/send-now`, { method: 'POST' })
      setTimeout(loadNewsletters, 600)
    })
  )
  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Excluir esta newsletter?')) return
      await api(`/api/newsletters/${b.dataset.del}`, { method: 'DELETE' })
      loadNewsletters()
    })
  )
  $$('[data-editnl]').forEach((b) =>
    b.addEventListener('click', async () => {
      const nl = await api(`/api/newsletters/${b.dataset.editnl}`)
      if (nl) loadNewsletterIntoForm(nl)
    })
  )
}

// ---------- Ajustes ----------
async function loadSettings() {
  const s = await api('/api/settings')
  $('#s-block-min').value = s.blockDelayMin
  $('#s-block-max').value = s.blockDelayMax
  $('#s-group-min').value = s.groupDelayMin
  $('#s-group-max').value = s.groupDelayMax
}

$('#btn-save-settings').addEventListener('click', async () => {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      blockDelayMin: +$('#s-block-min').value,
      blockDelayMax: +$('#s-block-max').value,
      groupDelayMin: +$('#s-group-min').value,
      groupDelayMax: +$('#s-group-max').value,
    }),
  })
  const m = $('#config-msg')
  m.textContent = '✅ Salvo!'
  m.className = 'text-sm text-green-600 ml-2'
  setTimeout(() => (m.textContent = ''), 2000)
})

// ---------- Dashboard de Dados ----------
const dayKey = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
function lastNDays(n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(Date.now() - i * 86400000)))
  return out
}
const bigTile = (label, val) =>
  `<div class="glass rounded-2xl p-4"><div class="text-2xl font-bold text-wa-ink">${val}</div><div class="text-[11px] text-wa-muted mt-1">${label}</div></div>`
const miniStat = (label, val, cls) =>
  `<div class="bg-white/50 rounded-xl p-2 text-center"><div class="font-bold ${cls || 'text-wa-ink'}">${val}</div><div class="text-[10px] text-wa-muted mt-0.5">${label}</div></div>`

async function loadDashboard() {
  const box = $('#dash-content')
  box.innerHTML = '<div class="glass rounded-2xl p-6 text-center text-wa-muted text-sm">Carregando dados…</div>'

  let events = []
  try {
    const { data } = await sb.from('group_events').select('jid,action,at')
    events = data || []
  } catch { /* tabela ainda não criada */ }

  let nls = []
  try { nls = await api('/api/newsletters') } catch {}
  const sentByProject = {}
  nls.filter((n) => n.status === 'sent').forEach((n) => {
    const k = n.projectName || 'Avulsas'
    sentByProject[k] = (sentByProject[k] || 0) + 1
  })

  const totalMembers = projects.reduce((s, p) => s + memberCount(p.groupJids), 0)
  const totalEnvios = nls.filter((n) => n.status === 'sent').length

  let html = `<div class="grid grid-cols-3 gap-3">
    ${bigTile('👥 Membros (todos)', totalMembers.toLocaleString('pt-BR'))}
    ${bigTile('📁 Projetos', projects.length)}
    ${bigTile('🚀 Envios feitos', totalEnvios)}
  </div>`

  if (projects.length === 0) {
    html += '<p class="text-sm text-wa-muted px-1 mt-2">Crie um projeto para ver o balanço por projeto.</p>'
  }

  const days = lastNDays(7)
  html += projects
    .map((p) => {
      const gset = new Set(p.groupJids)
      const ev = events.filter((e) => gset.has(e.jid))
      const entradas = ev.filter((e) => e.action === 'add').length
      const saidas = ev.filter((e) => e.action === 'remove').length
      const envios = sentByProject[p.name] || 0
      const daily = days.map((d) => {
        const dev = ev.filter((e) => dayKey(e.at) === d)
        return { d, add: dev.filter((e) => e.action === 'add').length, rem: dev.filter((e) => e.action === 'remove').length }
      })
      return `<div class="glass rounded-2xl p-4">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-wa-ink">📁 ${esc(p.name)}</h3>
          <span class="text-xs text-wa-muted">${p.groupJids.length} grupos</span>
        </div>
        <div class="grid grid-cols-4 gap-2 mt-3">
          ${miniStat('👥 Membros', memberCount(p.groupJids).toLocaleString('pt-BR'))}
          ${miniStat('📈 Entradas', '+' + entradas, 'text-emerald-600')}
          ${miniStat('📉 Saídas', '−' + saidas, 'text-red-500')}
          ${miniStat('🚀 Envios', envios)}
        </div>
        <div class="mt-3">
          <p class="text-[11px] font-semibold text-wa-muted uppercase tracking-wide mb-1">Entradas / saídas — últimos 7 dias</p>
          <div class="space-y-0.5">
            ${daily.map((x) => `<div class="flex justify-between text-xs"><span class="text-wa-muted">${x.d}</span><span><span class="text-emerald-600">+${x.add}</span> &nbsp;<span class="text-red-500">−${x.rem}</span></span></div>`).join('')}
          </div>
        </div>
      </div>`
    })
    .join('')

  html += '<p class="text-[11px] text-wa-muted px-1">📊 Entradas/saídas contam a partir de quando o monitoramento foi ligado. Engajamento (reações) virá numa próxima versão.</p>'

  box.innerHTML = `<div class="space-y-4">${html}</div>`
}

// ---------- Login (Supabase Auth) ----------
async function initApp() {
  $('#login-overlay').classList.add('hidden')
  $('#btn-signout').classList.remove('hidden')
  await loadGroups() // carrega grupos (do Supabase) + projetos
  loadSettings()
  showTab('agenda')
  setInterval(() => {
    if (!$('[data-panel="agenda"]').classList.contains('hidden')) loadNewsletters()
  }, 5000)
}

async function doLogin() {
  const email = $('#login-email').value.trim()
  const password = $('#login-password').value
  const msg = $('#login-msg')
  msg.textContent = ''
  if (!email || !password) { msg.textContent = 'Preencha e-mail e senha.'; return }
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) { msg.textContent = 'E-mail ou senha incorretos.'; return }
  initApp()
}

$('#login-btn').addEventListener('click', doLogin)
$('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin() })
$('#btn-signout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload() })

// Se já estiver logada (sessão salva no navegador), entra direto.
;(async () => {
  const { data } = await sb.auth.getSession()
  if (data.session) initApp()
})()
