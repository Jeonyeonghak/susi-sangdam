// ============================================================
// 교과 계산 + Mistral OCR/모집요강 추출 엔진
// (수시 상담 스튜디오의 검증된 로직을 이식)
// API 키는 Vercel 환경변수 VITE_MISTRAL_KEY 에서 읽습니다.
// ============================================================

const MISTRAL_KEY = import.meta.env.VITE_MISTRAL_KEY || ''
export const hasAI = Boolean(MISTRAL_KEY)

// ---------- 공통 유틸 ----------
export function safeJson(text){
  if(!text) throw new Error('AI 응답이 비어 있습니다')
  let s = String(text).trim()
  s = s.replace(/^```(json)?/i,'').replace(/```$/,'').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  const c = s.indexOf('['), d = s.lastIndexOf(']')
  let cand = s
  if(a>=0 && b>a){ cand = s.slice(a,b+1) }
  else if(c>=0 && d>c){ cand = s.slice(c,d+1) }
  try{ return JSON.parse(cand) }catch{ return JSON.parse(s) }
}
function fileToDataUrl(file){
  return new Promise((res,rej)=>{
    const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('파일 읽기 실패')); r.readAsDataURL(file)
  })
}
function visionContent(imgs){ return imgs.map(u=>({type:'image_url',image_url:u})) }

