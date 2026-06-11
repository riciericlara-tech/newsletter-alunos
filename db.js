// Armazenamento com dois backends:
//  - Supabase (se SUPABASE_URL/SERVICE_KEY definidos) → para rodar na nuvem
//  - Arquivo local data/db.json → para rodar na máquina (padrão)
// Todas as funções são async e têm a mesma assinatura nos dois casos.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { supabase, USE_SUPABASE } from './supabase.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'data', 'db.json')

const DEFAULT_SETTINGS = {
  blockDelayMin: 4,
  blockDelayMax: 9,
  groupDelayMin: 30,
  groupDelayMax: 75,
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(performance.now()).toString(36)
}

// ----------------------------------------------------------------
// Backend de ARQUIVO LOCAL
// ----------------------------------------------------------------
let cache = null
function loadFile() {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
    cache = {
      newsletters: parsed.newsletters || [],
      projects: parsed.projects || [],
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    }
  } catch {
    cache = { newsletters: [], projects: [], settings: { ...DEFAULT_SETTINGS } }
  }
  return cache
}
function persistFile() {
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2))
}

const fileBackend = {
  async getSettings() {
    return loadFile().settings
  },
  async updateSettings(patch) {
    const db = loadFile()
    db.settings = { ...db.settings, ...patch }
    persistFile()
    return db.settings
  },
  async listNewsletters() {
    return loadFile().newsletters
  },
  async getNewsletter(id) {
    return loadFile().newsletters.find((n) => n.id === id) || null
  },
  async insertNewsletter(item) {
    const db = loadFile()
    db.newsletters.push(item)
    persistFile()
    return item
  },
  async updateNewsletter(id, patch) {
    const db = loadFile()
    const item = db.newsletters.find((n) => n.id === id)
    if (!item) return null
    Object.assign(item, patch)
    persistFile()
    return item
  },
  async deleteNewsletter(id) {
    const db = loadFile()
    db.newsletters = db.newsletters.filter((n) => n.id !== id)
    persistFile()
    return true
  },
  async listProjects() {
    return loadFile().projects
  },
  async insertProject(item) {
    const db = loadFile()
    db.projects.push(item)
    persistFile()
    return item
  },
  async updateProjectRow(id, item) {
    const db = loadFile()
    const idx = db.projects.findIndex((p) => p.id === id)
    if (idx === -1) return null
    db.projects[idx] = item
    persistFile()
    return item
  },
  async deleteProject(id) {
    const db = loadFile()
    db.projects = db.projects.filter((p) => p.id !== id)
    persistFile()
    return true
  },
}

// ----------------------------------------------------------------
// Backend SUPABASE (cada registro guardado como JSON na coluna `data`)
// ----------------------------------------------------------------
const supaBackend = {
  async getSettings() {
    const { data } = await supabase.from('app_settings').select('data').eq('id', 1).maybeSingle()
    if (data?.data) return { ...DEFAULT_SETTINGS, ...data.data }
    await supabase.from('app_settings').upsert({ id: 1, data: DEFAULT_SETTINGS })
    return { ...DEFAULT_SETTINGS }
  },
  async updateSettings(patch) {
    const current = await this.getSettings()
    const merged = { ...current, ...patch }
    await supabase.from('app_settings').upsert({ id: 1, data: merged })
    return merged
  },
  async listNewsletters() {
    const { data } = await supabase.from('newsletters').select('data')
    return (data || []).map((r) => r.data)
  },
  async getNewsletter(id) {
    const { data } = await supabase.from('newsletters').select('data').eq('id', id).maybeSingle()
    return data?.data || null
  },
  async insertNewsletter(item) {
    await supabase.from('newsletters').insert({ id: item.id, data: item })
    return item
  },
  async updateNewsletter(id, patch) {
    const current = await this.getNewsletter(id)
    if (!current) return null
    const merged = { ...current, ...patch }
    await supabase.from('newsletters').update({ data: merged }).eq('id', id)
    return merged
  },
  async deleteNewsletter(id) {
    await supabase.from('newsletters').delete().eq('id', id)
    return true
  },
  async listProjects() {
    const { data } = await supabase.from('projects').select('data')
    return (data || []).map((r) => r.data)
  },
  async insertProject(item) {
    await supabase.from('projects').insert({ id: item.id, data: item })
    return item
  },
  async updateProjectRow(id, item) {
    await supabase.from('projects').update({ data: item }).eq('id', id)
    return item
  },
  async deleteProject(id) {
    await supabase.from('projects').delete().eq('id', id)
    return true
  },
}

const backend = USE_SUPABASE ? supaBackend : fileBackend

// ----------------------------------------------------------------
// API pública (igual para os dois backends)
// ----------------------------------------------------------------
export const getSettings = () => backend.getSettings()
export const updateSettings = (patch) => backend.updateSettings(patch)
export const listNewsletters = () => backend.listNewsletters()
export const getNewsletter = (id) => backend.getNewsletter(id)
export const updateNewsletter = (id, patch) => backend.updateNewsletter(id, patch)
export const deleteNewsletter = (id) => backend.deleteNewsletter(id)
export const listProjects = () => backend.listProjects()
export const deleteProject = (id) => backend.deleteProject(id)

export function createNewsletter(data) {
  const item = {
    id: newId('nl_'),
    title: data.title || 'Newsletter',
    blocks: data.blocks || [],
    groupJids: data.groupJids || [],
    projectId: data.projectId || null,
    projectName: data.projectName || null,
    scheduledAt: data.scheduledAt,
    repeatDaily: !!data.repeatDaily,
    status: 'pending',
    createdAt: new Date().toISOString(),
    sentAt: null,
    log: [],
  }
  return backend.insertNewsletter(item)
}

export function createProject({ name, groupJids }) {
  const item = { id: newId('pj_'), name: (name || 'Projeto').trim(), groupJids: groupJids || [] }
  return backend.insertProject(item)
}

export async function updateProject(id, patch) {
  const list = await backend.listProjects()
  const item = list.find((p) => p.id === id)
  if (!item) return null
  if (patch.name !== undefined) item.name = patch.name.trim()
  if (patch.groupJids !== undefined) item.groupJids = patch.groupJids
  return backend.updateProjectRow(id, item)
}
