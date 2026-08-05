import { useEffect, useMemo, useState, useCallback } from 'react'
import { isConfigured } from './supabase'
import * as db from './store'

const JUDGMENTS = ['안정','적정','도전','상향']
const STATUSES  = ['관심','지원확정','보류','제외']
const fmt = v => (v===null||v===undefined||v==='') ? '–' : v

function suggestJudgment(gpa, cut){
  if(gpa==null || cut==null) return null
  const d = cut - gpa
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

  const flash = useCallback(msg => { setToast(msg); setTimeout(()=>setToast(''), 2000) }, [])

  useEffect(()=>{ db.listTeachers().then(setTeachers) }, [])
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
          <SearchTab student={selStudent} flash={flash} />
        )}
        {tab==='report' && selStudent && (
          <ReportTab student={selStudent} teacherName={teacherName} />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function TeacherPicker({ teachers, teacherId, setTeacherId, setTeachers, flash }){
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = async ()=>{
    if(!name.trim()) return
    const t = await db.addTeacher(name.trim())
    setTeachers(await db.listTeachers()); setTeacherId(t.id); setName(''); setAdding(false)
    flash('담임 추가됨')
  }
  return (
    <div className="teacher-pick">
      <span className="muted" style={{fontSize:12}}>담임</span>
      <select value={teacherId} onChange={e=>setTeacherId(e.target.value)}>
        <option value="">전체</option>
        {teachers.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
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
    </div>
  )
}

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
    const rec = {
      teacher_id: teacherId || null, name: form.name.trim(), school: form.school || null,
      grade: form.grade || null, track: form.track || null,
      gpa: num(form.gpa), gpa_main: num(form.gpa_main),
      mock: form.mock || null, target: form.target || null, memo: form.memo || null,
    }
    await db.addStudent(rec); setForm(blankStudent()); await refresh(); flash('학생 저장됨')
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
          <div className="card" style={{maxWidth:640}}>
            <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0}}>{selStudent.name} · 상세</h3>
              <button className="btn primary" onClick={goSearch}>관심학과 담으러 가기 →</button>
            </div>
            <StudentDetail student={selStudent} onSaved={async()=>{await refresh()}} flash={flash}
              setSelStudent={setSelStudent} />
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
                <input className="inp" value={form.gpa} onChange={e=>set('gpa',e.target.value)} placeholder="1.85" /></label>
              <label className="field grow"><span>주요교과</span>
                <input className="inp" value={form.gpa_main} onChange={e=>set('gpa_main',e.target.value)} placeholder="1.60" /></label>
            </div>
            <label className="field"><span>모의고사 성적 요약</span>
              <input className="inp" value={form.mock} onChange={e=>set('mock',e.target.value)} placeholder="국2 수3 영2 탐3/3" /></label>
            <label className="field"><span>희망 진로 / 학과 방향</span>
              <input className="inp" value={form.target} onChange={e=>set('target',e.target.value)} placeholder="항공우주 · 데이터/AI" /></label>
            <label className="field"><span>상담 메모</span>
              <textarea className="inp" value={form.memo} onChange={e=>set('memo',e.target.value)} /></label>
            <button className="btn primary" onClick={save}>학생 저장</button>
          </div>
        )}
      </div>
    </>
  )
}

