// (v2.8.0 항목 92, C1) 보강 = v2.8 노션 보강 모델 하나로. 모든 네트워크는 가짜(Notion·Supabase), 비밀값 없음.
function assert(value: unknown, message = "assertion failed") { if (!value) throw new Error(message) }
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", CLASS_ROOM_COPY_WRITE: "off", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_CLASS_SESSION_ID: "sessions", DATA_SOURCE_ATTENDANCE_ID: "attendance", DATA_SOURCE_LEARNING_RECORD_ID: "records", DATA_SOURCE_STUDY_ACTIVITY_ID: "activities", DATA_SOURCE_REGISTRATION_ID: "registrations" })) Deno.env.set(key, value)
const room = await import("./classRoom.ts")
const mk = await import("./makeupAssign.ts")
const rel = (...ids: string[]) => ({ relation: ids.map((id) => ({ id })) })
const title = (s: string) => ({ type: "title", title: [{ plain_text: s, text: { content: s } }] })
const formula = (s: string) => ({ type: "formula", formula: { type: "string", string: s } })
const check = (b: boolean) => ({ type: "formula", formula: { type: "boolean", boolean: b } })
const sel = (s: string | null) => ({ select: s ? { name: s } : null })
const ids = (p: any, key: string) => (p.properties[key]?.relation ?? []).map((x: any) => x.id).join(",")
const MK_AT = "2026-10-31T09:00:00.000Z" // 18:00 KST

function fixture() {
 const pages: Record<string, any> = {
  mk: { id: "mk", db: "sessions", properties: { "이름": title("보강 10.31(토) 18:00"), "수업일시": { date: { start: MK_AT, end: "2026-10-31T10:00:00.000Z" } }, "등록": rel("rOther"), "출석": rel(), "학습기록": rel(), "수업 구분": sel("보강") } },
  reg: { id: "reg", db: "sessions", properties: { "이름": title("중1 B 10.13(화)"), "수업일시": { date: { start: MK_AT } }, "등록": rel(), "출석": rel(), "학습기록": rel(), "수업 구분": sel(null) } },
  // 원래 결석(판단 전), 보강 필요 결석, 보강 없음 결석, 이미 보강된 결석, 보강 출석
  ab1: { id: "ab1", db: "attendance", properties: { "출석": title("윤도현 10.13(화)"), "학생이름(알림톡)": formula("윤도현"), "클래스(알림톡)": formula("중1 B"), "등록": rel("r1"), "수업": rel("s0"), "수업일시": { date: { start: "2026-10-13T08:00:00.000Z" } }, "출석 상태": sel("🔴 결석"), "보강 여부": sel(null), "보강 수업": rel(), "보강 출석": rel(), "기존 결석": rel(), "보강 필요": check(false) } },
  ab2: { id: "ab2", db: "attendance", properties: { "출석": title("한서아 10.14(수)"), "학생이름(알림톡)": formula("한서아"), "등록": rel("r2"), "수업": rel("s0"), "수업일시": { date: { start: "2026-10-14T08:00:00.000Z" } }, "출석 상태": sel("🔴 결석"), "보강 여부": sel("보강 필요"), "보강 수업": rel(), "보강 출석": rel(), "기존 결석": rel(), "보강 필요": check(true) } },
  abNo: { id: "abNo", db: "attendance", properties: { "출석": title("정하준 10.15(목)"), "등록": rel("r3"), "수업": rel("s0"), "출석 상태": sel("🔴 결석"), "보강 여부": sel("보강 없음"), "보강 출석": rel(), "기존 결석": rel(), "보강 필요": check(false) } },
  abDone: { id: "abDone", db: "attendance", properties: { "출석": title("최유나 10.16(금)"), "등록": rel("r4"), "수업": rel("s0"), "출석 상태": sel("🔴 결석"), "보강 여부": sel("보강 필요"), "보강 출석": rel("mDone"), "기존 결석": rel(), "보강 필요": check(false) } },
  mDone: { id: "mDone", db: "attendance", properties: { "출석": title("최유나 10.20(화)"), "등록": rel("r4"), "수업": rel("mk0"), "출석 상태": sel("🔵 보강"), "기존 결석": rel("abDone"), "보강 출석": rel() } },
  ok1: { id: "ok1", db: "attendance", properties: { "출석": title("김하늘 10.13(화)"), "등록": rel("r5"), "수업": rel("s0"), "출석 상태": sel("🟢 출석"), "보강 출석": rel(), "기존 결석": rel(), "보강 필요": check(false) } },
 }
 const writes: any[] = [], created: any[] = [], queued: any[] = []
 function cond(p: any, f: any): boolean {
  if (!f) return true
  if (f.and) return f.and.every((x: any) => cond(p, x))
  if (f.or) return f.or.some((x: any) => cond(p, x))
  const v = p.properties[f.property]
  if (f.relation?.contains) return (v?.relation ?? []).some((r: any) => r.id === f.relation.contains)
  if (f.relation?.is_empty) return !(v?.relation ?? []).length
  if (f.select?.equals) return v?.select?.name === f.select.equals
  if (f.select?.is_empty) return !v?.select?.name
  if (f.formula?.checkbox) return v?.formula?.boolean === f.formula.checkbox.equals
  throw new Error("unexpected filter " + JSON.stringify(f))
 }
 const reply = (p: any, status = 200) => new Response(JSON.stringify(structuredClone(p)), { status })
 const fetch = async (input: any, init: any = {}) => {
  const url = String(input), body = init.body ? JSON.parse(init.body) : {}
  if (url.startsWith("https://mock.supabase")) { if (url.includes("/rest/v1/sync_queue")) queued.push(...[body].flat()); return reply([], 201) }
  const db = url.match(/\/data_sources\/([^/]+)\/query/)?.[1]
  if (db) return reply({ results: Object.values(pages).filter((p) => p.db === db && !p.archived && cond(p, body.filter)), has_more: false })
  const id = url.match(/\/pages\/([^/?]+)/)?.[1]
  if (id) {
   if (!pages[id]) return reply({ message: "missing " + id }, 404)
   if (init.method === "PATCH") { writes.push({ id, body }); Object.assign(pages[id].properties, body.properties ?? {}); if (body.archived) pages[id].archived = true }
   return reply(pages[id])
  }
  if (url.endsWith("/pages") && init.method === "POST") { const page = { id: "new" + created.length, db: body.parent.data_source_id, properties: body.properties }; pages[page.id] = page; created.push(page); return reply(page) }
  throw new Error("unmocked " + url)
 }
 return { pages, writes, created, queued, fetch }
}
async function withMock(run: (f: ReturnType<typeof fixture>) => Promise<void>) {
 const f = fixture(), original = globalThis.fetch
 globalThis.fetch = f.fetch as typeof fetch
 try { await run(f) } finally { globalThis.fetch = original }
}
async function rejects(fn: () => Promise<unknown>, status: number) {
 try { await fn() } catch (e) { assert(e instanceof room.ClassRoomError && e.status === status, `expected ${status}, got ${(e as Error).message}`); return }
 throw new Error("expected rejection " + status)
}

