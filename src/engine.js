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
async function fullOcr(file, onProg){
  const isPdf=/\.pdf$/i.test(file?.name||'') || String(file?.type||'').includes('pdf')
  let documentRef
  if(isPdf){
    onProg?.('PDF 업로드 중…'); const id=await uploadFile(file)
    onProg?.('OCR 주소 발급 중…'); const url=await signedUrl(id)
    documentRef={type:'document_url',document_url:url}
  }else{
    const dataUrl=await fileToDataUrl(file); documentRef={type:'image_url',image_url:dataUrl}
  }
  onProg?.('생기부 OCR 분석 중…')
  const result=await callOCR({ model:'mistral-ocr-latest', document:documentRef, include_image_base64:false, table_format:'html' },{onRetry:onProg})
  return ocrPagesToText(result.pages||[])
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
export function calcGradeAvg(grades, subjectGroups, jinroHandling){
  const groups=subjectGroups||['국어','수학','영어','과학','사회']
  const allGroups=!subjectGroups||subjectGroups.length===0
  const base=(grades||[]).filter(g=>{
    if(g.courseType==='체육예술') return false
    if(g.courseType==='진로') return false
    if(g.grade==null) return false
    const n=Number(g.grade); if(!Number.isFinite(n)||n<1||n>9) return false
    if(!allGroups && !groups.some(gr=>String(g.group||'').includes(gr))) return false
    return true
  })
  let sumW=0,sumG=0
  for(const g of base){ const u=Number(g.unit)||1; sumG+=Number(g.grade)*u; sumW+=u }
  if(jinroHandling && jinroHandling!=='미반영'){
    const jinro=(grades||[]).filter(g=>g.courseType==='진로' && (allGroups||groups.some(gr=>String(g.group||'').includes(gr))))
    for(const g of jinro){ const cv=jinroAchievToGrade(g.achievement,jinroHandling); if(cv!=null){ const u=Number(g.unit)||1; sumG+=cv*u; sumW+=u } }
  }
  return sumW>0 ? sumG/sumW : null
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

// 한 지원행(대학·전형)에 대해 학생 교과등급 계산
export function gradeForRow(row, grades, uniGuides){
  if(!grades || !grades.length) return null
  const tt=row.type||''
  if(tt.includes('종합') || tt.includes('논술')) return calcOverallAvg(grades)
  if(tt.includes('교과')){
    const guide=findGuideForUni(uniGuides, row.univ)
    if(guide){
      const gt=findGuideTrack(guide,row)
      if(gt) return calcGradeAvg(grades, gt.subjectGroups?.length?gt.subjectGroups:null, gt.jinroHandling||null)
    }
    const groups=parseSubjectGroups(row.subjects)
    return calcGradeAvg(grades, groups, null)
  }
  return calcOverallAvg(grades)
}
// 계산 근거 라벨
export function gradeSource(row, grades, uniGuides){
  if(!grades || !grades.length) return null
  const tt=row.type||''
  if(tt.includes('종합')||tt.includes('논술')) return '전체평균'
  if(tt.includes('교과')){
    const guide=findGuideForUni(uniGuides, row.univ)
    if(guide){ const gt=findGuideTrack(guide,row); if(gt) return `📐${gt.trackName||'요강'}` }
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
  const prompt=`These images are pages from a Korean university admission guide. Extract 교과전형/종합전형 info as JSON.
Return ONLY this JSON shape:
{"university":"대학명(한글)","tracks":[{"trackName":"전형명 정확히(모집요강 그대로)","trackType":"교과" or "종합","subjectGroups":["국어","수학","영어","과학"],"weights":{"국어":30,"수학":30,"영어":20,"과학":20},"jinroHandling":"미반영" or "A:1등급,B:3등급,C:5등급" or null,"topN":null or number,"cutoffNote":"자유문자열" or null,"evalAreas":["학업역량","진로역량","공동체역량"]}],"changeNotes":[]}
규칙: trackName은 정식명칭 그대로. weights는 숫자 객체(합100). 종합전형은 weights={},subjectGroups=[],evalAreas만. 교과전형은 weights,subjectGroups 채우고 evalAreas=[]. 불명확하면 null. 추측 금지.`
  onProg?.('모집요강 분석 중…')
  const resp=await callOAI([{role:'user',content:[{type:'text',text:prompt},...visionContent(imgs)]}],{maxTokens:3000})
  const raw=safeJson(resp)
  const out={ university:String(raw?.university||'').trim(), tracks:[], changeNotes:Array.isArray(raw?.changeNotes)?raw.changeNotes.map(String).filter(Boolean):[] }
  for(const t of (Array.isArray(raw?.tracks)?raw.tracks:[])){
    if(!t||typeof t!=='object') continue
    let weights={}
    if(t.weights && typeof t.weights==='object' && !Array.isArray(t.weights)){
      for(const [k,v] of Object.entries(t.weights)){ const n=Number(v); if(Number.isFinite(n)&&n>0) weights[String(k).trim()]=n }
    }
    let subjectGroups=[]
    if(Array.isArray(t.subjectGroups)) for(const s of t.subjectGroups){ if(typeof s==='string'&&s.trim()) subjectGroups.push(s.trim()) }
    let evalAreas=[]
    if(Array.isArray(t.evalAreas)) for(const a of t.evalAreas){ if(typeof a==='string'&&a.trim()) evalAreas.push(a.trim()); else if(a?.name) evalAreas.push(String(a.name).trim()) }
    out.tracks.push({
      trackName:String(t.trackName||'').trim(),
      trackType:(t.trackType==='교과'||t.trackType==='종합')?t.trackType:(subjectGroups.length?'교과':'종합'),
      subjectGroups, weights,
      jinroHandling:t.jinroHandling?String(t.jinroHandling).trim():null,
      topN:Number.isFinite(Number(t.topN))?Number(t.topN):null,
      cutoffNote:t.cutoffNote?String(t.cutoffNote).trim():null,
      evalAreas,
    })
  }
  return out
}

// ============================================================
// AI: 생기부 PDF → 성적 배열 추출
// ============================================================
export async function extractGradesFromPdf(file, onProg){
  const text=await fullOcr(file, onProg)
  if(!text.trim()) throw new Error('OCR 텍스트가 비었습니다')
  onProg?.('성적 정리 중…')
  const prompt=`아래는 한국 고교 생활기록부 OCR 텍스트입니다. 교과 성적을 JSON 배열로 추출하세요. 반드시 JSON만:
{"grades":[{"year":1,"term":1,"group":"국어","subject":"국어","unit":4,"grade":2,"rawScore":88,"mean":70,"stdev":12,"achievement":null,"courseType":"공통"}]}
규칙:
- courseType: 1학년 일반교과="공통", 2~3학년 일반교과="일반"(석차등급 있음), 진로선택="진로"(석차등급 없고 성취도 A/B/C), 체육·예술="체육예술".
- group은 교과(국어/수학/영어/과학/사회/한국사/체육/예술 등).
- 진로선택은 grade=null, achievement에 A/B/C.
- 같은 학기 같은 교과에 여러 과목 있어도 합치지 말 것. 없는 값은 null.
---
${text.slice(0,24000)}`
  const resp=await callOAI([{role:'user',content:prompt}],{model:'mistral-small-latest',maxTokens:8000,json:true})
  const raw=safeJson(resp)
  const arr=Array.isArray(raw)?raw:(raw?.grades||[])
  return arr.map(g=>({
    year:Number(g.year)||null, term:Number(g.term)||null,
    group:String(g.group||g.교과||'').trim(), subject:String(g.subject||g.과목||'').trim(),
    unit:Number(g.unit)||1, grade:(g.grade==null?null:Number(g.grade)),
    rawScore:g.rawScore!=null?Number(g.rawScore):null, mean:g.mean!=null?Number(g.mean):null, stdev:g.stdev!=null?Number(g.stdev):null,
    achievement:g.achievement?String(g.achievement).trim().toUpperCase():null,
    courseType:['공통','일반','진로','체육예술'].includes(g.courseType)?g.courseType:(g.grade==null?'진로':'일반'),
  }))
}
