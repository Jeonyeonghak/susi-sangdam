import { useEffect, useMemo, useState, useCallback } from 'react'
import { isConfigured } from './supabase'
import * as db from './store'
import * as eng from './engine'

const JUDGMENTS = ['안정','적정','도전','상향']
const STATUSES  = ['관심','지원확정','보류','제외']
const fmt = v => (v===null||v===undefined||v==='') ? '–' : v

// 학생 등급 대비 컷 등급으로 안정/적정/도전/상향 자동 제안
function suggestJudgment(gpa, cut){
  if(gpa==null || cut==null) return null
  const d = cut - gpa // (+)면 컷이 학생보다 낮은 성적 = 여유
  if(d >= 0.4) return '안정'
  if(d >= -0.1) return '적정'
  if(d >= -0.5) return '도전'
  return '상향'
}

export default function App(){
  const [tab, setTab] = useState('students')
  const [teachers, setTeachers] = useState([])
  const [teacherId, setTeacherId] = useState(localStorage.getItem('teacherId') || '')
  const [students, setStudents] = useState([])
  const [selStudent, setSelStudent] = useState(null)
  const [toast, setToast] = useState('')
  const [guides, setGuides] = useState({})

  const flash = useCallback(msg => { setToast(msg); setTimeout(()=>setToast(''), 2000) }, [])

  useEffect(()=>{ db.listTeachers().then(setTeachers) }, [])
  useEffect(()=>{ db.loadGuides().then(setGuides) }, [])
  const reloadGuides = useCallback(async ()=>{ setGuides(await db.loadGuides()) }, [])
  useEffect(()=>{
    db.listStudents(teacherId || undefined).then(setStudents)
  }, [teacherId])

  useEffect(()=>{
    if(teacherId) localStorage.setItem('teacherId', teacherId)
  }, [teacherId])

  const refreshStudents = useCallback(async ()=>{
    setStudents(await db.listStudents(teacherId || undefined))
  }, [teacherId])

  const teacherName = teachers.find(t=>t.id===teacherId)?.name || '전체'

  return (
    <div className="app">
      <div className="topbar no-print">
        <div className="brand">대입 지원 상담<small>강남한국학원 · DnA입시LAB</small></div>
        <div className="tabs">
          <button className={`tab ${tab==='students'?'active':''}`} onClick={()=>setTab('students')}>① 학생 로우데이터</button>
          <button className={`tab ${tab==='search'?'active':''}`} onClick={()=>setTab('search')}
            disabled={!selStudent}>② 관심학과 담기</button>
          <button className={`tab ${tab==='report'?'active':''}`} onClick={()=>setTab('report')}
            disabled={!selStudent}>③ 최종 지원 보고서</button>
          <button className={`tab ${tab==='guides'?'active':''}`} onClick={()=>setTab('guides')}>📐 모집요강</button>
        </div>
        <div className="spacer" />
        <TeacherPicker {...{teachers, teacherId, setTeacherId, setTeachers, flash}} />
      </div>

      {!isConfigured && (
        <div className="banner no-print" style={{margin:'12px 18px 0'}}>
          Supabase가 아직 연결되지 않았습니다. 지금은 브라우저 로컬 저장 + 데모 입결로 동작합니다.
          실데이터를 쓰려면 <code>supabase_schema.sql</code> 실행 후 환경변수(VITE_SUPABASE_URL / _ANON_KEY)를 넣어 주세요.
        </div>
      )}

      <div className="main">
        {tab==='students' && (
          <StudentsTab
            students={students} teacherId={teacherId}
            selStudent={selStudent} setSelStudent={setSelStudent}
            refresh={refreshStudents} flash={flash} goSearch={()=>setTab('search')} />
        )}
        {tab==='search' && selStudent && (
          <SearchTab student={selStudent} guides={guides} flash={flash} />
        )}
        {tab==='report' && selStudent && (
          <ReportTab student={selStudent} teacherName={teacherName} guides={guides} />
        )}
        {tab==='guides' && (
          <GuidesTab guides={guides} reloadGuides={reloadGuides} flash={flash} />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ---------------- 담임 선택 ---------------- */
function TeacherPicker({ teachers, teacherId, setTeacherId, setTeachers, flash }){
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const add = async ()=>{
    if(!name.trim()) return
    const t = await db.addTeacher(name.trim())
    setTeachers(await db.listTeachers()); setTeacherId(t.id); setName(''); setAdding(false)
    flash('담임 추가됨')
  }
  const startEdit = ()=>{
    const cur = teachers.find(t=>t.id===teacherId)
    if(!cur) return
    setEditName(cur.name); setEditing(true)
  }
  const saveEdit = async ()=>{
    if(!editName.trim()) return
    await db.updateTeacher(teacherId, editName.trim())
    setTeachers(await db.listTeachers()); setEditing(false); flash('담임 이름 수정됨')
  }
  const removeTeacher = async ()=>{
    const cur = teachers.find(t=>t.id===teacherId)
    if(!cur) return
    if(!confirm(`담임 "${cur.name}"을(를) 삭제할까요?\n소속 학생은 삭제되지 않고 '전체'에 남습니다.`)) return
    await db.deleteTeacher(teacherId)
    setTeachers(await db.listTeachers()); setTeacherId(''); flash('담임 삭제됨')
  }
  return (
    <div className="teacher-pick">
      <span className="muted" style={{fontSize:12}}>담임</span>
      {editing ? (
        <>
          <input className="inp" style={{width:110}} value={editName}
            onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveEdit()} />
          <button className="btn sm primary" onClick={saveEdit}>저장</button>
          <button className="btn sm ghost" onClick={()=>setEditing(false)}>취소</button>
        </>
      ) : (
        <>
          <select value={teacherId} onChange={e=>setTeacherId(e.target.value)}>
            <option value="">전체</option>
            {teachers.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {teacherId && !adding && (
            <>
              <button className="btn sm ghost" onClick={startEdit} title="담임 이름 수정">✎</button>
              <button className="btn sm ghost danger" onClick={removeTeacher} title="담임 삭제">✕</button>
            </>
          )}
          {adding ? (
            <>
              <input className="inp" style={{width:110}} placeholder="이름" value={name}
                onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} />
              <button className="btn sm primary" onClick={add}>추가</button>
              <button className="btn sm ghost" onClick={()=>setAdding(false)}>취소</button>
            </>
          ) : (
            <button className="btn sm" onClick={()=>setAdding(true)}>+ 담임</button>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------- ① 학생 로우데이터 ---------------- */
function StudentsTab({ students, teacherId, selStudent, setSelStudent, refresh, flash, goSearch }){
  const [form, setForm] = useState(blankStudent())
  const [csv, setCsv] = useState('')
  const [showCsv, setShowCsv] = useState(false)

  function blankStudent(){
    return { name:'', school:'', grade:'고3', track:'자연', gpa:'', gpa_main:'', mock:'', target:'', memo:'' }
  }
  const set = (k,v)=> setForm(f=>({ ...f, [k]:v }))

  const save = async ()=>{
    if(!form.name.trim()){ flash('이름을 입력하세요'); return }
    if(!teacherId){ flash('먼저 위쪽에서 담임을 선택하세요'); return }
    const rec = {
      teacher_id: teacherId, name: form.name.trim(), school: form.school || null,
      grade: form.grade || null, track: form.track || null,
      gpa: num(form.gpa), target: form.target || null, memo: form.memo || null,
    }
    const saved = await db.addStudent(rec); setForm(blankStudent()); await refresh()
    if(saved) setSelStudent(saved)
    flash('학생 저장됨 · 이제 생기부를 올려 성적을 채우세요')
  }

  const importCsv = async ()=>{
    const rows = parseCsv(csv, teacherId)
    if(!rows.length){ flash('붙여넣은 데이터가 없습니다'); return }
    await db.addStudentsBulk(rows); setCsv(''); setShowCsv(false); await refresh()
    flash(`${rows.length}명 일괄 등록됨`)
  }

  const remove = async (id)=>{
    if(!confirm('학생과 담긴 관심학과가 모두 삭제됩니다. 계속할까요?')) return
    await db.deleteStudent(id); if(selStudent?.id===id) setSelStudent(null); await refresh(); flash('삭제됨')
  }

  return (
    <>
      <div className="pane pane-left">
        <div className="card">
          <div className="row" style={{justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <h3 style={{margin:0}}>학생 명단 {students.length>0 && <span className="muted">({students.length})</span>}</h3>
            <button className="btn sm" onClick={()=>setShowCsv(s=>!s)}>{showCsv?'닫기':'CSV 붙여넣기'}</button>
          </div>
          {showCsv && (
            <div style={{marginBottom:10}}>
              <div className="muted" style={{fontSize:12,marginBottom:6}}>
                헤더: 이름,출신고,학년,계열,내신,주요교과,모의고사,희망진로,메모 (탭 또는 콤마 구분)
              </div>
              <textarea className="inp" style={{minHeight:120,fontFamily:'monospace',fontSize:12}}
                placeholder={"이채문\t세종캠퍼스고\t고2\t자연\t1.8\t1.6\t3등급대\t항공우주"}
                value={csv} onChange={e=>setCsv(e.target.value)} />
              <button className="btn sm primary" style={{marginTop:6}} onClick={importCsv}>일괄 등록</button>
            </div>
          )}
          {students.length===0 && <div className="empty">등록된 학생이 없습니다.</div>}
          {students.map(s=>(
            <div key={s.id} className={`student-item ${selStudent?.id===s.id?'sel':''}`}
              onClick={()=>setSelStudent(s)}>
              <div className="grow">
                <div className="nm">{s.name} {s.track && <span className={`pill ${s.track}`}>{s.track}</span>}</div>
                <div className="meta">{[s.school,s.grade,s.gpa!=null?`내신 ${s.gpa}`:null].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn sm ghost danger" onClick={e=>{e.stopPropagation();remove(s.id)}}>삭제</button>
            </div>
          ))}
        </div>
      </div>

      <div className="pane pane-right">
        {selStudent ? (
          <div style={{maxWidth:720}}>
            <PickedSummary student={selStudent} goSearch={goSearch} />
            <div className="card">
              <h3 style={{margin:'0 0 4px'}}>{selStudent.name} · 정보 수정</h3>
              <StudentDetail student={selStudent} onSaved={async()=>{await refresh()}} flash={flash}
                setSelStudent={setSelStudent} />
            </div>
          </div>
        ) : (
          <div className="card" style={{maxWidth:640}}>
            <h3>새 학생 추가</h3>
            <div className="row">
              <label className="field grow"><span>이름 *</span>
                <input className="inp" value={form.name} onChange={e=>set('name',e.target.value)} /></label>
              <label className="field grow"><span>출신고</span>
                <input className="inp" value={form.school} onChange={e=>set('school',e.target.value)} /></label>
            </div>
            <div className="row">
              <label className="field"><span>학년</span>
                <select className="inp" value={form.grade} onChange={e=>set('grade',e.target.value)}>
                  <option>고1</option><option>고2</option><option>고3</option><option>N수</option>
                </select></label>
              <label className="field"><span>계열</span>
                <select className="inp" value={form.track} onChange={e=>set('track',e.target.value)}>
                  <option>자연</option><option>인문</option><option>통합</option>
                </select></label>
              <label className="field grow"><span>내신(전과목)</span>
                <input className="inp" value={form.gpa} onChange={e=>set('gpa',e.target.value)} placeholder="생기부 올리면 자동" /></label>
            </div>
            <label className="field"><span>희망 진로 / 학과 방향</span>
              <input className="inp" value={form.target} onChange={e=>set('target',e.target.value)} placeholder="항공우주 · 데이터/AI" /></label>
            <label className="field"><span>상담 메모</span>
              <textarea className="inp" value={form.memo} onChange={e=>set('memo',e.target.value)} /></label>
            <button className="btn primary" onClick={save}>학생 저장</button>
            <div className="muted" style={{fontSize:12,marginTop:8}}>학생을 저장하면 생기부 PDF를 올릴 수 있고, 성적·내신이 자동으로 채워집니다.</div>
          </div>
        )}
      </div>
    </>
  )
}

function PickedSummary({ student, goSearch }){
  const [picks, setPicks] = useState([])
  useEffect(()=>{ db.listPicks(student.id).then(setPicks) }, [student.id])
  const order = { 안정:0, 적정:1, 도전:2, 상향:3 }
  const sorted = [...picks].filter(p=>p.status!=='제외').sort((a,b)=>(order[a.judgment]??9)-(order[b.judgment]??9))
  const confirmed = picks.filter(p=>p.status==='지원확정').length

  return (
    <div className="card">
      <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
        <h3 style={{margin:0}}>{student.name} · 상담 현황</h3>
        <button className="btn primary" onClick={goSearch}>관심학과 담으러 가기 →</button>
      </div>
      <div className="muted" style={{fontSize:13,marginTop:6}}>
        {[student.school, student.grade, student.track && `${student.track}계열`].filter(Boolean).join(' · ')}
        {student.gpa!=null && ` · 내신 ${student.gpa}`}
        {student.target && ` · 희망: ${student.target}`}
      </div>

      {student.memo && (
        <div style={{marginTop:12}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--sub)',marginBottom:4}}>상담 메모</div>
          <div style={{fontSize:13,whiteSpace:'pre-wrap',background:'#fafbfc',border:'1px solid var(--line)',borderRadius:8,padding:'8px 10px'}}>{student.memo}</div>
        </div>
      )}

      <div style={{marginTop:14}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--sub)',marginBottom:6}}>
          담은 관심학과 {sorted.length>0 && `(${sorted.length}개 · 지원확정 ${confirmed})`}
        </div>
        {sorted.length===0 ? (
          <div className="muted" style={{fontSize:13}}>아직 담은 학과가 없습니다. 위 버튼으로 담아 보세요.</div>
        ) : (
          <table style={{fontSize:13}}>
            <thead><tr><th>판정</th><th>상태</th><th>대학</th><th>모집단위</th><th>전형</th><th className="num">26컷</th><th>슬롯</th></tr></thead>
            <tbody>
              {sorted.map(p=>(
                <tr key={p.id}>
                  <td><span className={`j-badge j-${p.judgment}`}>{p.judgment}</span></td>
                  <td>{p.status}</td>
                  <td><b>{p.univ}</b></td>
                  <td>{p.dept}</td>
                  <td>{p.name}</td>
                  <td className="num">{fmt(p.cut26)}</td>
                  <td>{fmt(p.slot)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StudentDetail({ student, onSaved, flash, setSelStudent }){
  const [f, setF] = useState(student)
  useEffect(()=>{ setF(student) }, [student.id])
  const set = (k,v)=> setF(p=>({ ...p, [k]:v }))
  const save = async ()=>{
    const patch = {
      name:f.name, school:f.school, grade:f.grade, track:f.track,
      gpa:num(f.gpa), target:f.target, memo:f.memo,
    }
    await db.updateStudent(student.id, patch)
    setSelStudent({ ...student, ...patch }); await onSaved(); flash('저장됨')
  }
  return (
    <div style={{marginTop:12}}>
      <div className="row">
        <label className="field grow"><span>이름</span>
          <input className="inp" value={f.name||''} onChange={e=>set('name',e.target.value)} /></label>
        <label className="field grow"><span>출신고</span>
          <input className="inp" value={f.school||''} onChange={e=>set('school',e.target.value)} /></label>
      </div>
      <div className="row">
        <label className="field"><span>학년</span>
          <input className="inp" value={f.grade||''} onChange={e=>set('grade',e.target.value)} /></label>
        <label className="field"><span>계열</span>
          <select className="inp" value={f.track||'자연'} onChange={e=>set('track',e.target.value)}>
            <option>자연</option><option>인문</option><option>통합</option>
          </select></label>
        <label className="field grow"><span>내신 {f.grades?.length ? '(생기부 자동)' : ''}</span>
          <input className="inp" value={f.gpa??''} onChange={e=>set('gpa',e.target.value)} /></label>
      </div>
      <label className="field"><span>희망 진로</span>
        <input className="inp" value={f.target||''} onChange={e=>set('target',e.target.value)} /></label>
      <label className="field"><span>메모</span>
        <textarea className="inp" value={f.memo||''} onChange={e=>set('memo',e.target.value)} /></label>
      <div className="row">
        <button className="btn primary" onClick={save}>변경 저장</button>
        <button className="btn ghost" onClick={()=>setSelStudent(null)}>새 학생 추가로</button>
      </div>

      <GradebookUploader student={student} onSaved={onSaved} setSelStudent={setSelStudent} flash={flash} />
    </div>
  )
}

function GradebookUploader({ student, onSaved, setSelStudent, flash }){
  const [busy, setBusy] = useState('')
  const grades = student.grades || []
  const overall = grades.length ? eng.calcOverallAvg(grades) : null
  const sci = grades.length ? eng.calcGradeAvg(grades,['국어','수학','영어','과학'],null) : null
  const hum = grades.length ? eng.calcGradeAvg(grades,['국어','수학','영어','사회'],null) : null

  // 성적 저장 + 내신(전과목 평균) 자동 반영
  const persist = async (newGrades)=>{
    const gpa = eng.calcOverallAvg(newGrades)
    await db.saveStudentGrades(student.id, newGrades)
    if(gpa!=null) await db.updateStudent(student.id, { gpa: Math.round(gpa*100)/100 })
    setSelStudent({ ...student, grades:newGrades, gpa: gpa!=null?Math.round(gpa*100)/100:student.gpa })
    await onSaved()
  }

  const upload = async (file)=>{
    if(!file) return
    if(!eng.hasAI){ flash('AI 키가 없습니다 (Vercel 환경변수 VITE_MISTRAL_KEY)'); return }
    try{
      const g = await eng.extractGradesFromPdf(file, msg=>setBusy(msg))
      if(!g.length){ flash('성적을 읽지 못했습니다. PDF 화질/범위를 확인하세요'); return }
      await persist(g)
      const ov = eng.calcOverallAvg(g)
      flash(`성적 ${g.length}과목 · 전체평균 ${ov!=null?ov.toFixed(2):'–'} — 아래 표에서 확인/수정하세요`)
    }catch(err){ flash('추출 실패: '+(err?.message||err)) }
    finally{ setBusy('') }
  }

  const updateRow = async (id, field, val)=>{
    const numFields=['unit','rawScore','grade','avg','stdev']
    const parsed = val==='' ? null : (numFields.includes(field) ? Number(val) : val)
    const ng = grades.map(x=> x.id===id ? { ...x, [field]: (numFields.includes(field) && Number.isNaN(parsed)) ? null : parsed } : x)
    await persist(ng)
  }
  const deleteRow = async (id)=>{
    const g = grades.find(x=>x.id===id)
    if(!confirm(`"${g?.subject}" 행을 삭제할까요?`)) return
    await persist(grades.filter(x=>x.id!==id))
  }

  return (
    <div style={{marginTop:14,borderTop:'1px solid var(--line)',paddingTop:12}}>
      <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--sub)'}}>
          생기부 성적 {grades.length>0 ? `· ${grades.length}과목` : '· 미등록'}
        </div>
        {grades.length>0 && (
          <div style={{fontSize:12,display:'flex',gap:14}}>
            <span className="muted">전체 <b style={{color:'var(--ink)'}}>{overall?.toFixed(2)??'–'}</b></span>
            <span className="muted">이과(국수영과) <b style={{color:'var(--ink)'}}>{sci?.toFixed(2)??'–'}</b></span>
            <span className="muted">문과(국수영사) <b style={{color:'var(--ink)'}}>{hum?.toFixed(2)??'–'}</b></span>
          </div>
        )}
      </div>
      {busy && <div className="banner" style={{marginTop:8}}>{busy}</div>}
      <div style={{marginTop:8}}>
        <label className="btn sm" style={{display:'inline-block'}}>
          {grades.length>0 ? '생기부 다시 올리기' : '생기부 PDF 업로드'}
          <input type="file" accept="application/pdf,image/*" style={{display:'none'}}
            onChange={e=>upload(e.target.files?.[0])} />
        </label>
        {!eng.hasAI && <span className="muted" style={{marginLeft:8,fontSize:11}}>※ AI 키 미설정</span>}
      </div>

      {grades.length>0 && (
        <>
          <div className="muted" style={{fontSize:11,margin:'10px 0 4px'}}>
            AI가 읽은 성적입니다. 틀린 등급·유형·단위가 있으면 셀을 고치세요(입력 후 다른 곳 클릭). 내신·교과등급이 자동 재계산됩니다.
            <br/>유형: <b>공통/일반</b>=석차등급 있는 교과 · <b>진로</b>=성취도 A/B/C · <b>체육예술</b>=계산 제외
          </div>
          <div className="tablewrap" style={{maxHeight:360}}>
            <table style={{fontSize:12}}>
              <thead><tr>
                <th>학년</th><th>교과</th><th>과목</th><th>유형</th>
                <th className="num">단위</th><th className="num">등급</th><th>성취</th><th></th>
              </tr></thead>
              <tbody>
                {grades.map(g=>(
                  <tr key={g.id} style={g.courseType==='체육예술'?{opacity:.5}:undefined}>
                    <td>{g.year}-{g.semester||g.term||''}</td>
                    <td>{g.group}</td>
                    <td>{g.subject}</td>
                    <td>
                      <select defaultValue={g.courseType||'일반'} onChange={e=>updateRow(g.id,'courseType',e.target.value)}
                        style={{padding:'2px 4px',border:'1px solid var(--line)',borderRadius:4}}>
                        <option>공통</option><option>일반</option><option>진로</option><option>체육예술</option>
                      </select>
                    </td>
                    <td className="num"><input defaultValue={g.unit??''} onBlur={e=>updateRow(g.id,'unit',e.target.value)} style={{width:36,textAlign:'right',border:'1px solid var(--line)',borderRadius:4,padding:'2px'}} /></td>
                    <td className="num"><input defaultValue={g.grade??''} onBlur={e=>updateRow(g.id,'grade',e.target.value)} style={{width:36,textAlign:'right',border:'1px solid var(--line)',borderRadius:4,padding:'2px'}} /></td>
                    <td><input defaultValue={g.achievement??''} onBlur={e=>updateRow(g.id,'achievement',e.target.value)} style={{width:34,border:'1px solid var(--line)',borderRadius:4,padding:'2px'}} /></td>
                    <td><button className="btn sm ghost danger" onClick={()=>deleteRow(g.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ---------------- ② 관심학과 담기 (입결 검색) ---------------- */
function SearchTab({ student, guides, flash }){
  const [q, setQ] = useState({ univ:'', dept:'', region:'', type:'', track: student.track||'' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [picks, setPicks] = useState([])
  const [regions, setRegions] = useState([])
  const [types, setTypes] = useState([])
  const [univs, setUnivs] = useState([])
  const [depts, setDepts] = useState([])
  const [onlyReachable, setOnlyReachable] = useState(false)

  useEffect(()=>{ db.distinctRegions().then(setRegions); db.distinctTypes().then(setTypes) }, [])
  useEffect(()=>{ db.distinctUnivs(q.region).then(setUnivs) }, [q.region])
  useEffect(()=>{
    if(q.univ){ db.distinctDepts(q.univ, q.track).then(setDepts) } else setDepts([])
  }, [q.univ, q.track])
  useEffect(()=>{ db.listPicks(student.id).then(setPicks) }, [student.id])

  const hasFilter = Boolean(q.univ.trim() || q.dept.trim() || q.region || q.type)

  useEffect(()=>{
    if(!hasFilter){ setRows([]); return }
    setLoading(true)
    const t = setTimeout(async ()=>{
      const res = await db.searchAdmissions({
        univ:q.univ.trim(), dept:q.dept.trim(), region:q.region, type:q.type, track:q.track,
        gpaMax: onlyReachable ? (student.gpa ?? undefined) : undefined,
      })
      setRows(res); setLoading(false)
    }, 300)
    return ()=> clearTimeout(t)
  }, [q.univ, q.dept, q.region, q.type, q.track, onlyReachable, hasFilter, student.gpa])

  const pickedIds = useMemo(()=> new Set(picks.map(p=>p.admission_id)), [picks])
  const add = async (adm, myGrade)=>{
    if(pickedIds.has(adm.id)){ flash('이미 담긴 학과입니다'); return }
    const p = await db.addPick(student.id, adm)
    const basis = myGrade!=null ? myGrade : student.gpa
    const sug = suggestJudgment(basis, adm.cut26)
    const patch = {}
    if(sug) patch.judgment = sug
    if(myGrade!=null) patch.reason = `내 교과 ${myGrade.toFixed(2)} · 26컷 ${adm.cut26 ?? '–'}`
    if(Object.keys(patch).length){ await db.updatePick(p.id, patch); Object.assign(p, patch) }
    setPicks(await db.listPicks(student.id)); flash(`${adm.univ} ${adm.dept} 담김`)
  }

  return (
    <>
      <div className="pane pane-right" style={{borderRight:'1px solid var(--line)'}}>
        <div className="card">
          <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
            <h3 style={{margin:0}}>입결 필터 · <span className="muted">{student.name} (내신 {fmt(student.gpa)} / {fmt(student.track)})</span>
              {student.grades?.length
                ? <span className="j-badge j-안정" style={{marginLeft:8}}>생기부 {student.grades.length}과목 · 전체평균 {(eng.calcOverallAvg(student.grades)??0).toFixed(2)}</span>
                : <span className="j-badge j-도전" style={{marginLeft:8}}>생기부 미등록 — 교과등급 계산 불가</span>}
            </h3>
            {loading && <span className="muted" style={{fontSize:12}}>불러오는 중…</span>}
          </div>
          <div className="filters" style={{marginTop:12}}>
            <select className="inp" value={q.region}
              onChange={e=>setQ({...q, region:e.target.value, univ:'', dept:''})}>
              <option value="">지역 전체</option>
              {regions.map(r=> <option key={r} value={r}>{r}</option>)}
            </select>

            <select className="inp" value={q.type} onChange={e=>setQ({...q,type:e.target.value})}>
              <option value="">전형유형 전체</option>
              {types.map(t=> <option key={t} value={t}>{t}</option>)}
            </select>

            <select className="inp" value={q.track}
              onChange={e=>setQ({...q, track:e.target.value, dept:''})}>
              <option value="">계열 전체</option>
              <option value="자연">자연</option><option value="인문">인문</option><option value="통합">통합</option>
            </select>

            <input className="inp" list="univ-list" placeholder={`대학 선택/검색 (${univs.length})`}
              value={q.univ} onChange={e=>setQ({...q, univ:e.target.value, dept:''})} style={{minWidth:170}} />
            <datalist id="univ-list">
              {univs.map(u=> <option key={u} value={u} />)}
            </datalist>

            <input className="inp" list="dept-list"
              placeholder={q.univ ? `학과 선택 (${depts.length})` : '학과/모집단위 검색'}
              value={q.dept} onChange={e=>setQ({...q, dept:e.target.value})} style={{minWidth:170}} />
            <datalist id="dept-list">
              {depts.map(d=> <option key={d} value={d} />)}
            </datalist>

            <label className="row" style={{alignItems:'center',gap:4,fontSize:12,color:'var(--sub)'}}>
              <input type="checkbox" checked={onlyReachable} onChange={e=>setOnlyReachable(e.target.checked)} />
              내신 이내만
            </label>
            {hasFilter && <button className="btn ghost sm" onClick={()=>setQ({univ:'',dept:'',region:'',type:'',track:student.track||''})}>필터 초기화</button>}
          </div>

          <div className="tablewrap">
            <table>
              <thead><tr>
                <th></th><th>대학</th><th>계열</th><th>모집단위</th><th>전형유형</th><th>전형명</th>
                <th className="num">인원</th><th className="num">내 교과</th><th className="num">26컷</th><th className="num">25컷</th>
                <th className="num">26경쟁</th><th>판정</th><th>최저</th><th>고사일</th><th>유의</th>
              </tr></thead>
              <tbody>
                {!hasFilter && (
                  <tr><td colSpan={15} className="empty">위 필터를 골라 보세요. 지역을 고르면 그 지역 대학만, 대학을 고르면 그 대학 학과만 목록에 뜹니다. 대학·학과 칸은 클릭하면 목록이 펼쳐지고, 글자를 치면 걸러집니다. 학과명만으로도 검색됩니다.</td></tr>
                )}
                {hasFilter && rows.length===0 && !loading && (
                  <tr><td colSpan={15} className="empty">조건에 맞는 입결이 없습니다. 필터를 넓혀 보세요.</td></tr>
                )}
                {rows.map(a=>{
                  // 학생 성적이 있으면 이 대학·전형 방식으로 교과등급 계산
                  const rowForCalc = { univ:a.univ, type:a.type, name:a.name, subjects:a.subjects }
                  const myGrade = student.grades ? eng.gradeForRow(rowForCalc, student.grades, guides) : null
                  const src = student.grades ? eng.gradeSource(rowForCalc, student.grades, guides) : null
                  // 판정: 계산된 내 교과등급 우선, 없으면 입력한 내신
                  const basis = myGrade!=null ? myGrade : student.gpa
                  const j = suggestJudgment(basis, a.cut26)
                  return (
                    <tr key={a.id}>
                      <td><button className="btn sm" disabled={pickedIds.has(a.id)} onClick={()=>add(a, myGrade)}>
                        {pickedIds.has(a.id)?'담김':'담기'}</button></td>
                      <td><b>{a.univ}</b></td>
                      <td>{a.track}</td>
                      <td>{a.dept}</td>
                      <td>{a.type}</td>
                      <td>{a.name}</td>
                      <td className="num">{fmt(a.quota)}</td>
                      <td className="num" title={src||''}>
                        {myGrade!=null ? myGrade.toFixed(2) : '–'}
                        {src && <div style={{fontSize:10,color:'var(--sub)',fontWeight:400}}>{src}</div>}
                      </td>
                      <td className="num">{fmt(a.cut26)}</td>
                      <td className="num">{fmt(a.cut25)}</td>
                      <td className="num">{fmt(a.comp26)}</td>
                      <td>{j && <span className={`j-badge j-${j}`}>{j}</span>}</td>
                      <td className="wrap">{fmt(a.minreq)}</td>
                      <td>{fmt(a.examdate)}</td>
                      <td className="wrap">{fmt(a.note)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="pane pane-left" style={{width:360,order:2}}>
        <PickBoard student={student} picks={picks} setPicks={setPicks} flash={flash} />
      </div>
    </>
  )
}

function PickBoard({ student, picks, setPicks, flash }){
  const reload = async ()=> setPicks(await db.listPicks(student.id))
  const set = async (id, patch)=>{ await db.updatePick(id, patch); await reload() }
  const remove = async (id)=>{ await db.deletePick(id); await reload(); flash('제거됨') }

  const counts = useMemo(()=>{
    const c = { 안정:0, 적정:0, 도전:0, 상향:0, 확정:0 }
    picks.forEach(p=>{ if(c[p.judgment]!=null) c[p.judgment]++; if(p.status==='지원확정') c.확정++ })
    return c
  }, [picks])

  return (
    <div className="card" style={{position:'sticky',top:0}}>
      <h3>담은 학과 ({picks.length})</h3>
      <div className="muted" style={{fontSize:12,marginBottom:10}}>
        확정 {counts.확정} · 안정 {counts.안정} / 적정 {counts.적정} / 도전 {counts.도전} / 상향 {counts.상향}
      </div>
      {picks.length===0 && <div className="empty">왼쪽 검색결과에서 [담기]를 누르세요.</div>}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {picks.map(p=>(
          <div key={p.id} className={`pick status-${p.status}`}>
            <div className="head">
              <div><div className="u">{p.univ}</div><div className="d">{p.dept}</div></div>
              <button className="btn sm ghost danger" onClick={()=>remove(p.id)}>×</button>
            </div>
            <div className="kv">
              <span>{p.type} · {p.name}</span>
              <span>26컷 <b>{fmt(p.cut26)}</b></span>
              <span>경쟁 <b>{fmt(p.comp26)}</b></span>
            </div>
            <div className="ctl">
              <select value={p.judgment} onChange={e=>set(p.id,{judgment:e.target.value})}>
                {JUDGMENTS.map(j=> <option key={j}>{j}</option>)}
              </select>
              <select value={p.status} onChange={e=>set(p.id,{status:e.target.value})}>
                {STATUSES.map(s=> <option key={s}>{s}</option>)}
              </select>
              <input style={{width:76}} placeholder="슬롯" value={p.slot||''}
                onChange={e=>set(p.id,{slot:e.target.value})} />
            </div>
            <input className="inp" style={{marginTop:6,fontSize:12}} placeholder="지원 사유/코멘트"
              value={p.reason||''} onChange={e=>set(p.id,{reason:e.target.value})} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- ③ 최종 지원 보고서 (인쇄) ---------------- */
function ReportTab({ student, teacherName, guides }){
  const [picks, setPicks] = useState([])
  useEffect(()=>{ db.listPicks(student.id).then(setPicks) }, [student.id])

  const active = picks.filter(p=> p.status!=='제외')
  const confirmed = active.filter(p=> p.status==='지원확정')
  const order = { 안정:0, 적정:1, 도전:2, 상향:3 }
  const sorted = [...active].sort((a,b)=> (order[a.judgment]??9)-(order[b.judgment]??9))
  const counts = JUDGMENTS.map(j=>({ j, n: active.filter(p=>p.judgment===j).length }))
  const today = new Date().toLocaleDateString('ko-KR')

  return (
    <div className="pane pane-right" style={{background:'#eef0f3'}}>
      <div className="no-print" style={{maxWidth:1040,margin:'0 auto 12px',display:'flex',justifyContent:'flex-end',gap:8}}>
        <button className="btn primary" onClick={()=>window.print()}>🖨 인쇄 / PDF 저장</button>
      </div>

      <div className="report">
        <div className="rp-header">
          <div>
            <h1>{student.name} 수시 지원 상담 보고서</h1>
            <div className="rp-sub">
              {[student.school, student.grade, student.track && `${student.track}계열`].filter(Boolean).join(' · ')}
              {student.gpa!=null && ` · 내신 ${student.gpa}`}{student.gpa_main!=null && ` (주요교과 ${student.gpa_main})`}
            </div>
            {student.target && <div className="rp-sub">희망 진로: {student.target}</div>}
          </div>
          <div className="rp-meta">
            담임 {teacherName}<br/>작성일 {today}<br/>강남한국학원 · DnA입시LAB
          </div>
        </div>

        <div className="rp-sec">
          <h2>지원 구성 요약</h2>
          {counts.map(c=> <span key={c.j} className="stat">{c.j} <b>{c.n}</b></span>)}
          <span className="stat">지원확정 <b>{confirmed.length}</b></span>
          <span className="stat">총 <b>{active.length}</b>개</span>
        </div>

        <div className="rp-sec">
          <h2>지원(예정) 학과 상세</h2>
          <table>
            <thead><tr>
              <th>슬롯</th><th>판정</th><th>상태</th><th>대학</th><th>모집단위</th>
              <th>전형유형</th><th>전형명</th><th>26컷</th><th>경쟁률</th><th>최저학력기준</th><th>고사일</th><th>사유</th>
            </tr></thead>
            <tbody>
              {sorted.map(p=>(
                <tr key={p.id}>
                  <td>{fmt(p.slot)}</td>
                  <td><span className={`j-badge j-${p.judgment}`}>{p.judgment}</span></td>
                  <td>{p.status}</td>
                  <td><b>{p.univ}</b></td>
                  <td>{p.dept}</td>
                  <td>{p.type}</td>
                  <td>{p.name}</td>
                  <td className="num">{fmt(p.cut26)}</td>
                  <td className="num">{fmt(p.comp26)}</td>
                  <td>{fmt(p.minreq)}</td>
                  <td>{fmt(p.examdate)}</td>
                  <td>{fmt(p.reason)}</td>
                </tr>
              ))}
              {sorted.length===0 && <tr><td colSpan={12} className="empty">담긴 학과가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>

        {student.memo && (
          <div className="rp-sec"><h2>상담 메모</h2><div style={{fontSize:13,whiteSpace:'pre-wrap'}}>{student.memo}</div></div>
        )}

        <div className="rp-note">
          입결(등급)은 통통통 2027학년도 자료 기준의 참고값입니다. 대학 공식 발표와 다를 수 있으며 최종 판단은 담임·컨설턴트 검토를 따릅니다.
        </div>
      </div>
    </div>
  )
}

/* ---------------- utils ---------------- */
function GuidesTab({ guides, reloadGuides, flash }){
  const [busy, setBusy] = useState('')
  const names = Object.keys(guides).sort((a,b)=>a.localeCompare(b,'ko'))

  const upload = async (files)=>{
    if(!files || !files.length) return
    if(!eng.hasAI){ flash('AI 키가 없습니다 (Vercel 환경변수 VITE_MISTRAL_KEY)'); return }
    // 파일명에서 대학명 추출: "가천대2.jpg" → "가천대" (뒤 숫자·공백 제거)
    const rawName = String(files[0].name||'')
      .replace(/\.[^.]+$/,'')          // 확장자 제거
      .replace(/[\s_-]*\d+\s*$/,'')    // 끝의 숫자(1,2,3) 제거
      .trim()
    if(!rawName){ flash('파일 이름을 대학명으로 저장하세요 (예: 가천대.jpg)'); return }
    try{
      setBusy('대학명 확인 중…')
      // 통통통 DB 정식명에 매칭 (가천대 → 가천대학교)
      const dbUnivs = await db.distinctUnivs()
      const matched = eng.matchUnivName(rawName, dbUnivs)
      const g = await eng.parseGuideFromImages([...files], msg=>setBusy(msg))
      const univName = matched || rawName  // 매칭 실패 시 파일명 그대로
      g.university = univName
      await db.saveGuide(univName, g)
      await reloadGuides()
      flash(`${univName} 모집요강 등록 (전형 ${g.tracks.length}개) · 전체 공유됨`)
    }catch(err){ flash('분석 실패: '+(err?.message||err)) }
    finally{ setBusy('') }
  }

  return (
    <div className="pane pane-right">
      <div className="card" style={{maxWidth:820}}>
        <h3 style={{margin:0}}>모집요강 규칙 (전체 공유)</h3>
        <div className="muted" style={{fontSize:13,marginTop:6}}>
          대학 모집요강 이미지(또는 캡처 여러 장)를 올리면 AI가 반영교과·가중치·진로선택 처리 방식을 읽어 계산 규칙을 만듭니다.
          한 번 등록하면 모든 담임이 공유하고, 관심학과 담기에서 그 대학은 정밀 교과등급으로 계산됩니다. 아직 안 올린 대학은 통통통 반영과목으로 근사 계산합니다.
        </div>
        {busy && <div className="banner" style={{marginTop:10}}>{busy}</div>}
        <div style={{marginTop:12}}>
          <label className="btn primary" style={{display:'inline-block'}}>
            모집요강 이미지 올리기
            <input type="file" accept="image/*" multiple style={{display:'none'}}
              onChange={e=>upload(e.target.files)} />
          </label>
          {!eng.hasAI && <span className="muted" style={{marginLeft:10,fontSize:12}}>※ AI 키 미설정 — Vercel 환경변수 VITE_MISTRAL_KEY 필요</span>}
        </div>
      </div>

      <div className="card" style={{maxWidth:820}}>
        <h3>등록된 대학 ({names.length})</h3>
        {names.length===0 && <div className="empty">아직 등록된 모집요강이 없습니다.</div>}
        {names.map(u=>(
          <div key={u} style={{borderBottom:'1px solid var(--line)',padding:'8px 0',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div className="grow">
              <div style={{fontWeight:700}}>{u}</div>
              <div style={{fontSize:12,marginTop:4}}>
                {(guides[u].tracks||[]).map((t,i)=>(
                  <div key={i} style={{padding:'3px 0',borderTop:i?'1px dashed var(--line)':undefined}}>
                    <b>{t.trackName}</b> <span className="muted">[{t.trackType}]</span>
                    {t.subjectGroups?.length ? ` · 반영: ${t.subjectGroups.join('·')}` : ' · 반영과목 없음(전체평균)'}
                    {t.topN ? ` · 상위${t.topN}` : ''}
                    {t.jinroHandling ? ` · 진로: ${t.jinroHandling}` : ''}
                  </div>
                ))}
                {!(guides[u].tracks||[]).length && <span className="muted">전형 정보 없음</span>}
              </div>
            </div>
            <button className="btn sm ghost danger" onClick={async()=>{
              if(!confirm(`"${u}" 모집요강을 삭제할까요?`)) return
              await db.deleteGuide(u); await reloadGuides(); flash(`${u} 삭제됨`)
            }}>삭제</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function num(v){ if(v===''||v===null||v===undefined) return null; const n=Number(v); return Number.isNaN(n)?null:n }
function parseCsv(text, teacherId){
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if(!lines.length) return []
  // 첫 줄이 헤더(이름 포함)면 스킵
  const first = lines[0]
  const hasHeader = /이름|name/i.test(first) && /(내신|출신|계열|모의)/.test(first)
  const body = hasHeader ? lines.slice(1) : lines
  return body.map(line=>{
    const c = line.split(/\t|,/).map(s=>s.trim())
    return {
      teacher_id: teacherId || null,
      name: c[0]||'', school: c[1]||null, grade: c[2]||null, track: c[3]||null,
      gpa: num(c[4]), gpa_main: num(c[5]), mock: c[6]||null, target: c[7]||null, memo: c[8]||null,
    }
  }).filter(r=> r.name)
}