Deno.test("makeup-waiting: 노션 보강 대기 보기와 같은 결석만(판단 전 + 보강 필요), 보강 없음·이미 보강·출석·보강 출석은 빠짐", () => withMock(async () => {
 const r = await room.handleClassRoom({ action: "makeup-waiting" }) as any
 assert(r.waiting.map((w: any) => w.attendanceId).join() === "ab1,ab2", JSON.stringify(r.waiting.map((w: any) => w.attendanceId)))
 assert(r.waiting[0].name === "윤도현" && r.waiting[0].className === "중1 B" && r.waiting[0].decision === "" && r.waiting[1].decision === "보강 필요")
}))

Deno.test("assign-makeup = 노션 [보강 배정]: 🔵 보강 출석 한 장(기존 결석·수업·수업일시·이름), 결석 보강 수업, 수업 명단에 더함", () => withMock(async (f) => {
 const r = await room.handleClassRoom({ action: "assign-makeup", absenceId: "ab1", sessionId: "mk" }) as any
 const a = f.pages[r.attendanceId]
 assert(f.created.length === 1 && a.db === "attendance", "one attendance page")
 assert(a.properties["출석 상태"].select.name === "🔵 보강" && ids(a, "기존 결석") === "ab1" && ids(a, "수업") === "mk" && ids(a, "등록") === "r1")
 assert(a.properties["수업일시"].date.start === MK_AT && a.properties["수업일시"].date.end === "2026-10-31T10:00:00.000Z")
 assert(a.properties["출석"].title[0].text.content === "윤도현 10.31(토)", a.properties["출석"].title[0].text.content)
 assert(ids(f.pages.ab1, "보강 수업") === "mk", "결석의 보강 수업")
 assert(ids(f.pages.mk, "등록") === "rOther,r1", "roster keeps others and adds the student")
 // 같은 수업 다시 배정 → 이미 출석 있음(버튼처럼 두 장 생기지 않음)
 f.pages.ab1.properties["보강 출석"] = rel(r.attendanceId)
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "ab1", sessionId: "mk" }), 409)
 assert(f.created.length === 1)
}))

Deno.test("assign-makeup 막는 경우: 보강 없음·이미 보강됨·결석 아님·보강 출석에서·정규 수업·형식", () => withMock(async () => {
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "abNo", sessionId: "mk" }), 409)
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "abDone", sessionId: "mk" }), 409)
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "ok1", sessionId: "mk" }), 409)
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "mDone", sessionId: "mk" }), 409)
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "ab1", sessionId: "reg" }), 409)
 await rejects(() => room.handleClassRoom({ action: "assign-makeup", absenceId: "../x", sessionId: "mk" }), 400)
}))

Deno.test("assign-makeup: 보강도 결석이면 원래 결석을 다른 보강 수업에 다시 배정할 수 있다", () => withMock(async (f) => {
 f.pages.mDone.properties["출석 상태"] = sel("🔴 결석")
 const r = await room.handleClassRoom({ action: "assign-makeup", absenceId: "abDone", sessionId: "mk" }) as any
 assert(ids(f.pages[r.attendanceId], "기존 결석") === "abDone")
}))