// ---------- Mistral 호출 ----------
async function callOAI(messages, opts={}){
  if(!MISTRAL_KEY) throw new Error('Mistral API 키가 없습니다 (Vercel 환경변수 VITE_MISTRAL_KEY)')
  const body={
    model: opts.model || 'mistral-small-latest',
    max_tokens: opts.maxTokens || 4000,
    messages,
  }
  if(opts.json) body.response_format={type:'json_object'}
  for(let attempt=1; attempt<=3; attempt++){
    const res=await fetch('https://api.mistral.ai/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${MISTRAL_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    })
    if(res.status===429){
      if(attempt<3){ opts.onRetry?.(`속도 제한 — 15초 후 재시도 (${attempt}/3)`); await new Promise(r=>setTimeout(r,15000)); continue }
      throw new Error('Mistral 속도 제한 (재시도 실패)')
    }
    if(!res.ok){ const t=await res.text(); throw new Error(`Mistral ${res.status}: ${t.slice(0,200)}`) }
    const d=await res.json()
    const content=d.choices?.[0]?.message?.content
    if(typeof content==='string') return content
    if(Array.isArray(content)) return content.map(p=>typeof p==='string'?p:(p?.text||'')).join('\n')
    if(content && typeof content==='object') return JSON.stringify(content)
    throw new Error('Mistral 응답 비어있음')
  }
}
async function callOCR(body, opts={}){
  if(!MISTRAL_KEY) throw new Error('Mistral API 키가 없습니다')
  for(let attempt=1; attempt<=3; attempt++){
    const res=await fetch('https://api.mistral.ai/v1/ocr',{
      method:'POST',
      headers:{'Authorization':`Bearer ${MISTRAL_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    })
    if(res.status===429){
      if(attempt<3){ opts.onRetry?.(`OCR 속도 제한 — 15초 후 재시도`); await new Promise(r=>setTimeout(r,15000)); continue }
      throw new Error('Mistral OCR 속도 제한')
    }
    if(!res.ok){ const t=await res.text(); throw new Error(`OCR ${res.status}: ${t.slice(0,200)}`) }
    return res.json()
  }
}
async function uploadFile(file){
  const form=new FormData()
  form.append('file', file, file?.name||'doc.pdf')
  form.append('purpose','ocr'); form.append('visibility','user')
  const res=await fetch('https://api.mistral.ai/v1/files',{ method:'POST', headers:{'Authorization':`Bearer ${MISTRAL_KEY}`}, body:form })
  if(!res.ok) throw new Error(`파일 업로드 ${res.status}`)
  const d=await res.json(); if(!d?.id) throw new Error('file id 없음'); return d.id
}
async function signedUrl(fileId){
  const res=await fetch(`https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}/url?expiry=24`,{ headers:{'Authorization':`Bearer ${MISTRAL_KEY}`} })
  if(!res.ok) throw new Error('signed url 실패')
  const d=await res.json(); return d.url
}
function ocrPagesToText(pages){
  return (pages||[]).map((p,i)=>{
    const blocks=[]
    if(p?.header) blocks.push(`[HEADER]\n${p.header}`)
    if(p?.markdown) blocks.push(p.markdown)
    if(Array.isArray(p?.tables)) p.tables.forEach((t,j)=>{ const raw=t?.html||t?.markdown||t?.text||''; if(raw) blocks.push(`[TABLE ${j+1}]\n${raw}`) })
    if(p?.footer) blocks.push(`[FOOTER]\n${p.footer}`)
    return `[${i+1}페이지]\n${blocks.filter(Boolean).join('\n\n')}`
  }).join('\n\n')
}
// ============================================================
// 교과 계산 (그대로 이식)
// ============================================================
function jinroAchievToGrade(achievement, jinroStr){
  if(!jinroStr || jinroStr==='미반영') return null
  const a=(achievement||'').toUpperCase()
  const map={}
  for(const part of jinroStr.split(/[,\n]/)){
    const m=part.match(/([ABC])\s*[:：]\s*([\d.]+)/)
    if(m) map[m[1]]=parseFloat(m[2])
  }
  return map[a] ?? null
}
// opts: { topN, scoreTable }
//  topN: 상위 N개 과목만 반영 (등급 좋은 순). scoreTable: {1:100,2:96,...} 등급→배점
export function calcGradeAvg(grades, subjectGroups, jinroHandling, opts={}){
  const { topN=null, scoreTable=null } = opts
  const groups=subjectGroups||['국어','수학','영어','과학','사회']
  const allGroups=!subjectGroups||subjectGroups.length===0
  const inGroup=g=> allGroups || groups.some(gr=>String(g.group||'').includes(gr))

  // 반영 대상 과목 모으기 (일반/공통 + 조건부 진로)
  const items=[]
  for(const g of (grades||[])){
    if(g.courseType==='체육예술') continue
    if(g.courseType==='진로') continue
    if(g.grade==null) continue
    const n=Number(g.grade); if(!Number.isFinite(n)||n<1||n>9) continue
    if(!inGroup(g)) continue
    items.push({ grade:n, unit:Number(g.unit)||1 })
  }
  if(jinroHandling && jinroHandling!=='미반영'){
    for(const g of (grades||[])){
      if(g.courseType!=='진로' || !inGroup(g)) continue
      const cv=jinroAchievToGrade(g.achievement,jinroHandling)
      if(cv!=null) items.push({ grade:cv, unit:Number(g.unit)||1 })
    }
  }
  if(!items.length) return null

  // 상위 N개만: 등급 좋은(작은) 순 정렬 후 앞 N개
  let use=items
  if(topN && topN>0 && items.length>topN){
    use=[...items].sort((a,b)=>a.grade-b.grade).slice(0,topN)
  }

  // 배점표가 있으면 점수로 환산 → 가중평균 점수 → 등급 스케일로 역환산
  if(scoreTable && Object.keys(scoreTable).length){
    let sW=0,sScore=0
    for(const it of use){
      const sc = scoreTable[it.grade] ?? scoreTable[Math.round(it.grade)] ?? null
      if(sc==null) continue
      sScore+=sc*it.unit; sW+=it.unit
    }
    if(sW>0){
      const avgScore=sScore/sW
      return scoreToGrade(avgScore, scoreTable) // 등급으로 역환산해 통통통 컷과 비교 가능
    }
  }

  // 기본: 등급 가중평균
  let sumW=0,sumG=0
  for(const it of use){ sumG+=it.grade*it.unit; sumW+=it.unit }
  return sumW>0 ? sumG/sumW : null
}
// 배점 점수 → 가장 가까운 등급으로 역환산 (배점표 구간 보간)
function scoreToGrade(score, scoreTable){
  const pairs=Object.entries(scoreTable).map(([g,s])=>({g:Number(g),s:Number(s)})).sort((a,b)=>a.g-b.g)
  if(!pairs.length) return null
  // score가 표의 두 등급 점수 사이에 있으면 선형보간
  for(let i=0;i<pairs.length-1;i++){
    const hi=pairs[i], lo=pairs[i+1] // 등급 낮을수록 점수 높음
    const sHi=hi.s, sLo=lo.s
    if((score<=sHi && score>=sLo) || (score>=sHi && score<=sLo)){
      if(sHi===sLo) return hi.g
      const t=(sHi-score)/(sHi-sLo)
      return hi.g + t*(lo.g-hi.g)
    }
  }
  // 범위 밖이면 가장 가까운 등급
  let best=pairs[0], bd=Math.abs(score-pairs[0].s)
  for(const p of pairs){ const d=Math.abs(score-p.s); if(d<bd){bd=d;best=p} }
  return best.g
}
export function calcOverallAvg(grades){ return calcGradeAvg(grades,null,null) }

// 반영과목 문자열 파싱 (통통통 DB 근사용)
export function parseSubjectGroups(subjects){
  if(!subjects) return null
  const s=String(subjects)
  const found=[]
  for(const k of ['국어','수학','영어','과학','사회','한국사']){ if(s.includes(k)) found.push(k) }
  return found.length ? found : null
}

// 대학명 퍼지 매칭
function norm(s){ return String(s||'').replace(/\s/g,'').replace(/(학교|대학교|대학)$/,'') }
// 파일명 대학명 → 통통통 DB 정식명 매칭 (가천대 → 가천대학교)
export function matchUnivName(input, dbUnivs){
  if(!input || !dbUnivs || !dbUnivs.length) return null
  const n=norm(input)
  const exact=dbUnivs.find(u=>u===input); if(exact) return exact
  const ne=dbUnivs.find(u=>norm(u)===n); if(ne) return ne
  const contains=dbUnivs.find(u=>{ const nu=norm(u); return nu.includes(n)||n.includes(nu) }); if(contains) return contains
  return null
}
export function findGuideForUni(uniGuides, rowUni){
  if(!uniGuides || !rowUni) return null
  const nRow=norm(rowUni)
  if(uniGuides[rowUni]) return uniGuides[rowUni]
  for(const [k,v] of Object.entries(uniGuides)){ if(norm(k)===nRow) return v }
  for(const [k,v] of Object.entries(uniGuides)){ const nk=norm(k); if(nk.includes(nRow)||nRow.includes(nk)) return v }
  return null
}
function normTrack(s){ return String(s||'').replace(/\s/g,'').replace(/(전형II|전형2|전형Ⅱ|전형)$/,'').toLowerCase() }
function scoreTrackMatch(g0,r0){
  const g=normTrack(g0), r=normTrack(r0)
  if(!g||!r) return 0
  if(g===r) return 100
  if(g.includes(r)||r.includes(g)) return 80
  const minLen=Math.min(g.length,r.length,5)
  if(minLen>=3 && g.slice(0,minLen)===r.slice(0,minLen)) return 60
  for(const kw of ['학교추천','학생부우수','지역균형','일반','교과우수','면접','서류']){ if(g.includes(kw)&&r.includes(kw)) return 50 }
  return 0
}
function findGuideTrack(guide, row){
  if(!guide?.tracks?.length) return null
  const tt=row.type||''
  const cands=guide.tracks.filter(t=> !t.trackType || t.trackType==='교과' || tt.includes('교과'))
  if(!cands.length) return null
  let best=null,bs=0
  for(const t of cands){ const s=scoreTrackMatch(t.trackName,row.name); if(s>bs){ bs=s; best=t } }
  if(bs>=30) return best
  if(cands.length===1) return cands[0]
  return null
}

// track 선택: "그 모집단위(행)의 계열"을 최우선으로.
// 인문 학과 → 인문 track, 자연 학과 → 자연 track.
// 계열이 맞는 track이 없으면 null 반환 → 통통통 반영과목(DB근사)으로 빠짐.
function pickTrackForRow(guide, row, studentTrack){
  const tracks=(guide.tracks||[]).filter(t=>t.subjectGroups?.length)
  if(!tracks.length) return null

  const natTrack = tracks.find(t=>t.track==='자연')
  const humTrack = tracks.find(t=>t.track==='인문')
  const commonTrack = tracks.find(t=>!t.track||t.track==='공통')

  // 이 모집단위의 계열 판정 (행 계열 우선, 없으면 학생 계열)
  const rowField = String(row.track||'')
  const rowNat = /자연|이과/.test(rowField)
  const rowHum = /인문|문과/.test(rowField)
  const stuField = String(studentTrack||'')
  const stuNat = /자연|이과/.test(stuField)
  const stuHum = /인문|문과/.test(stuField)
  const wantNat = rowNat || (!rowHum && stuNat)
  const wantHum = rowHum || (!rowNat && stuHum)

  // 이 모집단위가 인문 → 인문 track. 없으면 공통. 그것도 없으면 null(DB근사)
  if(wantHum){
    if(humTrack) return humTrack
    if(commonTrack) return commonTrack
    return null // 인문학과인데 인문/공통 track이 없음 → 자연으로 잘못 계산 방지
  }
  // 이 모집단위가 자연 → 자연 track. 없으면 공통. 그것도 없으면 null
  if(wantNat){
    if(natTrack) return natTrack
    if(commonTrack) return commonTrack
    return null
  }
  // 계열 판단 불가: 공통 → 전형명 매칭 → 유일 track
  if(commonTrack) return commonTrack
  const gt=findGuideTrack(guide,row)
  if(gt && gt.subjectGroups?.length) return gt
  return tracks.length===1 ? tracks[0] : null
}

// 한 지원행(대학·전형)에 대해 학생 교과등급 계산
export function gradeForRow(row, grades, uniGuides, studentTrack){
  if(!grades || !grades.length) return null
  const tt=row.type||''
  if(tt.includes('종합') || tt.includes('논술')) return calcOverallAvg(grades)
  if(tt.includes('교과')){
    const guide=findGuideForUni(uniGuides, row.univ)
    if(guide){
      const useTrack = pickTrackForRow(guide, row, studentTrack)
      if(useTrack){
        return calcGradeAvg(
          grades,
          useTrack.subjectGroups?.length?useTrack.subjectGroups:null,
          useTrack.jinroHandling||null,
          { topN:useTrack.topN||null, scoreTable:useTrack.scoreTable||null }
        )
      }
    }
    const groups=parseSubjectGroups(row.subjects)
    return calcGradeAvg(grades, groups, null)
  }
  return calcOverallAvg(grades)
}
// 계산 근거 라벨
export function gradeSource(row, grades, uniGuides, studentTrack){
  if(!grades || !grades.length) return null
  const tt=row.type||''
  if(tt.includes('종합')||tt.includes('논술')) return '전체평균'
  if(tt.includes('교과')){
    const guide=findGuideForUni(uniGuides, row.univ)
    if(guide){
      const t=pickTrackForRow(guide, row, studentTrack)
      if(t) return `📐${t.trackName||row.univ+' 요강'}`
    }
    return 'DB근사'
  }
  return '전체평균'
}

// ============================================================
// AI: 모집요강 이미지 → 규칙 추출
// ============================================================
export async function parseGuideFromImages(files, onProg){
  const imgs=[]
  for(const f of files){ imgs.push(await fileToDataUrl(f)) }
  const prompt=`These images are pages from a Korean university admission guide (교과전형 반영방법/계산방법). Extract as JSON.
Return ONLY this JSON shape:
{"university":"대학명(한글)","tracks":[{"trackName":"전형명(계열 포함, 예: 학생부우수자-자연계열)","trackType":"교과" or "종합","track":"자연" or "인문" or "공통" or null,"subjectGroups":["국어","수학","영어","과학"],"jinroHandling":"미반영" or "A:1등급,B:3등급,C:5등급" or null,"topN":null or number,"scoreTable":null or {"1":100,"2":99.5,"3":99},"cutoffNote":null,"evalAreas":[]}],"changeNotes":[]}

핵심 규칙 — 계열 구분을 반드시 지킬 것:
- 모집요강에 "인문계열", "자연계열", "의예/약학" 처럼 계열별로 반영교과나 배점이 다르게 나오면, 각 계열을 **반드시 별도 track으로 분리**해서 각각 만들 것. 절대 하나로 합치지 말 것.
  예) 인문계열 → track:"인문", subjectGroups:["국어","수학","영어","사회"]
      자연계열 → track:"자연", subjectGroups:["국어","수학","영어","과학"]
- trackName에 계열을 포함 (예: "일반전형-인문계열", "일반전형-자연계열").
- 같은 전형이라도 계열마다 배점표(scoreTable)가 다르면 각각 정확히 읽을 것.
- subjectGroups: 실제 반영교과명만. 인문은 보통 국어·수학·영어·사회, 자연은 국어·수학·영어·과학.
- topN: "우수한 10개 과목", "상위 10과목"이면 그 숫자. 전과목이면 null.
- scoreTable: "변환등급 배점" 또는 "등급별 반영점수" 표가 있으면 {등급:점수}로 정확히. 계열마다 다르면 각 track에 각각.
- jinroHandling: "진로선택과목 반영하지 않음"이면 "미반영". 환산하면 "A:1등급,B:3등급,C:5등급".
- 종합전형은 subjectGroups=[], scoreTable=null, track 지정 안 함.
- 반영교과 개수를 지어내지 말 것("4개 중 3개" 같은 표현 절대 금지). 불명확하면 null.`
  onProg?.('모집요강 분석 중…')
  const resp=await callOAI([{role:'user',content:[{type:'text',text:prompt},...visionContent(imgs)]}],{maxTokens:4000})
  const raw=safeJson(resp)
  const out={ university:String(raw?.university||'').trim(), tracks:[], changeNotes:Array.isArray(raw?.changeNotes)?raw.changeNotes.map(String).filter(Boolean):[] }
  for(const t of (Array.isArray(raw?.tracks)?raw.tracks:[])){
    if(!t||typeof t!=='object') continue
    let subjectGroups=[]
    if(Array.isArray(t.subjectGroups)) for(const s of t.subjectGroups){ if(typeof s==='string'&&s.trim()) subjectGroups.push(s.trim()) }
    let evalAreas=[]
    if(Array.isArray(t.evalAreas)) for(const a of t.evalAreas){ if(typeof a==='string'&&a.trim()) evalAreas.push(a.trim()); else if(a?.name) evalAreas.push(String(a.name).trim()) }
    let scoreTable=null
    if(t.scoreTable && typeof t.scoreTable==='object' && !Array.isArray(t.scoreTable)){
      scoreTable={}
      for(const [k,v] of Object.entries(t.scoreTable)){
        const g=Number(k), s=Number(v)
        if(Number.isFinite(g)&&g>=1&&g<=9&&Number.isFinite(s)) scoreTable[g]=s
      }
      if(!Object.keys(scoreTable).length) scoreTable=null
    }
    const trk=['자연','인문','공통'].includes(t.track)?t.track:null
    out.tracks.push({
      trackName:String(t.trackName||'').trim(),
      trackType:(t.trackType==='교과'||t.trackType==='종합')?t.trackType:(subjectGroups.length?'교과':'종합'),
      track:trk,
      subjectGroups,
      jinroHandling:t.jinroHandling?String(t.jinroHandling).trim():null,
      topN:Number.isFinite(Number(t.topN))&&Number(t.topN)>0?Number(t.topN):null,
      scoreTable,
      cutoffNote:t.cutoffNote?String(t.cutoffNote).trim():null,
      evalAreas,
    })
  }
  return out
}

// ============================================================
// 생기부 파싱 헬퍼 (원본 그대로 이식)
// ============================================================
function splitPagesFromText(text){ return (text||'').split(/(?=\[\d+페이지\])/).filter(p=>p.trim()) }
function parseExtractedPages(text){
  return String(text||'').split(/(?=\[\d+페이지\])/).map(s=>s.trim()).filter(Boolean).map((chunk,idx)=>{
    const m=chunk.match(/^\[(\d+)페이지\]\s*/)
    return { pageNo:m?Number(m[1]):idx+1, text:chunk }
  })
}
function detectExplicitYears(text){
  const years=new Set()
  for(const page of splitPagesFromText(text)){
    const headerHits=[...page.matchAll(/(?:^|\n)\s*\[?\s*([123])\s*학년\s*\]?\s*(?:\n|$)/g)].map(m=>Number(m[1]))
    if(headerHits.length){ headerHits.forEach(y=>years.add(y)); continue }
    const dense=[...page.matchAll(/교과\s+과목[\s\S]{0,120}?([123])\s*학년/g)].map(m=>Number(m[1]))
    dense.forEach(y=>years.add(y))
  }
  return Array.from(years).sort((a,b)=>a-b)
}
function getConfirmedYears(text){
  return detectExplicitYears(text).filter(y=>{
    const re=new RegExp(`(?:^|\\n|\\t|\\[)${y}\\s*학년(?:\\]|\\n|\\t|\\s)`,'g')
    return re.test(text||'')
  })
}
function groupPagesByYear(text){
  const pages=parseExtractedPages(text)
  const groups={1:[],2:[],3:[]}
  let cur=null
  for(const page of pages){
    const hits=[...page.text.matchAll(/(?:^|\n)\s*\[?\s*([123])\s*학년\s*\]?\s*(?:\n|$)/g)].map(m=>Number(m[1]))
    if(hits.length){ const d=Math.max(...hits); if(cur==null||d>=cur) cur=d }
    if(cur==null) cur=1
    groups[cur].push(page)
  }
  return groups
}
function makeTextChunksByPages(pages,maxChars=12000,overlapPages=1){
  const chunks=[]; if(!pages?.length) return chunks
  let i=0
  while(i<pages.length){
    let j=i,size=0
    while(j<pages.length){ const n=size+pages[j].text.length; if(j>i&&n>maxChars) break; size=n; j++ }
    chunks.push({ text:pages.slice(i,j).map(p=>p.text).join('\n') })
    if(j>=pages.length) break
    i=Math.max(j-overlapPages,i+1)
  }
  return chunks
}
function buildAbsoluteDisplayOrder(year,pageNo,idx){ return (Number(pageNo)||0)*1000+(idx+1) }
function normalizeSubjectKey(s=''){
  return String(s||'').trim().replace(/\s+/g,'').replace(/[ⅠIlⅼ]/g,'I').replace(/[Ⅱ]/g,'II').replace(/[Ⅲ]/g,'III').replace(/[１]/g,'1').replace(/[２]/g,'2').replace(/[３]/g,'3')
}
function dedupeGradeRows(rows){
  const keyOf=g=>`${Number(g.year)||0}|${Number(g.semester)||0}|${String(g.group||'').replace(/\s+/g,'')}|${normalizeSubjectKey(g.subject||'')}|${g.courseType||''}`
  const comp=g=>(g.rawScore!=null?1:0)+(g.avg!=null?1:0)+(g.stdev!=null?1:0)+(g.unit!=null?1:0)+(g.grade!=null?1:0)+(g.achievement?1:0)+(g.cohort!=null?1:0)
  const typeRank=t=>t==='진로'?3:t==='체육예술'?2:(t==='일반'||t==='공통')?1:0
  const orderVal=v=>Number.isFinite(Number(v))?Number(v):99999999
  const best=new Map()
  for(const g of rows||[]){
    if(!String(g.subject||'').trim()) continue
    const key=keyOf(g); const prev=best.get(key)
    if(!prev){ best.set(key,g); continue }
    if(typeRank(g.courseType)>typeRank(prev.courseType)){ best.set(key,g); continue }
    if(typeRank(g.courseType)<typeRank(prev.courseType)) continue
    if(comp(g)>comp(prev)){ best.set(key,g); continue }
    if(comp(g)<comp(prev)) continue
    if(orderVal(g.displayOrder)<orderVal(prev.displayOrder)){ best.set(key,g) }
  }
  return Array.from(best.values())
}
function normalizeGrades(raw){
  return raw.map((g,i)=>{
    let grade=null
    if(g.grade!=null&&g.grade!==''){ const n=Number(g.grade); if(Number.isFinite(n)&&n>=1&&n<=9) grade=Math.round(n) }
    let unit=null
    if(g.unit!=null&&g.unit!==''){ const n=Number(g.unit); if(Number.isFinite(n)&&n>=1&&n<=10) unit=Math.round(n) }
    let courseType=g.courseType||'일반'
    if(grade!=null&&courseType==='진로') courseType='일반'
    return {
      id:i+1, year:Number(g.year)||null, semester:Number(g.semester)||null,
      group:(g.group||'').trim(), subject:(g.subject||'').trim(), unit,
      rawScore:(g.rawScore>=0&&g.rawScore<=100)?g.rawScore:null,
      avg:(g.avg>=20&&g.avg<=100)?Math.round(g.avg*10)/10:null,
      stdev:(g.stdev>=2&&g.stdev<=40)?g.stdev:null,
      achievement:(g.achievement||'').trim()||null,
      cohort:Number(g.cohort)||null, grade, courseType,
    }
  }).filter(g=>g.subject)
}

async function fullOcrDoc(file, onProg){
  const isPdf=/\.pdf$/i.test(file?.name||'') || String(file?.type||'').includes('pdf')
  if(isPdf){
    onProg?.('PDF 업로드 중…'); const id=await uploadFile(file)
    onProg?.('OCR 주소 발급 중…'); const url=await signedUrl(id)
    return { isPdf:true, ref:{type:'document_url',document_url:url} }
  }
  const dataUrl=await fileToDataUrl(file)
  return { isPdf:false, ref:{type:'image_url',image_url:dataUrl} }
}
async function fullOcr(file, onProg){
  const { ref }=await fullOcrDoc(file, onProg)
  onProg?.('생기부 OCR 분석 중…')
  const result=await callOCR({ model:'mistral-ocr-latest', document:ref, include_image_base64:false, table_format:'html' },{onRetry:onProg})
  return ocrPagesToText(result.pages||[])
}

// Mistral 구조화 스키마 (표를 칸 단위로 정확히 뽑게 함 — 정확도 핵심)
function gradeSchema(){
  return { type:'json_schema', json_schema:{ name:'grade_rows', schema:{ type:'object', additionalProperties:false,
    properties:{ studentName:{type:['string','null']}, schoolName:{type:['string','null']}, grades:{ type:'array', items:{ type:'object', additionalProperties:false,
      properties:{ year:{type:['integer','null']}, semester:{type:['integer','null']}, group:{type:['string','null']}, subject:{type:['string','null']},
        unit:{type:['integer','null']}, rawScore:{type:['number','null']}, avg:{type:['number','null']}, stdev:{type:['number','null']},
        achievement:{type:['string','null']}, cohort:{type:['integer','null']}, grade:{type:['integer','null']}, courseType:{type:['string','null']}, pageNo:{type:['integer','null']}, rowOrder:{type:['integer','null']} },
      required:['year','semester','group','subject','unit','rawScore','avg','stdev','achievement','cohort','grade','courseType','pageNo','rowOrder'] } } },
    required:['grades','studentName','schoolName'] } } }
}
function gradePrompt(){
  return `You are extracting course rows from a Korean high school transcript.
Read the entire document and return ALL visible course rows in their original top-to-bottom order.
Return ONLY a JSON object:
{"grades":[{"year":1,"semester":1,"group":"국어","subject":"문학","unit":4,"rawScore":94,"avg":68.8,"stdev":16.0,"achievement":"A","cohort":344,"grade":1,"courseType":"공통","pageNo":1,"rowOrder":1}],"studentName":"","schoolName":""}
Rules:
- Extract every visible course row in top-to-bottom order, exactly as they appear in the PDF.
- The "year" of each row must match the "[N학년]" header above that table. Do NOT guess year from narrative or "1학년 때 배운" recall.
- If the document only shows [1학년] and [2학년] headers, do NOT create year=3 rows.
- Never merge adjacent rows. The same semester and group can contain multiple different subjects.
- If semester or group cells are merged and blank on a lower row, inherit the previous visible value in the same table.
- pageNo is the original PDF page number. rowOrder is 1,2,3... within each page top to bottom.
- courseType: "공통" for year-1 regular subjects (석차등급 있음), "일반" for year-2/3 regular subjects (석차등급 있음), "진로" for 진로선택 (no 석차등급, has 성취도별 분포비율), "체육예술" for 체육·예술.
- The same subject name may appear in BOTH a regular table AND a 진로 table — keep BOTH with different courseType.
- grade must be 1~9 only when actually visible. 진로/체육예술 rows have grade=null.
- Use null for any field that is not visible. Do not invent years, subjects, scores, or extra rows.`
}

// ============================================================
// AI: 생기부 PDF → 성적 배열
// (1순위: 구조화 annotation OCR / 실패 시 텍스트 청크 방식)
// ============================================================
export async function extractGradesFromPdf(file, onProg){
  // ── 1순위: 구조화 annotation (원본 정확도 방식) ──
  try{
    const { ref }=await fullOcrDoc(file, onProg)
    onProg?.('생기부 표 구조화 분석 중…')
    const annRes=await callOCR({
      model:'mistral-ocr-latest', document:ref, include_image_base64:false, table_format:'html',
      document_annotation_format:gradeSchema(), document_annotation_prompt:gradePrompt(),
    },{onRetry:onProg})
    let ann=annRes.document_annotation
    if(typeof ann==='string') ann=safeJson(ann)
    const rows=(ann?.grades||[]).map((g,i)=>{
      const pageNo=Number(g.pageNo)||1, rowOrder=Number(g.rowOrder)||i+1
      const y=Number(g.year)||null
      return { ...g, year:y, displayOrder:buildAbsoluteDisplayOrder(y||0,pageNo,rowOrder) }
    })
    if(rows.length){
      const cleaned=normalizeGrades(dedupeGradeRows(rows))
      return cleaned.map(g=>({ ...g, term:g.semester }))
    }
  }catch(e){ onProg?.('구조화 실패 → 텍스트 방식으로 재시도… ('+(e?.message||e)+')') }

  // ── 2순위: 텍스트 청크 방식 fallback ──
  const text=await fullOcr(file, onProg)
  if(!text.trim()) throw new Error('OCR 텍스트가 비었습니다')
  const explicitYears=getConfirmedYears(text)
  const pageGroups=groupPagesByYear(text)
  const candidateYears=explicitYears.length?explicitYears:[1,2,3].filter(y=>(pageGroups[y]||[]).length)

  const makePrompt=(year,pageText)=>`아래는 한국 고등학교 생활기록부 OCR 텍스트 일부입니다. 실제로 보이는 과목 행만 JSON으로 추출하세요.
반드시 JSON 객체만 반환:
{"grades":[{"year":${year},"semester":1,"group":"국어","subject":"문학","unit":4,"rawScore":94,"avg":68.8,"stdev":16.0,"achievement":"A","cohort":344,"grade":1,"courseType":"공통","pageNo":1,"rowOrder":1}]}
규칙:
- 실제로 보이는 과목 행을 위에서 아래 순서대로 모두 추출
- 같은 학기/같은 교과에 여러 과목이 있어도 절대 합치지 말 것
- 학기/교과 셀이 병합되어 아래 행이 비어 보이면 바로 위 값 계승
- 일반/공통은 grade 1~9, 진로/체육예술은 grade=null
- 진로는 courseType="진로", 체육/음악/미술은 courseType="체육예술"
- 1학년 일반교과는 courseType="공통", 2~3학년 일반교과는 courseType="일반"
- 숫자는 텍스트 그대로 사용, 없으면 null. 없는 과목/학년/점수는 지어내지 말 것
---
${pageText}`

  let rows=[]
  for(const year of candidateYears){
    const pages=pageGroups[year]||[]
    if(!pages.length) continue
    const chunks=makeTextChunksByPages(pages,12000,1)
    for(let idx=0; idx<chunks.length; idx++){
      onProg?.(`${year}학년 청크 ${idx+1}/${chunks.length} 분석 중…`)
      const resp=await callOAI([{role:'user',content:makePrompt(year,chunks[idx].text)}],{model:'mistral-small-latest',maxTokens:5000,json:true,onRetry:onProg})
      const j=safeJson(resp)
      rows=rows.concat((j.grades||[]).map((g,i)=>{
        const pageNo=Number(g.pageNo)||1, rowOrder=Number(g.rowOrder)||i+1
        return { ...g, year, displayOrder:buildAbsoluteDisplayOrder(year,pageNo,rowOrder) }
      }))
    }
  }
  let cleaned=normalizeGrades(dedupeGradeRows(rows))
  if(explicitYears.length) cleaned=cleaned.filter(g=>explicitYears.includes(g.year))
  return cleaned.map(g=>({ ...g, term:g.semester }))
}