function StudentDetail({ student, onSaved, flash, setSelStudent }){
  const [f, setF] = useState(student)
  useEffect(()=>{ setF(student) }, [student.id])
  const set = (k,v)=> setF(p=>({ ...p, [k]:v }))
  const save = async ()=>{
    const patch = {
      name:f.name, school:f.school, grade:f.grade, track:f.track,
      gpa:num(f.gpa), gpa_main:num(f.gpa_main), mock:f.mock, target:f.target, memo:f.memo,
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
        <label className="field grow"><span>내신</span>
          <input className="inp" value={f.gpa??''} onChange={e=>set('gpa',e.target.value)} /></label>
        <label className="field grow"><span>주요교과</span>
          <input className="inp" value={f.gpa_main??''} onChange={e=>set('gpa_main',e.target.value)} /></label>
      </div>
      <label className="field"><span>모의고사</span>
        <input className="inp" value={f.mock||''} onChange={e=>set('mock',e.target.value)} /></label>
      <label className="field"><span>희망 진로</span>
        <input className="inp" value={f.target||''} onChange={e=>set('target',e.target.value)} /></label>
      <label className="field"><span>메모</span>
        <textarea className="inp" value={f.memo||''} onChange={e=>set('memo',e.target.value)} /></label>
      <div className="row">
        <button className="btn primary" onClick={save}>변경 저장</button>
        <button className="btn ghost" onClick={()=>setSelStudent(null)}>새 학생 추가로</button>
      </div>
    </div>
  )
}

function SearchTab({ student, flash }){
  const [q, setQ] = useState({ univ:'', dept:'', region:'', type:'', track: student.track||'' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [picks, setPicks] = useState([])
  const [regions, setRegions] = useState([])
  const [types, setTypes] = useState([])
  const [onlyReachable, setOnlyReachable] = useState(false)

  useEffect(()=>{ db.distinctRegions().then(setRegions); db.distinctTypes().then(setTypes) }, [])
  useEffect(()=>{ db.listPicks(student.id).then(setPicks) }, [student.id])

  const run = async ()=>{
    setLoading(true)
    const res = await db.searchAdmissions({
      univ:q.univ.trim(), dept:q.dept.trim(), region:q.region, type:q.type, track:q.track,
      gpaMax: onlyReachable ? (student.gpa ?? undefined) : undefined,
    })
    setRows(res); setLoading(false)
  }

  const pickedIds = useMemo(()=> new Set(picks.map(p=>p.admission_id)), [picks])
  const add = async (adm)=>{
    if(pickedIds.has(adm.id)){ flash('이미 담긴 학과입니다'); return }
    const p = await db.addPick(student.id, adm)
    const sug = suggestJudgment(student.gpa, adm.cut26)
    if(sug){ await db.updatePick(p.id, { judgment: sug }); p.judgment = sug }
    setPicks(await db.listPicks(student.id)); flash(`${adm.univ} ${adm.dept} 담김`)
  }

  return (
    <>
      <div className="pane pane-right" style={{borderRight:'1px solid var(--line)'}}>
        <div className="card">
          <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
            <h3 style={{margin:0}}>입결 검색 · <span className="muted">{student.name} (내신 {fmt(student.gpa)} / {fmt(student.track)})</span></h3>
          </div>
          <div className="filters" style={{marginTop:12}}>
            <input className="inp" placeholder="대학명" value={q.univ}
              onChange={e=>setQ({...q,univ:e.target.value})} onKeyDown={e=>e.key==='Enter'&&run()} />
            <input className="inp" placeholder="학과/모집단위" value={q.dept}
              onChange={e=>setQ({...q,dept:e.target.value})} onKeyDown={e=>e.key==='Enter'&&run()} />
            <select className="inp" value={q.region} onChange={e=>setQ({...q,region:e.target.value})}>
              <option value="">지역 전체</option>
              {regions.map(r=> <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="inp" value={q.type} onChange={e=>setQ({...q,type:e.target.value})}>
              <option value="">전형유형 전체</option>
              {types.map(t=> <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="inp" value={q.track} onChange={e=>setQ({...q,track:e.target.value})}>
              <option value="">계열 전체</option>
              <option value="자연">자연</option><option value="인문">인문</option><option value="통합">통합</option>
            </select>
            <label className="row" style={{alignItems:'center',gap:4,fontSize:12,color:'var(--sub)'}}>
              <input type="checkbox" checked={onlyReachable} onChange={e=>setOnlyReachable(e.target.checked)} />
              내신 이내만
            </label>
            <button className="btn primary" onClick={run}>{loading?'검색 중…':'검색'}</button>
          </div>

          <div className="tablewrap">
            <table>
              <thead><tr>
                <th></th><th>대학</th><th>계열</th><th>모집단위</th><th>전형유형</th><th>전형명</th>
                <th className="num">인원</th><th className="num">26컷</th><th className="num">25컷</th>
                <th className="num">26경쟁</th><th>판정</th><th>최저</th><th>고사일</th><th>유의</th>
              </tr></thead>
              <tbody>
                {rows.length===0 && !loading && (
                  <tr><td colSpan={14} className="empty">검색 조건을 넣고 [검색]을 누르세요. 대학명 또는 학과 일부만 입력해도 됩니다.</td></tr>
                )}
                {rows.map(a=>{
                  const j = suggestJudgment(student.gpa, a.cut26)
                  return (
                    <tr key={a.id}>
                      <td><button className="btn sm" disabled={pickedIds.has(a.id)} onClick={()=>add(a)}>
                        {pickedIds.has(a.id)?'담김':'담기'}</button></td>
                      <td><b>{a.univ}</b></td>
                      <td>{a.track}</td>
                      <td>{a.dept}</td>
                      <td>{a.type}</td>
                      <td>{a.name}</td>
                      <td className="num">{fmt(a.quota)}</td>
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

function ReportTab({ student, teacherName }){
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

function num(v){ if(v===''||v===null||v===undefined) return null; const n=Number(v); return Number.isNaN(n)?null:n }
function parseCsv(text, teacherId){
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if(!lines.length) return []
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
