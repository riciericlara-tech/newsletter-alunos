import 'dotenv/config'
import { supabase } from './supabase.js'
import { execSync } from 'child_process'
const sleep = ms => new Promise(r=>setTimeout(r,ms))
const PLIST = '/Users/clararicieri/Library/LaunchAgents/com.clara.newsletter.plist'
for (let i=0;i<40;i++){
  const d = (await supabase.from('newsletters').select('data')).data||[]
  const sending = d.map(r=>r.data).some(n=>n.title?.includes('20/06') && n.status==='sending')
  if(!sending){
    console.log('20/06 finalizado — reiniciando app para ativar monitoramento')
    try{ execSync(`launchctl unload ${PLIST}`) }catch{}
    try{ execSync("lsof -ti:3000 | xargs kill -9") }catch{}
    await sleep(2500)
    execSync(`launchctl load ${PLIST}`)
    await sleep(10000)
    const st = execSync('curl -s --max-time 5 http://localhost:3000/api/status').toString()
    console.log('✅ app reiniciado com monitoramento. status:', st.match(/"status":"[^"]*"/)?.[0])
    process.exit(0)
  }
  await sleep(30000)
}
console.log('⏱️ 20/06 ainda enviando após 20min — reinicio fica pra depois')
