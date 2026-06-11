// Frontend: fala com a API REST do servidor. Sem framework, só fetch + DOM.

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)
const api = async (url, opts) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
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

// Converte "2026-06-11T07:00" (hora de parede de Brasília) no instante UTC correto.
function zonedToUTC(localStr) {
  const [d, t] = localStr.split('T')
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

let groups = []
let selectedJids = new Set()
let projects = []
let groupFilter = '' // busca na aba Compor

// ---------- Abas ----------
function showTab(name) {
  $$('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name))
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name))
  if (name === 'agendados') loadNewsletters()
  if (name === 'projetos') { renderPjGroupList(); renderProjectsList() }
}
$$('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))

// ---------- Status / Conexão ----------
function setConnView(status) {
  const map = ['disconnected', 'qr', 'connecting', 'connected']
  map.forEach((s) => $(`#conn-${s}`).classList.add('hidden'))
  if ($(`#conn-${status}`)) $(`#conn-${status}`).classList.remove('hidden')
}

async function pollStatus() {
  try {
    const s = await api('/api/status')
    const badge = $('#conn-badge')
    const labels = {
      disconnected: ['Desconectado', 'bg-slate-200 text-slate-600'],
      connecting: ['Conectando…', 'bg-amber-100 text-amber-700'],
      qr: ['Escaneie o QR', 'bg-amber-100 text-amber-700'],
      connected: ['● Conectado', 'bg-green-100 text-green-700'],
    }
    const [text, cls] = labels[s.status] || labels.disconnected
    badge.textContent = s.sending ? '📤 Enviando…' : text
    badge.className = 'text-xs px-3 py-1.5 rounded-full ' + (s.sending ? 'bg-blue-100 text-blue-700' : cls)

    setConnView(s.status)
    if (s.status === 'qr' && s.qr) $('#qr-img').src = s.qr
    if (s.status === 'connected') {
      $('#me-name').textContent = s.me?.name || ''
      $('#me-groups').textContent = s.groupCount
      if (groups.length === 0) loadGroups()
    }
  } catch (e) {
    /* servidor reiniciando, ignora */
  }
}

$('#btn-connect').addEventListener('click', async () => {
  setConnView('connecting')
  await api('/api/connect', { method: 'POST' })
})

$('#btn-logout').addEventListener('click', async () => {
  if (!confirm('Desvincular o WhatsApp? Você precisará escanear o QR de novo.')) return
  await api('/api/logout', { method: 'POST' })
  groups = []
})

// ---------- Grupos ----------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

async function loadGroups() {
  try {
    groups = await api('/api/groups')
    await loadProjects()
    renderGroups()
  } catch {
    /* ignora */
  }
}

// Monta a lista de checkboxes de grupos num container, filtrando pela busca.
// `selSet` é o conjunto de selecionados; `onChange` roda a cada marcação.
function renderGroupCheckboxes(boxSel, selSet, filter, onChange) {
  const box = $(boxSel)
  if (groups.length === 0) {
    box.innerHTML = '<p class="text-sm text-slate-400 col-span-2">Conecte o WhatsApp para ver seus grupos.</p>'
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

function renderGroups() {
  renderGroupCheckboxes('#group-list', selectedJids, groupFilter, () => {
    updateSelCount()
    renderProjectChips()
  })
  updateSelCount()
  renderProjectChips()
}

function updateSelCount() {
  $('#sel-count').textContent = `${selectedJids.size} selecionados`
}

$('#group-search').addEventListener('input', (e) => {
  groupFilter = e.target.value
  renderGroups()
})

$('#btn-clear-sel').addEventListener('click', () => {
  selectedJids.clear()
  renderGroups()
})

// ---------- Projetos: chips de aplicação rápida no Compor ----------
async function loadProjects() {
  try {
    projects = await api('/api/projects')
  } catch {
    projects = []
  }
  renderProjectChips()
}

function projectIsActive(p) {
  return p.groupJids.length > 0 && p.groupJids.every((j) => selectedJids.has(j))
}

function renderProjectChips() {
  const box = $('#project-chips')
  if (!box) return
  if (projects.length === 0) {
    box.innerHTML = '<span class="text-xs text-slate-400">Nenhum projeto. Crie um na aba <b>Projetos</b> ou salve a seleção abaixo.</span>'
    return
  }
  box.innerHTML = projects
    .map((p) => {
      const active = projectIsActive(p)
      return `<button type="button" data-pj="${p.id}" class="text-xs px-2.5 py-1 rounded-full border transition ${
        active ? 'bg-brand text-white border-brand' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
      }">${active ? '✓ ' : '📁 '}${esc(p.name)} <span class="opacity-60">(${p.groupJids.length})</span></button>`
    })
    .join('')
  box.querySelectorAll('[data-pj]').forEach((b) =>
    b.addEventListener('click', () => applyProject(b.dataset.pj))
  )
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
  renderGroups()
}

$('#btn-save-project').addEventListener('click', async () => {
  if (selectedJids.size === 0) { setMsg('⚠️ Selecione grupos antes de salvar o projeto.', 'warn'); return }
  const name = prompt('Nome do projeto (ex: Devocional Alunos):')
  if (!name || !name.trim()) return
  try {
    await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), groupJids: [...selectedJids] }),
    })
    await loadProjects()
    setMsg(`✅ Projeto "${name.trim()}" salvo!`, 'ok')
  } catch (e) {
    setMsg('❌ ' + e.message, 'err')
  }
})

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
      renderGroups()
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
  $('#f-datetime').value = ''
  $('#dt-helper').textContent = ''
  $('#f-repeat').checked = false
  $('#block-count').textContent = '0'
  selectedJids.clear()
  renderGroups()
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

