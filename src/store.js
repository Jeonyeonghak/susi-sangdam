import { supabase, isConfigured } from './supabase'

// ------------------------------------------------------------------
// 데이터 레이어. Supabase가 설정돼 있으면 실서비스, 아니면 localStorage
// (설정 전에도 UI를 바로 시험해볼 수 있게 하는 폴백입니다).
// ------------------------------------------------------------------

const LS = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d }catch{ return d } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)) },
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()))

// ---------- Teachers ----------
export async function listTeachers(){
  if(isConfigured){
    const { data } = await supabase.from('수시담임').select('*').order('created_at')
    return data || []
  }
  return LS.get('teachers', [])
}
export async function addTeacher(name){
  if(isConfigured){
    const { data } = await supabase.from('수시담임').insert({ name }).select().single()
    return data
  }
  const t = { id: uid(), name, created_at: new Date().toISOString() }
  const all = LS.get('teachers', []); all.push(t); LS.set('teachers', all); return t
}

// ---------- Students ----------
export async function listStudents(teacherId){
  if(isConfigured){
    let q = supabase.from('수시학생들').select('*').order('created_at')
    if(teacherId) q = q.eq('teacher_id', teacherId)
    const { data } = await q
    return data || []
  }
  const all = LS.get('students', [])
  return teacherId ? all.filter(s => s.teacher_id === teacherId) : all
}
export async function addStudent(s){
  const rec = { ...s }
  if(isConfigured){
    const { data } = await supabase.from('수시학생들').insert(rec).select().single()
    return data
  }
  rec.id = uid(); rec.created_at = new Date().toISOString()
  const all = LS.get('students', []); all.push(rec); LS.set('students', all); return rec
}
export async function addStudentsBulk(rows){
  if(isConfigured){
    const { data } = await supabase.from('수시학생들').insert(rows).select()
    return data || []
  }
  const all = LS.get('students', [])
  const out = rows.map(r => ({ ...r, id: uid(), created_at: new Date().toISOString() }))
  LS.set('students', [...all, ...out]); return out
}
export async function updateStudent(id, patch){
  if(isConfigured){ await supabase.from('수시학생들').update(patch).eq('id', id); return }
  const all = LS.get('students', [])
  LS.set('students', all.map(s => s.id === id ? { ...s, ...patch } : s))
}
export async function deleteStudent(id){
  if(isConfigured){ await supabase.from('수시학생들').delete().eq('id', id); return }
  LS.set('students', LS.get('students', []).filter(s => s.id !== id))
  LS.set('picks', LS.get('picks', []).filter(p => p.student_id !== id))
}

// ---------- Admissions (입결 검색) ----------
export async function searchAdmissions({ univ, dept, region, type, track, gpaMax, limit=300 }){
  if(isConfigured){
    let q = supabase.from('수시입결').select('*')
    if(univ)   q = q.ilike('univ', `%${univ}%`)
    if(dept)   q = q.ilike('dept', `%${dept}%`)
    if(region) q = q.eq('region', region)
    if(type)   q = q.eq('type', type)
    if(track)  q = q.eq('track', track)
    if(gpaMax) q = q.gte('cut26', gpaMax) // 컷 등급이 학생 등급보다 큰(=낮은 성적도 붙는) 곳
    q = q.order('cut26', { ascending: true, nullsFirst: false }).limit(limit)
    const { data } = await q
    return data || []
  }
  // 폴백: 로컬 데모 데이터 (public/admissions_sample.json)
  const sample = await fetch('/admissions_sample.json').then(r=>r.json()).catch(()=>[])
  return sample.filter(a => {
    if(univ && !String(a.univ||'').includes(univ)) return false
    if(dept && !String(a.dept||'').includes(dept)) return false
    if(region && a.region!==region) return false
    if(type && a.type!==type) return false
    if(track && a.track!==track) return false
    return true
  }).slice(0, limit)
}
export async function distinctRegions(){
  if(isConfigured){
    // 전체에서 지역 목록 (중복 제거는 클라이언트에서)
    const { data } = await supabase.from('수시입결').select('region').limit(30000)
    return [...new Set((data||[]).map(d=>d.region).filter(Boolean))].sort()
  }
  return ['서울','경기','인천','충남','충북','대전','세종','대구','광주','부산','경북','경남','전남','전북','강원','울산','제주','전북특별자치도','강원특별자치도']
}
export async function distinctTypes(){
  if(isConfigured){
    const { data } = await supabase.from('수시입결').select('type').limit(30000)
    return [...new Set((data||[]).map(d=>d.type).filter(Boolean))].sort()
  }
  return ['학생부종합','학생부교과','논술','실기/실적']
}
// 전체 대학 목록 (지역으로 좁힐 수 있음)
export async function distinctUnivs(region){
  if(isConfigured){
    let q = supabase.from('수시입결').select('univ,region').limit(30000)
    if(region) q = q.eq('region', region)
    const { data } = await q
    return [...new Set((data||[]).map(d=>d.univ).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'))
  }
  const sample = await fetch('/admissions_sample.json').then(r=>r.json()).catch(()=>[])
  return [...new Set(sample.filter(a=>!region||a.region===region).map(a=>a.univ).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'))
}
// 특정 대학의 학과(모집단위) 목록
export async function distinctDepts(univ, track){
  if(!univ) return []
  if(isConfigured){
    let q = supabase.from('수시입결').select('dept,track').eq('univ', univ).limit(30000)
    if(track) q = q.eq('track', track)
    const { data } = await q
    return [...new Set((data||[]).map(d=>d.dept).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'))
  }
  const sample = await fetch('/admissions_sample.json').then(r=>r.json()).catch(()=>[])
  return [...new Set(sample.filter(a=>a.univ===univ && (!track||a.track===track)).map(a=>a.dept).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'))
}

// ---------- Picks (관심학과 담기 → 최종 지원) ----------
export async function listPicks(studentId){
  if(isConfigured){
    const { data } = await supabase.from('수시담기').select('*')
      .eq('student_id', studentId).order('sort_order').order('created_at')
    return data || []
  }
  return LS.get('picks', []).filter(p => p.student_id === studentId)
}
export async function addPick(studentId, adm){
  const snap = {
    student_id: studentId, admission_id: adm.id,
    univ: adm.univ, dept: adm.dept, type: adm.type, name: adm.name,
    cut26: adm.cut26 ?? null, comp26: adm.comp26 ?? null,
    minreq: adm.minreq ?? null, examdate: adm.examdate ?? null,
    judgment: '적정', slot: '', status: '관심', reason: '', sort_order: 0,
  }
  if(isConfigured){
    const { data } = await supabase.from('수시담기').insert(snap).select().single()
    return data
  }
  const rec = { ...snap, id: uid(), created_at: new Date().toISOString() }
  const all = LS.get('picks', []); all.push(rec); LS.set('picks', all); return rec
}
export async function updatePick(id, patch){
  if(isConfigured){ await supabase.from('수시담기').update(patch).eq('id', id); return }
  LS.set('picks', LS.get('picks', []).map(p => p.id === id ? { ...p, ...patch } : p))
}
export async function deletePick(id){
  if(isConfigured){ await supabase.from('수시담기').delete().eq('id', id); return }
  LS.set('picks', LS.get('picks', []).filter(p => p.id !== id))
}
