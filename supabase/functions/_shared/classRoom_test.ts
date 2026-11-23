// All network calls are mocked. No live Notion/Supabase writes or secret values are used.
function assert(value: unknown, message = "assertion failed") { if (!value) throw new Error(message) }
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", CLASS_ROOM_COPY_WRITE: "off", SB_URL: "https://mock.supabase", DATA_SOURCE_CLASS_SESSION_ID: "sessions", DATA_SOURCE_ATTENDANCE_ID: "attendance", DATA_SOURCE_LEARNING_RECORD_ID: "records", DATA_SOURCE_STUDY_ACTIVITY_ID: "activities", DATA_SOURCE_PROGRESS_BOOK_ID: "books", DATA_SOURCE_REGISTRATION_ID: "registrations" })) Deno.env.set(key, value)
const room = await import("./classRoom.ts")
const sel = await import("./selectedUnits.ts")
const attMemo = await import("./attendanceMemo.ts")
const rel = (...ids: string[]) => ({ relation: ids.map((id) => ({ id })) })
const title = (s: string) => ({ type: "title", title: [{ plain_text: s, text: { content: s } }] })
const text = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s, text: { content: s } }] : [] })
const formula = (s: string) => ({ type: "formula", formula: { type: "string", string: s } })
const ids = (p: any, key: string) => (p.properties[key]?.relation ?? []).map((x: any) => x.id).join(",")
const D = "2026-10-13T08:00:00.000Z" // 17:00 KST
function fixture() {
 const pages: Record<string, any> = {
  cls: { id: "cls", db: "classes", properties: { "클래스명": title("중1 B"), "이모지": text("🟡") } },
  regular: { id: "regular", db: "regulars", properties: { "교재명": title("개념원리 1-2"), "과목": rel("math"), "북커버": { type: "files", files: [{ type: "external", external: { url: "https://example.com/cover.png" } }] }, "전체 페이지": { type: "number", number: 248 } } },
  t1: { id: "t1", db: "teachers", properties: { "이름": title("안규빈"), "직책": { select: { name: "강사" } } } },
  s1: { id: "s1", db: "sessions", properties: { "이름": title("중1 B 10.13(화)"), "수업일시": { date: { start: D, end: "2026-10-13T09:00:00.000Z" } }, "담당강사": rel("t1"), "클래스": rel("cls"), "등록": rel("ra", "rb"), "출석": rel("aa", "ab"), "학습기록": rel(), "수업 구분": { select: null }, "출석현황": formula("✅ 정상(2)") } },
  sOther: { id: "sOther", db: "sessions", properties: { "이름": title("다른 날"), "수업일시": { date: { start: "2026-10-14T08:00:00.000Z" } }, "담당강사": rel("t1"), "출석": rel(), "학습기록": rel(), "수업 구분": { select: null } } },
  sPrev: { id: "sPrev", db: "sessions", properties: { "이름": title("중1 B 10.08(목)"), "수업일시": { date: { start: "2026-10-08T08:00:00.000Z" } }, "클래스": rel("cls"), "출석": rel("pa", "pb", "pc"), "학습기록": rel(), "수업 구분": { select: null } } },
  sMk: { id: "sMk", db: "sessions", properties: { "이름": title("보강"), "수업일시": { date: { start: "2026-10-09T08:00:00.000Z" } }, "클래스": rel("cls"), "출석": rel(), "학습기록": rel(), "수업 구분": { select: { name: "보강" } } } },
  pa: { id: "pa", db: "attendance", properties: { "출석": title("pa"), "수업": rel("sPrev"), "수업일시": { date: { start: "2026-10-08T08:00:00.000Z" } }, "출석 상태": { select: { name: "🟢 출석" } } } },
  pb: { id: "pb", db: "attendance", properties: { "출석": title("pb"), "수업": rel("sPrev"), "수업일시": { date: { start: "2026-10-08T08:00:00.000Z" } }, "출석 상태": { select: { name: "🔴 결석" } } } },
  pc: { id: "pc", db: "attendance", properties: { "출석": title("pc"), "수업": rel("sPrev"), "수업일시": { date: { start: "2026-10-08T08:00:00.000Z" } }, "출석 상태": { select: null } } },
  ra: { id: "ra", db: "registrations", properties: { "이름": title("김하늘 중1 B"), "진도교재": rel("group", "indA") } },
  rb: { id: "rb", db: "registrations", properties: { "이름": title("박서준 중1 B"), "진도교재": rel("group", "indB") } },
  rc: { id: "rc", db: "registrations", properties: { "이름": title("이도윤 중2 A"), "진도교재": rel("other") } },
  group: { id: "group", db: "books", properties: { "진도교재": title("개념원리(중1 B)"), "진도방식": { select: { name: "그룹 진도" } }, "진행상태": { status: { name: "진행 중" } }, "라이브러리": rel("regular"), "반별교재": rel(), "진행도": { type: "formula", formula: { type: "number", number: 0.344 } }, "최근 학습 범위": text("p.78-83") } },
  indA: { id: "indA", db: "books", properties: { "진도교재": title("RPM(김하늘)"), "진도방식": { select: { name: "개별 진도" } }, "진행상태": { status: { name: "진행 중" } }, "정규교재": rel(), "반별교재": rel("tpl") } },
  indB: { id: "indB", db: "books", properties: { "진도교재": title("RPM(박서준)"), "진도방식": { select: { name: "개별 진도" } }, "진행상태": { status: { name: "진행 중" } }, "정규교재": rel(), "반별교재": rel("tpl") } },
  aa: { id: "aa", db: "attendance", properties: { "출석": title("aa"), "학생이름(알림톡)": formula("김하늘"), "등록": rel("ra"), "수업": rel("s1"), "수업일시": { date: { start: D } }, "출석 상태": { select: { name: "🟢 출석" } }, "등원스템프": { date: { start: "2026-10-13T07:52:00.000Z" } }, "메모": text("집중 좋음"), "선생님 한마디": text(""), "과제": rel("hw1") } },
  ab: { id: "ab", db: "attendance", properties: { "출석": title("ab"), "학생이름(알림톡)": formula("박서준"), "등록": rel("rb"), "수업": rel("s1"), "수업일시": { date: { start: D } }, "출석 상태": { select: null }, "메모": text(""), "선생님 한마디": text(""), "과제": rel("hw2") } },
  wait1: { id: "wait1", db: "attendance", properties: { "출석": title("w1"), "학생이름(알림톡)": formula("이도윤"), "클래스(알림톡)": formula("중2 A"), "등록": rel("rc"), "수업": rel(), "수업일시": { date: { start: "2026-10-13T06:00:00.000Z" } }, "출석 상태": { select: { name: "🔵 보강" } } } },
  waitOld: { id: "waitOld", db: "attendance", properties: { "출석": title("old"), "등록": rel("rc"), "수업": rel(), "수업일시": { date: { start: "2026-10-12T06:00:00.000Z" } }, "출석 상태": { select: { name: "🔵 보강" } } } },
  rec0: { id: "rec0", db: "records", properties: { "학습": title("[과제] 개념원리 1-2(중1 B) 10.10(금)"), "구분": { select: { name: "과제" } }, "범위": text("p.31-35"), "학습활동": rel("hw1", "hw2") } },
  hw1: { id: "hw1", db: "activities", properties: { "학습활동": title("hw1"), "학습기록": rel("rec0"), "등록": rel("ra"), "출석": rel("aa"), "과제상태": { select: { name: "🔵 제출" } } } },
  hw2: { id: "hw2", db: "activities", properties: { "학습활동": title("hw2"), "학습기록": rel("rec0"), "등록": rel("rb"), "출석": rel("ab"), "과제상태": { select: { name: "🔴 미제출" } } } },
 }
 const writes: any[] = [], created: any[] = [], queries: any[] = []
 function cond(p: any, f: any): boolean {
  if (!f) return true
  if (f.and) return f.and.every((x: any) => cond(p, x))
  if (f.or) return f.or.some((x: any) => cond(p, x))
  const v = p.properties[f.property]
  if (f.relation?.contains) return (v?.relation ?? []).some((r: any) => r.id === f.relation.contains)
  if (f.relation?.is_empty) return !(v?.relation ?? []).length
  if (f.select?.equals) return v?.select?.name === f.select.equals
  if (f.rich_text?.is_not_empty) return !!(v?.rich_text ?? []).length
  if (f.date?.on_or_after) return Date.parse(v?.date?.start) >= Date.parse(f.date.on_or_after)
  if (f.date?.before) return Date.parse(v?.date?.start) < Date.parse(f.date.before)
  throw new Error("unexpected filter " + JSON.stringify(f))
 }
 const reply = (p: any, status = 200) => new Response(JSON.stringify(structuredClone(p)), { status })
 const fetch = async (input: any, init: any = {}) => {
  const url = String(input), body = init.body ? JSON.parse(init.body) : {}
  if (url.endsWith("/data_sources/sessions")) return reply({ properties: { "담당강사": { relation: { data_source_id: "teachers" } } } })
  if (url.endsWith("/data_sources/records")) return reply({ properties: pages.__noUnitsProp ? {} : { "선택 단원": { type: "relation" } } })
  const blk = url.match(/\/blocks\/([^/]+)\/children/)?.[1]
  if (blk) return reply({ results: pages[blk]?.blocks ?? [], has_more: false })
  // 출석 메모 이름(v2.8.0 항목 62): 이 가짜 출석 DB에 있는 이름은 pages.__attMemo(기본 예전 이름 `메모`). 다른 이름이면 Notion처럼 400.
  const attMemo = pages.__attMemo ?? "메모", otherMemo = attMemo === "메모" ? "메모(내부용)" : "메모"
  const db = url.match(/\/data_sources\/([^/]+)\/query/)?.[1]
  if (db === "attendance" && JSON.stringify(body.filter ?? {}).includes(JSON.stringify({ property: otherMemo }).slice(1, -1))) return reply({ message: `Could not find property with name or id: ${otherMemo}` }, 400)
  if (db) { queries.push({ db, filter: body.filter }); return reply({ results: Object.values(pages).filter((p) => p.db === db && !p.archived && cond(p, body.filter)), has_more: false }) }
  const id = url.match(/\/pages\/([^/?]+)/)?.[1]
  if (id) {
   if (!pages[id]) return reply({ message: "missing " + id }, 404)
   if (init.method === "PATCH" && pages[id].db === "attendance" && body.properties?.[otherMemo] !== undefined) return reply({ message: `${otherMemo} is not a property that exists.` }, 400)
   // 학습활동 메모 이름(v2.8.0 항목 64): pages.__actMemo(기본 예전 이름 `메모`). 다른 이름이면 400.
   { const am = pages.__actMemo ?? "메모", ao = am === "메모" ? "메모(내부용)" : "메모"; if (init.method === "PATCH" && pages[id].db === "activities" && body.properties?.[ao] !== undefined) return reply({ message: `${ao} is not a property that exists.` }, 400) }
   if (init.method === "PATCH") { writes.push({ id, body }); Object.assign(pages[id].properties, body.properties ?? {}); if (body.archived) pages[id].archived = true }
   return reply(pages[id])
  }
  if (url.endsWith("/pages") && init.method === "POST") { const page = { id: "new" + created.length, db: body.parent.data_source_id, properties: body.properties }; pages[page.id] = page; created.push(page); return reply(page) }
  throw new Error("unmocked " + url)
 }
 return { pages, writes, created, queries, fetch }
}
async function withMock(run: (f: ReturnType<typeof fixture>) => Promise<void>) {
 const f = fixture(), original = globalThis.fetch
 attMemo.resetAttMemoName()
 globalThis.fetch = f.fetch as typeof fetch
 try { await run(f) } finally { globalThis.fetch = original }
}
async function rejects(fn: () => Promise<unknown>, status: number) {
 try { await fn() } catch (e) { assert(e instanceof room.ClassRoomError && e.status === status, `expected ${status}, got ${(e as Error).message}`); return }
 throw new Error("expected rejection " + status)
}

