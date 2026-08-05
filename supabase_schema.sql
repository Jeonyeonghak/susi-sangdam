-- ============================================================
-- 수시 지원 상담 앱 · Supabase 스키마 (정시 프로젝트에 넣는 버전)
-- 테이블 이름을 프로젝트 규칙(한글)에 맞춰 "수시~"로 통일했습니다.
-- SQL Editor에 그대로 붙여넣고 Run 하세요.
-- ============================================================

-- 1) 입결 마스터 (통통통 2027) — admissions.csv 를 Import 로 채웁니다.
create table if not exists 수시입결 (
  id          integer primary key,
  region      text,   -- 광역
  city        text,   -- 기초
  univ        text,   -- 대학교
  track       text,   -- 계열
  dept        text,   -- 모집단위명
  type        text,   -- 전형유형
  name        text,   -- 전형명
  qual        text,   -- 지원자격
  quota       numeric,-- 모집인원
  yoy         text,   -- 전년대비
  minreq      text,   -- 최저학력기준
  method      text,   -- 전형방법
  docs        text,   -- 필요서류
  multi       text,   -- 복수지원
  subjects    text,   -- 반영과목
  career_sub  text,   -- 진로선택과목
  comp26      numeric,-- 2026 경쟁률
  comp25      numeric,-- 2025 경쟁률
  comp24      numeric,-- 2024 경쟁률
  cut26       numeric,-- 2026 입결(등급)
  cutscore26  numeric,-- 2026 입결(환산점수)
  fill26      numeric,-- 2026 충원
  note        text,   -- 지원시 유의사항
  cut25       numeric,-- 2025 입결(등급)
  cut24       numeric,-- 2024 입결(등급)
  examdate    text    -- 대학별고사 실시일
);
create index if not exists idx_수시입결_univ   on 수시입결 (univ);
create index if not exists idx_수시입결_dept   on 수시입결 (dept);
create index if not exists idx_수시입결_region on 수시입결 (region);
create index if not exists idx_수시입결_type   on 수시입결 (type);

-- 2) 담임
create table if not exists 수시담임 (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz default now()
);

-- 3) 학생 로우데이터
create table if not exists 수시학생들 (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid references 수시담임(id) on delete set null,
  name        text not null,
  school      text,
  grade       text,
  track       text,
  gpa         numeric,
  gpa_main    numeric,
  mock        text,
  target      text,
  memo        text,
  created_at  timestamptz default now()
);
create index if not exists idx_수시학생들_teacher on 수시학생들 (teacher_id);

-- 4) 관심학과 담기 → 최종 지원
create table if not exists 수시담기 (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid references 수시학생들(id) on delete cascade,
  admission_id  integer references 수시입결(id),
  univ          text,
  dept          text,
  type          text,
  name          text,
  cut26         numeric,
  comp26        numeric,
  minreq        text,
  examdate      text,
  judgment      text default '적정',
  slot          text,
  status        text default '관심',
  reason        text,
  sort_order    integer default 0,
  created_at    timestamptz default now()
);
create index if not exists idx_수시담기_student on 수시담기 (student_id);

-- 5) RLS (내부 도구 → 우선 전체 허용)
alter table 수시입결   enable row level security;
alter table 수시담임   enable row level security;
alter table 수시학생들 enable row level security;
alter table 수시담기   enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='수시입결' and policyname='r') then
    create policy r on 수시입결 for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='수시담임' and policyname='a') then
    create policy a on 수시담임 for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='수시학생들' and policyname='a') then
    create policy a on 수시학생들 for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='수시담기' and policyname='a') then
    create policy a on 수시담기 for all using (true) with check (true);
  end if;
end $$;
