import { supabase, isConfigured } from './supabase'

const LS = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d }catch{ return d } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)) },
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()))

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

export async function searchAdmissions({ univ, dept, region, type, track, gpaMax, limit=300 }){
  if(isConfigured){
    let q = supabase.from('수시입결').select('*')
    if(univ)   q = q.ilike('univ', `%${univ}%`)
    if(dept)   q = q.ilike('dept', `%${dept}%`)
    if(region) q = q.eq('region', region)
    if(type)   q = q.eq('type', type)