Deno.test("date helpers use Seoul time and the existing title shape", () => {
 assert(room.seoulLabel("2026-10-12T15:30:00.000Z") === "10.13(화)")
 assert(room.recordTitle("과제", "실험 정리", "중1 B", D) === "[과제] 실험 정리 · 중1 B 10.13(화)")
 assert(room.recordTitle("학습", "개념원리", "", D) === "[학습] 개념원리 10.13(화)")
 const r = room.seoulDayRange("2026-10-13"); assert(r.start === "2026-10-12T15:00:00.000Z" && r.end === "2026-10-13T15:00:00.000Z")
})
Deno.test("day: that day's sessions for the teacher and only unassigned makeup attendance", () => withMock(async (f) => {
 const day = await room.loadDay("2026-10-13", "t1")
 assert(day.sessions.map((s) => s.id).join() === "s1" && day.sessions[0].time === "17:00–18:00" && day.sessions[0].attendanceSummary === "✅ 정상(2)")
 assert(day.makeupWaiting.map((w) => w.attendanceId).join() === "wait1" && day.makeupWaiting[0].className === "중2 A")
 assert(f.queries.some((q) => JSON.stringify(q.filter).includes('"contains":"t1"')))
 const s1 = day.sessions[0]; assert(s1.className === "중1 B" && s1.classEmoji === "🟡" && s1.arrived === 1 && s1.students === 2, "class emoji, name and arrived count")
 await rejects(() => room.loadDay("10/13"), 400)
}))
Deno.test("classes: the teacher's classes with today's sessions, the next and the last one", () => withMock(async () => {
 const mine = (await room.loadClasses("2026-10-13", "t1")).classes
 assert(mine.length === 1 && mine[0].classId === "cls" && mine[0].name === "중1 B" && mine[0].emoji === "🟡", "only classes with the teacher's non-makeup sessions")
 assert(mine[0].today.map((x) => x.id).join() === "s1" && mine[0].today[0].time === "17:00–18:00" && mine[0].next === null && mine[0].last === null)
 assert(mine[0].week.map((x) => x.id + "@" + x.date).join() === "s1@2026-10-13" && mine[0].students === 2, "this week's sessions (Mon-Sun) and the student count")
 const all = (await room.loadClasses("2026-10-12")).classes
 assert(all.length === 1 && !all[0].today.length && all[0].next?.id === "s1" && all[0].next?.date === "2026-10-13" && all[0].next?.time === "17:00–18:00" && all[0].last?.id === "sPrev" && all[0].last?.date === "2026-10-08", "makeup sessions are skipped")
 assert(all[0].week.map((x) => x.id).join() === "s1", "2026-10-12 (Mon) week holds the 10-13 session, not 10-08")
 await rejects(() => room.loadClasses("10/13"), 400)
 await rejects(() => room.loadClasses("2026-10-13", "../x"), 400)
}))
Deno.test("days: Seoul dates that have the teacher's sessions in a range", () => withMock(async () => {
 const r = await room.loadDays("2026-10-12", "2026-10-18", "t1")
 assert(r.dates.join() === "2026-10-13,2026-10-14", r.dates.join())
 await rejects(() => room.loadDays("2026-10-18", "2026-10-12"), 400)
 await rejects(() => room.loadDays("2026-09-01", "2026-10-31"), 400)
 await rejects(() => room.loadDays("2026-10-12", "2026-10-18", "../x"), 400)
}))
Deno.test("class-stats: month attendance rate (makeup counts as present), homework rate, test averages and per-student numbers", () => withMock(async (f) => {
 const num = (n: number) => ({ type: "number", number: n })
 Object.assign(f.pages.pa.properties, { "등록": rel("ra") }); Object.assign(f.pages.pb.properties, { "등록": rel("rb") })
 f.pages.rT1 = { id: "rT1", db: "records", properties: { "학습": title("[평가] 개념원리"), "구분": { select: { name: "평가" } }, "수업": rel("sPrev"), "교재": rel("regular"), "범위": text("Ⅲ-1") } }
 f.pages.rT2 = { id: "rT2", db: "records", properties: { "학습": title("[평가] 개념원리 2"), "구분": { select: { name: "평가" } }, "수업": rel("s1"), "교재": rel("regular"), "범위": text("Ⅲ-2") } }
 f.pages.rL = { id: "rL", db: "records", properties: { "학습": title("[학습]"), "구분": { select: { name: "학습" } }, "수업": rel("s1") } }
 f.pages.t1 = { id: "t1", db: "activities", properties: { "학습활동": title("t1"), "학습기록": rel("rT1"), "등록": rel("ra"), "정답 문항": num(8), "전체 문항": num(10) } }
 f.pages.t2 = { id: "t2", db: "activities", properties: { "학습활동": title("t2"), "학습기록": rel("rT1"), "등록": rel("rb"), "정답 문항": num(6), "전체 문항": num(10) } }
 f.pages.t3 = { id: "t3", db: "activities", properties: { "학습활동": title("t3"), "학습기록": rel("rT2"), "등록": rel("ra"), "정답 문항": num(10), "전체 문항": num(10) } }
 f.pages.t4 = { id: "t4", db: "activities", properties: { "학습활동": title("t4"), "학습기록": rel("rT2"), "등록": rel("rb"), "정답 문항": { type: "number", number: null }, "전체 문항": num(10) } }
 // 보강 출석(pc)은 출석으로 센다(리포트와 같은 기준)
 f.pages.pc.properties["출석 상태"] = { select: { name: "🔵 보강" } }
 // 과제: 10월 마감 3개(제출 1·미제출 1·아직 마감 전 1 → 빼기), 9월 마감 1개(빼기)
 const due = (d: string) => ({ type: "formula", formula: { type: "date", date: { start: d } } })
 f.pages.rH = { id: "rH", db: "records", properties: { "학습": title("[과제]"), "구분": { select: { name: "과제" } }, "수업": rel("sPrev") } }
 f.pages.k1 = { id: "k1", db: "activities", properties: { "학습활동": title("k1"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔵 제출" } }, "과제 마감일": due("2026-10-10") } }
 f.pages.k2 = { id: "k2", db: "activities", properties: { "학습활동": title("k2"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔴 미제출" } }, "과제 마감일": due("2026-10-13") } }
 f.pages.k3 = { id: "k3", db: "activities", properties: { "학습활동": title("k3"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔴 미제출" } }, "과제 마감일": due("2026-10-20") } }
 f.pages.k4 = { id: "k4", db: "activities", properties: { "학습활동": title("k4"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔵 제출" } }, "과제 마감일": due("2026-09-30") } }
 const now = Date.parse("2026-10-14T00:00:00.000Z")
 const r = await room.loadClassStats("s1", now)
 // 10월: sPrev 출석(pa)·결석(pb)·보강(pc = 출석), s1 출석(aa)·미입력(ab 제외) → 3/4
 assert(r.month.ym === "2026-10" && r.month.present === 3 && r.month.counted === 4 && r.month.rate === 75, JSON.stringify(r.month))
 assert(r.homework.ym === "2026-10" && r.homework.done === 1 && r.homework.total === 2 && r.homework.rate === 50, "homework due this month and already due: " + JSON.stringify(r.homework))
 assert(r.tests.map((t: any) => t.id + ":" + t.avg + "/" + t.count).join() === "rT1:70/2,rT2:100/1", "tests oldest first, unscored skipped: " + JSON.stringify(r.tests))
 assert(r.tests[0].subject === "개념원리 1-2" && r.tests[0].date === "2026-10-08")
 assert(r.students.ra.rate === 100 && r.students.ra.counted === 2 && r.students.ra.score === 100 && r.students.ra.scoreDate === "2026-10-13", JSON.stringify(r.students.ra))
 assert(r.students.rb.rate === 0 && r.students.rb.counted === 1 && r.students.rb.score === 60, JSON.stringify(r.students.rb))
 // 아직 오지 않은 수업은 세지 않는다
 const early = await room.loadClassStats("s1", Date.parse("2026-10-10T00:00:00.000Z"))
 assert(early.month.counted === 3 && early.tests.length === 1 && early.homework.total === 1, "future session and not-yet-due homework skipped: " + JSON.stringify([early.month, early.homework]))
 await rejects(() => room.loadClassStats("../x"), 400)
}))

Deno.test("roster: school, grade and phones from the student page, priority phone and report token from the registration", () => withMock(async (f) => {
 const rollup = (s: string) => ({ type: "rollup", rollup: { type: "array", array: [{ type: "phone_number", phone_number: s }] } })
 const phone = (s: string) => ({ type: "phone_number", phone_number: s })
 f.pages.stA = { id: "stA", db: "students", properties: { "학생이름": title("김하늘"), "학교(설문)": text("하다중"), "학년(설문)": { type: "select", select: { name: "중1" } }, "학생 연락처": phone("010-0000-0001"),
  "우선 연락 대상": { type: "select", select: { name: "기타 보호자" } }, "어머니 연락처": phone("010-0000-0004"), "아버지 연락처": phone(""), "기타 보호자 연락처": phone("010-0000-0002"), "학생과의 관계": text("할아버지") } }
 Object.assign(f.pages.ra.properties, { "학생정보": rel("stA"), "학부모 연락처": rollup("010-0000-0002"), "토큰": text("tok-a") })
 Object.assign(f.pages.rb.properties, { "토큰": text("disabled:tok-b") })
 const r = await room.loadRoster("s1")
 assert(r.students.map((s: any) => s.name).join() === "김하늘,박서준")
 const [a, b] = r.students
 assert(a.school === "하다중" && a.grade === "중1" && a.studentPhone === "010-0000-0001" && a.parentPhone === "010-0000-0002" && a.reportToken === "tok-a" && !a.reportOff, JSON.stringify(a))
 // v2.6.9: 학생정보 페이지(↗)와 연락처 전체
 assert(a.studentId === "stA" && a.primary === "기타 보호자" && a.motherPhone === "010-0000-0004" && a.fatherPhone === "" && a.guardianPhone === "010-0000-0002" && a.guardianRelation === "할아버지", JSON.stringify(a))
 assert(b.studentId === null && b.primary === "" && b.motherPhone === "", "no student page: " + JSON.stringify(b))
 // v2.0.0: 학생과의 관계가 선택 칸이어도 같은 값
 f.pages.stA.properties["학생과의 관계"] = { type: "select", select: { name: "조부모" } }
 assert((await room.loadRoster("s1")).students[0].guardianRelation === "조부모", "select relation")
 assert(b.reportToken === null && b.reportOff && b.school === "" && b.parentPhone === "", "disabled report link gives no token: " + JSON.stringify(b))
 await rejects(() => room.loadRoster("../x"), 400)
}))

Deno.test("class-records: records of the class sessions, newest first, with the session date", () => withMock(async (f) => {
 f.pages.recA = { id: "recA", db: "records", properties: { "학습": title("[학습] 개념원리 1-2(중1 B) 10.13(화)"), "구분": { select: { name: "학습" } }, "수업": rel("s1"), "진도교재": rel("group"), "교재": rel("regular"), "범위": text("p.80-85") } }
 f.pages.recB = { id: "recB", db: "records", properties: { "학습": title("[과제] 개념원리 1-2(중1 B) 10.08(목)"), "구분": { select: { name: "과제" } }, "수업": rel("sPrev"), "진도교재": rel("indA"), "범위": text("p.70-76") } }
 f.pages.recMk = { id: "recMk", db: "records", properties: { "학습": title("[학습] 보강"), "구분": { select: { name: "학습" } }, "수업": rel("sMk") } }
 const r = await room.loadClassRecords("s1")
 assert(r.records.map((x: any) => x.id + "@" + x.date + " " + x.time).join() === "recA@2026-10-13 17:00,recB@2026-10-08 17:00", "class records newest first, makeup sessions skipped: " + r.records.map((x: any) => x.id).join())
 assert(r.records[0].sessionId === "s1" && r.records[0].bookId === "group" && r.records[0].kind === "학습" && r.records[0].range === "p.80-85")
 assert(r.records[0].subject === "개념원리 1-2" && r.records[1].subject === "RPM", "subject: regular book name, else progress book name before the brackets: " + r.records.map((x: any) => x.subject).join())
}))

Deno.test("record cards: unit, homework count and due, test average, page body (v2.5.95)", () => withMock(async (f) => {
 const num = (n: number) => ({ type: "number", number: n })
 f.pages.recA = { id: "recA", db: "records", properties: { "학습": title("[학습] 개념원리"), "구분": { select: { name: "학습" } }, "수업": rel("s1"), "교재": rel("regular"), "범위": text("p.80-85"), "단원": text("1-1. 평면좌표"), "내용": text("선과제 테스트") }, blocks: [{ id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "본문 한 줄", annotations: {} }] } }] }
 f.pages.recH = { id: "recH", db: "records", properties: { "학습": title("[과제] 개념원리"), "구분": { select: { name: "과제" } }, "수업": rel("s1"), "범위": text("10-20") } }
 f.pages.recT = { id: "recT", db: "records", properties: { "학습": title("[평가] 개념원리"), "구분": { select: { name: "평가" } }, "수업": rel("sPrev") } }
 f.pages.h9 = { id: "h9", db: "activities", properties: { "학습활동": title("h9"), "학습기록": rel("recH"), "과제상태": { select: { name: "🔵 제출" } }, "과제 마감일": { type: "formula", formula: { type: "date", date: { start: "2026-10-15T15:00:00.000Z" } } } } }
 f.pages.h8 = { id: "h8", db: "activities", properties: { "학습활동": title("h8"), "학습기록": rel("recH"), "과제상태": { select: { name: "🔴 미제출" } } } }
 f.pages.e1 = { id: "e1", db: "activities", properties: { "학습활동": title("e1"), "학습기록": rel("recT"), "정답 문항": num(9), "전체 문항": num(10) } }
 f.pages.e2 = { id: "e2", db: "activities", properties: { "학습활동": title("e2"), "학습기록": rel("recT"), "정답 문항": num(7), "전체 문항": num(10) } }
 const r = await room.loadClassRecords("s1"), by = (id: string): any => r.records.find((x: any) => x.id === id)
 assert(by("recA").unit === "1-1. 평면좌표" && by("recA").content === "선과제 테스트" && by("recA").body.length === 0 && by("recA").homework === null, JSON.stringify(by("recA")))
 assert(JSON.stringify(by("recH").homework) === JSON.stringify({ submitted: 1, total: 2, due: "2026-10-16" }) && by("recH").body.length === 0, JSON.stringify(by("recH").homework))
 assert(JSON.stringify(by("recT").score) === JSON.stringify({ avg: 80, count: 2 }), JSON.stringify(by("recT").score))
 f.pages.s1.properties["학습기록"] = rel("recA", "recH")
 const ses: any = await room.loadSession("s1")
 assert(ses.records.length === 2 && ses.records.find((x: any) => x.id === "recH").homework.total === 2 && ses.records.find((x: any) => x.id === "recA").body.length === 0, "session records carry the same card fields, no body (v2.5.111)")
 // 본문은 펼칠 때 record-body로(v2.5.111)
 const rb: any = await room.handleClassRoom({ action: "record-body", recordId: "recA" })
 assert(rb.recordId === "recA" && JSON.stringify(rb.body).includes("본문 한 줄"), JSON.stringify(rb))
 await rejects(() => room.loadRecordBody("../x"), 400)
 f.pages.recO = { id: "recO", db: "records", properties: { "학습": title("다른 날 기록"), "구분": { select: { name: "학습" } }, "수업": rel("sOther") } }
 assert((await room.loadClassRecords("sOther")).records.map((x: any) => x.id).join() === "recO", "no class: only that session")
 await rejects(() => room.loadClassRecords("../x"), 400)
}))

Deno.test("class-sessions: homework due that day per session (v2.5.103)", () => withMock(async (f) => {
 const due = (d: string) => ({ type: "formula", formula: { type: "date", date: { start: d } } })
 f.pages.rH = { id: "rH", db: "records", properties: { "학습": title("[과제]"), "구분": { select: { name: "과제" } }, "수업": rel("sPrev") } }
 f.pages.k1 = { id: "k1", db: "activities", properties: { "학습활동": title("k1"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔵 제출" } }, "과제 마감일": due("2026-10-13T00:00:00.000+09:00") } }
 f.pages.k2 = { id: "k2", db: "activities", properties: { "학습활동": title("k2"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔴 미제출" } }, "과제 마감일": due("2026-10-13") } }
 f.pages.k3 = { id: "k3", db: "activities", properties: { "학습활동": title("k3"), "학습기록": rel("rH"), "과제상태": { select: { name: "🔵 제출" } } } }
 const r = await room.loadClassSessions("s1")
 const s1: any = r.sessions.find((x: any) => x.id === "s1"), prev: any = r.sessions.find((x: any) => x.id === "sPrev")
 assert(s1.hwDone === 1 && s1.hwTotal === 2, "due on the 13th: 1 of 2 " + JSON.stringify(s1))
 assert(prev.hwDone === 0 && prev.hwTotal === 0, "nothing due on the 8th")
}))

Deno.test("class-sessions: same class around the session with attendance counts, makeups skipped", () => withMock(async () => {
 const r = await room.loadClassSessions("s1")
 assert(r.sessions.map((s) => s.id).join() === "sPrev,s1", r.sessions.map((s) => s.id).join())
 const p = r.sessions[0]; assert(p.date === "2026-10-08" && p.total === 3 && p.present === 1 && p.absent === 1 && p.missing === 1, JSON.stringify(p))
 const now = r.sessions[1]; assert(now.date === "2026-10-13" && now.time === "17:00–18:00" && now.present === 1 && now.missing === 1, JSON.stringify(now))
 assert((await room.loadClassSessions("sOther")).sessions.length === 0)
 await rejects(() => room.loadClassSessions("../x"), 400)
 await rejects(() => room.loadClassSessions("s1", "10/13"), 400)
 assert((await room.loadClassSessions("s1", "2026-12-20")).sessions.length === 0, "around moves the range")
}))
Deno.test("session: students, today's homework due grouped by record, records", () => withMock(async () => {
 const s = await room.loadSession("s1")
 assert(s.session.classEmoji === "🟡", "class emoji on the session")
 assert(s.session.className === "중1 B" && s.students.map((x) => x.name).join() === "김하늘,박서준")
 assert(s.students[0].memo === "집중 좋음" && s.students[0].status === "🟢 출석" && !("dueActivityIds" in s.students[0]))
 assert(s.homeworkDue.length === 1 && s.homeworkDue[0].items.map((i) => `${i.attendanceId}:${i.submitted}`).join() === "aa:true,ab:false")
}))
Deno.test("books: owners and template grouping data", () => withMock(async () => {
 const b = await room.loadBooks("s1")
 const g = b.books.find((x) => x.id === "group")!; assert(g.ownerIds.join() === "ra,rb" && g.mode === "그룹 진도")
 assert(b.books.filter((x) => x.templateId === "tpl").map((x) => x.ownerIds.join()).join("|") === "ra|rb")
 assert(g.cover === "https://example.com/cover.png" && g.pages === 248 && g.progress === 34 && g.recent === "p.78-83", "cover, pages, progress and recent range for the book card")
 const ind = b.books.find((x) => x.id === "indA")!; assert(ind.cover === "" && ind.pages === null && ind.progress === null && ind.recent === "", "books without a regular book or progress stay empty")
}))
Deno.test("records: group book links the class, repeat returns the existing record", () => withMock(async (f) => {
 const r1 = await room.createRecords({ sessionId: "s1", kind: "학습", bookIds: ["group"] })
 const rec = f.created[0]; assert(r1.records[0].created && ids(rec, "등록") === "ra,rb" && ids(rec, "출석") === "aa,ab" && ids(rec, "교재") === "regular" && ids(rec, "과목") === "math")
 assert(rec.properties["학습"].title[0].text.content === "[학습] 개념원리 1-2 · 중1 B 10.13(화)" && rec.properties["보강"] === undefined && rec.properties["학습정보 수정일"])
 assert(ids(rec, "클래스") === "cls", "v2.8.0 item 81: the record carries the session's class")
 f.pages.s1.properties["학습기록"] = rel(rec.id)
 const r2 = await room.createRecords({ sessionId: "s1", kind: "학습", bookIds: ["group"] })
 assert(!r2.records[0].created && r2.records[0].id === rec.id && f.created.length === 1)
}))
Deno.test("records: template batch makes one record per student's own book", () => withMock(async (f) => {
 const r = await room.createRecords({ sessionId: "s1", kind: "과제", bookIds: ["indA", "indB"] })
 assert(r.records.length === 2 && f.created.map((p) => ids(p, "등록") + "/" + ids(p, "출석")).join() === "ra/aa,rb/ab")
 assert(f.created[0].properties["학습"].title[0].text.content === "[과제] RPM(김하늘) · 중1 B 10.13(화)")
}))
// (261123 출시 전 4번) 여러 줄 중 하나가 실패해도 나머지는 쓰고, 된 줄 · 안 된 줄을 함께 답한다.
async function partial(fn: () => Promise<unknown>): Promise<any> {
 try { await fn() } catch (e) { assert(e instanceof room.ClassRoomError && e.status === 502, "expected 502, got " + (e as Error).message); return e }
 throw new Error("expected partial failure")
}
Deno.test("출시 전 4번: 출결 여러 명 중 한 명 실패 → 나머지는 노션에 쓰고 실패한 줄만 이유와 함께", () => withMock(async (f) => {
 const e = await partial(() => room.saveAttendance([{ attendanceId: "aa", status: "🔴 결석" }, { attendanceId: "zz", status: "🔴 결석" }, { attendanceId: "ab", status: "🟢 출석" }]))
 assert(f.pages.aa.properties["출석 상태"].select.name === "🔴 결석" && f.pages.ab.properties["출석 상태"].select.name === "🟢 출석", "others written")
 assert(JSON.stringify(e.detail.savedIds.sort()) === '["aa","ab"]' && e.detail.saved === 2, JSON.stringify(e.detail))
 assert(e.detail.failed.length === 1 && e.detail.failed[0].id === "zz" && e.detail.failed[0].error, JSON.stringify(e.detail.failed))
 assert(/출결 3건 중 1건/.test(e.message), e.message)
 const a = await partial(() => room.saveActivities([{ activityId: "hw1", submitted: true }, { activityId: "nope", submitted: true }]))
 assert(a.detail.savedIds[0] === "hw1" && a.detail.failed[0].id === "nope")
}))
Deno.test("출시 전 4번: 교재 여러 권 기록 중 하나가 실패해도 앞 기록은 만든 채로 함께 답한다", () => withMock(async (f) => {
 const base = globalThis.fetch
 let n = 0
 globalThis.fetch = (async (input: any, init: any = {}) => { if (String(input).endsWith("/pages") && init.method === "POST" && ++n === 2) return new Response(JSON.stringify({ message: "conflict" }), { status: 409 }); return base(input, init) }) as typeof fetch
 const e = await partial(() => room.createRecords({ sessionId: "s1", kind: "과제", bookIds: ["indA", "indB"] }))
 assert(f.created.length === 1 && e.detail.records.length === 1 && e.detail.records[0].created && e.detail.failed[0].id === "indB", JSON.stringify(e.detail))
 // 하나도 못 만들면 예전처럼 그 오류
 await rejects(() => room.createRecords({ sessionId: "s1", kind: "과제", topic: "x", registrationIds: ["rc"] }), 400)
}))
Deno.test("records: no book uses the topic; chosen students only", () => withMock(async (f) => {
 await room.createRecords({ sessionId: "s1", kind: "평가", topic: "단원 평가", registrationIds: ["rb"] })
 const rec = f.created[0]; assert(ids(rec, "등록") === "rb" && ids(rec, "출석") === "ab" && rec.properties["진도교재"] === undefined)
 assert(rec.properties["주제"].rich_text[0].text.content === "단원 평가" && rec.properties["학습"].title[0].text.content === "[평가] 단원 평가 · 중1 B 10.13(화)")
 const r3 = await room.createRecords({ sessionId: "s1", kind: "학습", topic: "실험 정리", range: " p.1-3 ", content: "• 관찰" })
 const rec3 = f.created.find((p) => p.id === r3.records[0].id); assert(rec3.properties["범위"].rich_text[0].text.content === "p.1-3" && rec3.properties["내용"].rich_text[0].text.content === "• 관찰", "range and content at creation")
 await rejects(() => room.createRecords({ sessionId: "s1", kind: "학습", topic: "x", range: 3 }), 400)
 await rejects(() => room.createRecords({ sessionId: "s1", kind: "숙제" }), 400)
 await rejects(() => room.createRecords({ sessionId: "s1", kind: "학습", registrationIds: ["rc"] }), 400)
}))
Deno.test("records: makeup session links owners only and checks 보강", () => withMock(async (f) => {
 f.pages.s1.properties["수업 구분"] = { select: { name: "보강" } }; f.pages.s1.properties["클래스"] = rel()
 await room.createRecords({ sessionId: "s1", kind: "학습", bookIds: ["indB"] })
 const rec = f.created[0]; assert(ids(rec, "등록") === "rb" && rec.properties["보강"].checkbox === true && rec.properties["학습"].title[0].text.content === "[학습] RPM(박서준) 10.13(화)")
 f.pages.ra.properties["진도교재"] = rel("group"); f.pages.rb.properties["진도교재"] = rel("indB")
 await room.createRecords({ sessionId: "s1", kind: "과제", bookIds: ["group"] })
 assert(ids(f.created[1], "등록") === "ra", "group book in a makeup session links its owner only")
}))
Deno.test("update record: topic/range/content and title follow the rule", () => withMock(async (f) => {
 await room.createRecords({ sessionId: "s1", kind: "학습", topic: "실험" }); const id = f.created[0].id
 f.pages[id].properties["수업"] = rel("s1")
 await room.updateRecord({ recordId: id, topic: "실험 정리", range: "p.12-15", content: "• 결과 정리" })
 const w = f.writes.at(-1)!.body.properties
 assert(w["주제"].rich_text[0].text.content === "실험 정리" && w["범위"].rich_text[0].text.content === "p.12-15" && w["학습"].title[0].text.content === "[학습] 실험 정리 · 중1 B 10.13(화)")
 await room.updateRecord({ recordId: id, bookId: "group" })
 const w2 = f.writes.at(-1)!.body.properties; assert(ids({ properties: w2 }, "진도교재") === "group" && w2["학습"].title[0].text.content === "[학습] 개념원리 1-2 · 중1 B 10.13(화)")
}))
Deno.test("save attendance and activities: validated, stamped for the report sync", () => withMock(async (f) => {
 await room.saveAttendance([{ attendanceId: "ab", status: "🔴 결석", memo: "병결", comment: "다음 시간 보충해요" }])
 const p = f.writes[0].body.properties; assert(p["출석 상태"].select.name === "🔴 결석" && p["메모"].rich_text[0].text.content === "병결" && p["학습정보 수정일"].date.start)
 await rejects(() => room.saveAttendance([{ attendanceId: "ab", status: "🟡 지각" }]), 400)
 await rejects(() => room.saveAttendance([]), 400)
 await room.saveActivities([{ activityId: "hw2", submitted: true }, { activityId: "hw1", correct: 18, total: 20 }])
 assert(f.writes.some((w) => w.id === "hw2" && w.body.properties["과제상태"].select.name === "🔵 제출"))
 assert(f.writes.some((w) => w.id === "hw1" && w.body.properties["정답 문항"].number === 18 && w.body.properties["전체 문항"].number === 20))
 await rejects(() => room.saveActivities([{ activityId: "hw1", correct: 21, total: 20 }]), 400)
 // v2.6.9: 과제상태 3단계와 내부용 메모. status가 submitted보다 우선, 빈 status는 선택 해제
 await room.saveActivities([{ activityId: "hw2", status: "일부 제출", memo: "  절반만  " }, { activityId: "hw1", status: "", submitted: true }])
 const w2 = f.writes.filter((w) => w.id === "hw2").at(-1)!.body.properties, w1 = f.writes.filter((w) => w.id === "hw1").at(-1)!.body.properties
 assert(w2["과제상태"].select.name === "🟡 일부 제출" && w2["메모"].rich_text[0].text.content === "절반만" && w1["과제상태"].select === null && w1["메모"] === undefined, JSON.stringify([w2, w1]))
 await room.saveActivities([{ activityId: "hw2", status: "미제출", memo: "" }])
 { const w = f.writes.at(-1)!.body.properties; assert(w["과제상태"].select.name === "🔴 미제출" && w["메모"].rich_text.length === 0) }
 await rejects(() => room.saveActivities([{ activityId: "hw2", status: "🟡 일부 제출" }]), 400)
 await rejects(() => room.saveActivities([{ activityId: "hw2", memo: 3 }]), 400)
 f.pages.hw2.properties["과제상태"] = { select: { name: "🟡 일부 제출" } }
 f.pages.hw2.properties["메모"] = text("절반만"); f.pages.hw1.properties["과제상태"] = { select: { name: "🔵 제출" } }; f.pages.hw1.properties["메모"] = text("")
 const acts = (await room.loadActivities("rec0")).activities
 const h1 = acts.find((a: any) => a.id === "hw1")!, h2 = acts.find((a: any) => a.id === "hw2")!
 assert(h1.status === "제출" && h1.submitted && h1.memo === "" && h2.status === "일부 제출" && !h2.submitted && h2.memo === "절반만", JSON.stringify(acts))
 assert(room.homeworkState("🔴 미제출") === "미제출" && room.homeworkState(null) === "" && room.homeworkState("일부 제출") === "일부 제출")
}))
// (v2.8.0 항목 92) 보강은 v2.8 노션 모델(결석 → [보강 배정] → 기존 결석)로 — 시험은 makeupAssign_test.ts.
Deno.test("makeup: old-model calls are refused (attendance without 기존 결석, attendanceIds), regular sessions untouched", () => withMock(async (f) => {
 await rejects(() => room.createMakeupSession({ attendanceIds: ["wait1"], teacherId: "t1", start: "2026-10-13T06:00:00.000Z" }), 400)
 await rejects(() => room.unlinkMakeup("wait1"), 409)
 await rejects(() => room.deleteMakeupSession("s1"), 409) // regular session
 assert(f.created.length === 0 && !f.pages.s1.archived)
}))
Deno.test("unknown actions and malformed ids are rejected", () => withMock(async () => {
 await rejects(() => room.handleClassRoom({ action: "drop-all" }), 400)
 await rejects(() => room.handleClassRoom({ action: "session", sessionId: "../x" }), 400)
 await rejects(() => room.handleClassRoom({ action: "save-attendance", items: [{ attendanceId: "1".repeat(32), memo: "x" }].concat(Array(60).fill({ attendanceId: "1".repeat(32) })) }), 400)
}))
Deno.test("student space: recent homework, scored tests and past memos for the registration", () => withMock(async (f) => {
 f.pages.hw1.properties["구분"] = { type: "rollup", rollup: { array: [{ select: { name: "과제" } }] } }
 f.pages.hw1.properties["과제 마감일"] = { type: "formula", formula: { type: "date", date: { start: "2026-10-13" } } }
 f.pages.t9 = { id: "t9", db: "activities", properties: { "학습활동": title("t9"), "학습기록": rel("rec0"), "등록": rel("ra"), "구분": { rollup: { array: [{ select: { name: "평가" } }] } }, "정답 문항": { number: 18 }, "전체 문항": { number: 20 } } }
 f.pages.aOld = { id: "aOld", db: "attendance", properties: { "등록": rel("ra"), "수업일시": { date: { start: "2026-10-10T08:00:00.000Z" } }, "메모": text("지각 15분") } }
 const s = await room.loadStudent("ra")
 assert(s.homework.length === 1 && s.homework[0].submitted && s.homework[0].due === "2026-10-13" && s.homework[0].range === "p.31-35")
 // v2.8.0 항목 81: 마감일 수식이 글자(string)로 와도 날짜 모양이면 읽고, 아니면 비움
 f.pages.hw1.properties["과제 마감일"] = { type: "formula", formula: { type: "string", string: "2026-10-14" } }
 assert((await room.loadStudent("ra")).homework[0].due === "2026-10-14", "string date formula")
 f.pages.hw1.properties["과제 마감일"] = { type: "formula", formula: { type: "string", string: "dddd-dd-dd" } }
 assert((await room.loadStudent("ra")).homework[0].due === null, "non-date string")
 assert(s.tests.length === 1 && s.tests[0].correct === 18 && s.tests[0].total === 20)
 assert(s.memos.map((m) => m.memo).sort().join() === "지각 15분,집중 좋음")
}))
Deno.test("v2.8.0 항목 62 attendance memo: old 메모 still works, renamed 메모(내부용) is read, queried and written; activity 메모 unchanged", () => withMock(async (f) => {
 // 예전 이름 학원: 새 이름으로 먼저 보내고 400이면 `메모`로 다시 쓴다. 그다음부터는 바로 `메모`.
 const before = (await room.loadSession("s1")).students.find((s: any) => s.attendanceId === "aa")!
 assert(before.memo === "집중 좋음", "old name read")
 await room.saveAttendance([{ attendanceId: "aa", memo: "예전 이름" }])
 assert(f.writes.at(-1)!.body.properties["메모"].rich_text[0].text.content === "예전 이름" && f.writes.at(-1)!.body.properties["메모(내부용)"] === undefined)
 const n = f.writes.length; await room.saveAttendance([{ attendanceId: "aa", memo: "두 번째" }])
 assert(f.writes.length === n + 1 && f.pages.aa.properties["메모"].rich_text[0].text.content === "두 번째", "learned old name")
 // 이름을 바꾼 학원
 attMemo.resetAttMemoName()
 f.pages.__attMemo = "메모(내부용)"
 for (const id of ["aa", "ab"]) { const p = f.pages[id].properties; p["메모(내부용)"] = p["메모"]; delete p["메모"] }
 f.pages.aa.properties["메모(내부용)"] = text("새 이름 메모")
 const after = (await room.loadSession("s1")).students.find((s: any) => s.attendanceId === "aa")!
 assert(after.memo === "새 이름 메모", "new name read: " + JSON.stringify(after))
 await room.saveAttendance([{ attendanceId: "ab", memo: "병결", status: "🔴 결석" }])
 const w = f.writes.at(-1)!.body.properties
 assert(w["메모(내부용)"].rich_text[0].text.content === "병결" && w["메모"] === undefined && w["출석 상태"].select.name === "🔴 결석", JSON.stringify(w))
 const st = await room.loadStudent("ra")
 assert(st.memos.map((m) => m.memo).join() === "새 이름 메모", JSON.stringify(st.memos))
 assert(f.queries.some((q) => q.db === "attendance" && JSON.stringify(q.filter).includes('"property":"메모(내부용)"')))
 // 학습활동 메모는 이름이 그대로 `메모`
 await room.saveActivities([{ activityId: "hw2", memo: "활동 메모" }])
 const wa = f.writes.at(-1)!.body.properties; assert(wa["메모"].rich_text[0].text.content === "활동 메모" && wa["메모(내부용)"] === undefined)
}))

Deno.test("v2.8.0 항목 64 activity memo: renamed 메모(내부용) is written and read, old 메모 still works", () => withMock(async (f) => {
 room.resetActivityMemoName()
 await room.saveActivities([{ activityId: "hw1", memo: "예전" }])
 assert(f.writes.at(-1)!.body.properties["메모"].rich_text[0].text.content === "예전", "old name")
 room.resetActivityMemoName()
 f.pages.__actMemo = "메모(내부용)"
 for (const id of ["hw1", "hw2"]) { const p = f.pages[id].properties; delete p["메모"] }
 await room.saveActivities([{ activityId: "hw2", memo: "새 이름" }])
 const w = f.writes.at(-1)!.body.properties
 assert(w["메모(내부용)"].rich_text[0].text.content === "새 이름" && w["메모"] === undefined, JSON.stringify(w))
 room.resetActivityMemoName()
}))

// v2.5.126: 학습기록 "선택 단원"
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", U2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
Deno.test("records: picked units go to 선택 단원 for the same library book, can be changed or cleared, and become the unit text", () => withMock(async (f) => {
 sel.resetSelectedUnitsEnabled()
 f.pages[U1] = { id: U1, db: "units", properties: { "단원명": title("1-1. 소인수분해") } }
 f.pages[U2] = { id: U2, db: "units", properties: { "단원명": title("1-2. 정수") } }
 const r = await room.createRecords({ sessionId: "s1", kind: "학습", bookIds: ["group"], unitIds: [U1, U2, "not-an-id", U1], unitBookId: "regular" })
 const rec = f.created[0]
 assert(r.unitsSaved === true && ids(rec, "선택 단원") === U1 + "," + U2, JSON.stringify(rec.properties["선택 단원"]))
 await room.createRecords({ sessionId: "s1", kind: "과제", bookIds: ["group"], unitIds: [U1], unitBookId: "another-book" })
 assert(f.created[1].properties["선택 단원"] === undefined, "units of another library book are not linked")
 const plain = await room.createRecords({ sessionId: "s1", kind: "평가", bookIds: ["group"] })
 assert(plain.unitsSaved === undefined && f.created[2].properties["선택 단원"] === undefined)
 f.pages[rec.id].properties["단원"] = formula("수식 단원")
 const a = await room.loadActivities(rec.id)
 assert(a.record.unit === "1-1. 소인수분해 1-2. 정수" && a.record.unitIds.join() === U1 + "," + U2, JSON.stringify(a.record))
 const u = await room.updateRecord({ recordId: rec.id, unitIds: [U2] })
 assert(u.unitsSaved === true && ids(f.pages[rec.id], "선택 단원") === U2)
 await room.updateRecord({ recordId: rec.id, unitIds: [] })
 assert(ids(f.pages[rec.id], "선택 단원") === "" && (await room.loadActivities(rec.id)).record.unit === "수식 단원", "cleared: falls back to the 단원 formula")
 await room.updateRecord({ recordId: rec.id, range: "p.2" })
 assert(!f.writes.at(-1).body.properties["선택 단원"], "no unitIds: 선택 단원 untouched")
}))
Deno.test("records: academies without 선택 단원 keep working and say units were not saved", () => withMock(async (f) => {
 sel.resetSelectedUnitsEnabled(); f.pages.__noUnitsProp = true
 const r = await room.createRecords({ sessionId: "s1", kind: "학습", bookIds: ["group"], unitIds: [U1], unitBookId: "regular" })
 assert(r.unitsSaved === false && f.created[0].properties["선택 단원"] === undefined)
 sel.resetSelectedUnitsEnabled()
}))

// ---------- (2.8 하루 수업 페이지, 앱서버 261118) ----------
Deno.test("day/session: 수업 구분·학습 내용·처리 상태·오류·시간표, 수업 안내, 출석 보고서 전송 상태", () => withMock(async (f) => {
 Object.assign(f.pages.s1.properties, {
  "수업 구분": { type: "select", select: { name: "보강" } }, "학습 내용": formula("개념원리 p.78-83"),
  "실시간 처리 상태": formula("🔄 출석 조정 중"), "마지막 오류": text("예시 오류"), "시간표": rel("tt1"),
  "수업 안내 메모": text("교재 챙기기"), "수업 안내 현황": formula("미발송"), "수업 안내 미리보기": formula("안녕하세요…"),
 })
 f.pages.aa.properties["보고서 전송 상태"] = { type: "select", select: { name: "✅ 완료" } }
 const day = await room.loadDay("2026-10-13", "t1")
 const d = day.sessions[0] as any
 assert(d.kind === "보강" && d.summary === "개념원리 p.78-83" && d.busy === "🔄 출석 조정 중" && d.error === "예시 오류" && d.blockId === "tt1", JSON.stringify(d))
 const s = await room.loadSession("s1") as any
 assert(s.session.notice === "교재 챙기기" && s.session.noticeStatus === "미발송" && s.session.noticePreview === "안녕하세요…" && s.session.kind === "보강", JSON.stringify(s.session))
 const a = s.students.find((x: any) => x.attendanceId === "aa"), b = s.students.find((x: any) => x.attendanceId === "ab")
 assert(a.reportStatus === "✅ 완료" && b.reportStatus === "")
}))
Deno.test("save-attendance: 등·하원 시각 고치기(ISO, 빈 값은 비우기), 형식이 틀리면 400", () => withMock(async (f) => {
 await room.saveAttendance([{ attendanceId: "aa", arrivedAt: "2026-10-13T07:55:00.000Z", leftAt: "" }])
 const w = f.writes.at(-1).body.properties
 assert(w["등원스템프"].date.start === "2026-10-13T07:55:00.000Z" && w["하원스템프"].date === null, JSON.stringify(w))
 await rejects(() => room.saveAttendance([{ attendanceId: "aa", arrivedAt: "17:55" }]), 400)
}))
Deno.test("update-session: 수업 안내 메모만 쓴다(보내기 없음)", () => withMock(async (f) => {
 const r = await room.handleClassRoom({ action: "update-session", sessionId: "s1", notice: "다음 주 시험" }) as any
 assert(r.saved === 1 && r.notice === "다음 주 시험")
 const w = f.writes.at(-1); assert(w.id === "s1" && Object.keys(w.body.properties).join() === "수업 안내 메모")
 await rejects(() => room.handleClassRoom({ action: "update-session", sessionId: "s1" }), 400)
}))
Deno.test("routines: 수업의 루틴 체크(이름·출석·완료, 순서대로), 칸 없는 학원은 빈 목록, 생성은 이미 도는 중이면 다시 넣지 않음", () => withMock(async (f) => {
 const none = await room.handleClassRoom({ action: "routines", sessionId: "s1" }) as any
 assert(none.available === false && none.checks.length === 0)
 Object.assign(f.pages, {
  rt1: { id: "rt1", db: "routines", properties: { "이름": title("단어 암기"), "순서": { type: "number", number: 2 } } },
  rt2: { id: "rt2", db: "routines", properties: { "이름": title("일기"), "순서": { type: "number", number: 1 } } },
  ck1: { id: "ck1", db: "checks", properties: { "이름": title("단어 암기 · aa"), "루틴": rel("rt1"), "출석": rel("aa"), "등록": rel("ra"), "완료": { type: "checkbox", checkbox: true } } },
  ck2: { id: "ck2", db: "checks", properties: { "이름": title("일기 · aa"), "루틴": rel("rt2"), "출석": rel("aa"), "등록": rel("ra"), "완료": { type: "checkbox", checkbox: false } } },
 })
 f.pages.s1.properties["루틴 체크"] = rel("ck1", "ck2")
 f.pages.s1.properties["루틴 체크 상태"] = { type: "select", select: { name: "🔄 작업중" } }
 const r = await room.handleClassRoom({ action: "routines", sessionId: "s1" }) as any
 assert(r.available && r.status === "🔄 작업중" && r.checks.map((c: any) => `${c.routineName}:${c.done}`).join() === "일기:false,단어 암기:true", JSON.stringify(r))
 const q = await room.handleClassRoom({ action: "create-routine-checks", sessionId: "s1" }) as any
 assert(q.queued === false && q.message === "already_processing")
 await rejects(() => room.handleClassRoom({ action: "create-routine-checks", sessionId: "../x" }), 400)
}))
Deno.test("save-routines: 루틴 체크 줄의 완료만 쓰고 출석 수정일을 적는다, 루틴 체크가 아니면·형식이 틀리면 400", () => withMock(async (f) => {
 Object.assign(f.pages, {
  ck1: { id: "ck1", db: "checks", properties: { "이름": title("단어 암기 · aa"), "루틴": rel("rt1"), "출석": rel("aa"), "완료": { type: "checkbox", checkbox: false } } },
 })
 const r = await room.handleClassRoom({ action: "save-routines", items: [{ checkId: "ck1", done: true }] }) as any
 assert(r.saved === 1 && f.pages.ck1.properties["완료"].checkbox === true)
 const ckWrite = f.writes.find((w: any) => w.id === "ck1"); assert(Object.keys(ckWrite.body.properties).join() === "완료")
 assert(f.writes.some((w: any) => w.id === "aa" && w.body.properties["학습정보 수정일"]), "출석 수정일")
 await rejects(() => room.handleClassRoom({ action: "save-routines", items: [{ checkId: "aa", done: true }] }), 400) // 출석 줄은 루틴 체크가 아님
 await rejects(() => room.handleClassRoom({ action: "save-routines", items: [{ checkId: "ck1", done: "yes" }] }), 400)
 await rejects(() => room.handleClassRoom({ action: "save-routines", items: [] }), 400)
}))