Deno.test("create-makeup-session: 보강 수업을 만들고 결석들을 배정, 하나라도 안 되면 아무것도 만들지 않음, 옛 attendanceIds는 400", () => withMock(async (f) => {
 await rejects(() => room.handleClassRoom({ action: "create-makeup-session", attendanceIds: ["ab1"], teacherId: "t1", start: MK_AT }), 400)
 await rejects(() => room.handleClassRoom({ action: "create-makeup-session", absenceIds: ["ab1", "abNo"], teacherId: "t1", start: MK_AT }), 409)
 assert(f.created.length === 0, "nothing created when one absence is not assignable")
 const r = await room.handleClassRoom({ action: "create-makeup-session", absenceIds: ["ab1", "ab2"], teacherId: "t1", start: MK_AT }) as any
 const s = f.pages[r.sessionId]
 assert(s.properties["수업 구분"].select.name === "보강" && ids(s, "담당강사") === "t1" && s.properties["이름"].title[0].text.content === "보강 10.31(토) 18:00")
 assert(r.assigned.length === 2 && ids(s, "등록") === "r1,r2", "roster grows per assignment: " + ids(s, "등록"))
 assert(r.assigned.every((id: string) => f.pages[id].properties["출석 상태"].select.name === "🔵 보강" && ids(f.pages[id], "수업") === r.sessionId))
 // 결석 없이 빈 보강 수업만
 const empty = await room.handleClassRoom({ action: "create-makeup-session", teacherId: "t1", start: MK_AT }) as any
 assert(empty.assigned.length === 0 && f.pages[empty.sessionId].properties["수업 구분"].select.name === "보강")
}))

Deno.test("unlink-makeup·delete-makeup-session = 노션 [삭제]와 같은 큐(cascade-delete), 옛 출석·정규 수업·학습기록 있는 수업은 막음", () => withMock(async (f) => {
 const u = await room.handleClassRoom({ action: "unlink-makeup", attendanceId: "mDone" }) as any
 assert(u.status === "queued" && f.queued.some((q) => q.target === "cascade-delete" && q.payload?.pageId === "mDone"), JSON.stringify(f.queued))
 assert(f.pages.mDone.properties["삭제 상태"]?.select?.name === "⏳ 대기열", "marked queued like the [삭제] button")
 const again = await room.handleClassRoom({ action: "unlink-makeup", attendanceId: "mDone" }) as any
 assert(again.status === "already_processing")
 await rejects(() => room.handleClassRoom({ action: "unlink-makeup", attendanceId: "ab1" }), 409) // 보강 출석이 아님
 await rejects(() => room.handleClassRoom({ action: "delete-makeup-session", sessionId: "reg" }), 409) // 정규 수업
 f.pages.mk.properties["학습기록"] = rel("rec1")
 await rejects(() => room.handleClassRoom({ action: "delete-makeup-session", sessionId: "mk" }), 409)
 f.pages.mk.properties["학습기록"] = rel()
 const d = await room.handleClassRoom({ action: "delete-makeup-session", sessionId: "mk" }) as any
 assert(d.status === "queued" && f.queued.some((q) => q.payload?.pageId === "mk") && !f.pages.mk.archived, "the queue worker deletes, not this call")
}))

Deno.test("save-attendance makeupDecision: 결석 보강 여부 쓰기(보강 필요·보강 없음·비우기), 그 밖 값 400, 보강 수업 출석도 같은 출결 저장", () => withMock(async (f) => {
 await room.handleClassRoom({ action: "save-attendance", items: [{ attendanceId: "ab1", makeupDecision: "보강 없음" }] })
 assert(f.pages.ab1.properties["보강 여부"].select.name === "보강 없음" && f.pages.ab1.properties["학습정보 수정일"])
 const w = await room.handleClassRoom({ action: "makeup-waiting" }) as any
 assert(w.waiting.map((x: any) => x.attendanceId).join() === "ab2", "보강 없음 → 보강 대기에서 빠짐")
 await room.handleClassRoom({ action: "save-attendance", items: [{ attendanceId: "ab1", makeupDecision: "" }] })
 assert(f.pages.ab1.properties["보강 여부"].select === null)
 await rejects(() => room.handleClassRoom({ action: "save-attendance", items: [{ attendanceId: "ab1", makeupDecision: "보강 완료" }] }), 400)
 // 보강 수업의 보강 출석 출결(정규와 같은 동작)
 await room.handleClassRoom({ action: "save-attendance", items: [{ attendanceId: "mDone", status: "🔴 결석" }] })
 assert(f.pages.mDone.properties["출석 상태"].select.name === "🔴 결석")
}))

Deno.test("waitingFilter: 노션 묶음 두 단계 안", () => {
 const w = mk.waitingFilter() as any
 assert(w.or.length === 2 && w.or[0].and.length === 4 && !JSON.stringify(w.or[0].and).includes('"or"'))
})