async function submitNewsletter({ sendNow }) {
  const data = collectForm({ needDate: !sendNow })
  if (!data) return
  setMsg('', null)
  const proj = matchProject(data.groupJids)
  try {
    const nl = await api('/api/newsletters', {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        blocks: data.blocks,
        groupJids: data.groupJids,
        projectId: proj?.id || null,
        projectName: proj?.name || null,
        scheduledAt: sendNow ? new Date().toISOString() : zonedToUTC(data.dt).toISOString(),
        repeatDaily: sendNow ? false : data.repeatDaily,
      }),
    })
    if (sendNow) {
      await api(`/api/newsletters/${nl.id}/send-now`, { method: 'POST' })
      setMsg('🚀 Disparo iniciado! Acompanhe em "Disparos".', 'ok')
    } else {
      setMsg('✅ Agendada com sucesso!', 'ok')
    }
    resetForm()
    setTimeout(() => showTab('agendados'), 900)
  } catch (e) {
    setMsg('❌ ' + e.message, 'err')
  }
}

$('#btn-schedule').addEventListener('click', () => submitNewsletter({ sendNow: false }))
$('#btn-sendnow').addEventListener('click', () => {
  if (!confirm('Enviar AGORA para os grupos selecionados? As mensagens vão sair de imediato.')) return
  submitNewsletter({ sendNow: true })
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
  submitNewsletter({ sendNow: false })
})
$('#preview-sendnow').addEventListener('click', () => {
  if (!confirm('Enviar AGORA para os grupos selecionados? As mensagens vão sair de imediato.')) return
  closePreview()
  submitNewsletter({ sendNow: true })
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

function renderNewsletterCard(nl) {
  const st = statusInfo(nl)
  const snippet = plainText(nl.blocks[0])
  return `
    <div class="bg-white rounded-xl border border-wa-line overflow-hidden">
      <div class="flex items-start gap-3 p-3">
        <div class="w-11 h-11 rounded-full bg-wa-green/15 grid place-items-center text-lg shrink-0">📬</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-wa-ink truncate">${esc(nl.title)}</span>
            <span class="text-[11px] text-wa-muted shrink-0">${fmtDate(nl.scheduledAt)}</span>
          </div>
          <p class="text-[13px] text-wa-muted truncate mt-0.5">${esc(snippet)}</p>
          <p class="text-[11px] text-wa-muted/80 mt-1">${nl.blocks.length} msgs · ${nl.groupJids.length} grupos${nl.repeatDaily ? ' · 🔁 diária' : ''}</p>
        </div>
        <span class="text-[11px] px-2 py-1 rounded-full whitespace-nowrap shrink-0 ${st.cls}">${st.icon} ${st.label}</span>
      </div>
      <div class="flex gap-3 px-3 py-2 bg-wa-panel/60 border-t border-wa-line text-sm">
        ${nl.status === 'pending' ? `<button data-send="${nl.id}" class="text-wa-teal font-medium hover:underline">🚀 Disparar agora</button>` : ''}
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
  const pending = list
    .filter((n) => n.status === 'pending')
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)) // próximos primeiro
  const done = list
    .filter((n) => n.status !== 'pending')
    .sort((a, b) => new Date(b.sentAt || b.scheduledAt) - new Date(a.sentAt || a.scheduledAt)) // recentes primeiro

  $('#count-pending').textContent = pending.length
  $('#count-sent').textContent = done.length
  renderNlInto('#nl-pending', pending, 'Nada agendado no momento.')
  renderNlInto('#nl-sent', done, 'Nenhuma enviada ainda.')

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

// ---------- Início ----------
showTab('conexao')
loadSettings()
pollStatus()
setInterval(pollStatus, 2500)
setInterval(() => { if (!$('[data-panel="agendados"]').classList.contains('hidden')) loadNewsletters() }, 5000)
