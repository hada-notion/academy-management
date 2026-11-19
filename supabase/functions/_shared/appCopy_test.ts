// appCopy 단위 시험(v2.8.0 항목 74): 속성 평평하게 · DB 고르기(옛 이름) · 앱 DB 목록.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { APP_DBS, flattenProps, isAppDb, pageRow, pickSources, resolveSources } from "./appCopy.ts"
import { CLEAR_DBS, KEEP_DBS } from "./exampleClear.ts"
import "./dbNames_test.ts" // 관 꼬리표 이름(항목 102) 시험도 이 파일이 도는 CI에서 같이 돈다
import "./syncCopy_test.ts" // 앱 [동기화] 버튼(항목 105) 시험

const rt = (s: string) => [{ plain_text: s }]

Deno.test("속성마다 평평한 값: 제목·글·고르기·상태·여러 개·관계·날짜·숫자·체크·수식·롤업·사람·파일, 버튼은 뺌", () => {
  const out = flattenProps({
    이름: { type: "title", title: rt("홍길동") },
    메모: { type: "rich_text", rich_text: [...rt("가"), ...rt("나")] },
    상태: { type: "select", select: { name: "등록 중" } },
    진행: { type: "status", status: { name: "진행 중" } },
    요일: { type: "multi_select", multi_select: [{ name: "월" }, { name: "수" }] },
    클래스: { type: "relation", relation: [{ id: "c1" }, { id: "c2" }], has_more: true },
    등록일: { type: "date", date: { start: "2026-11-01", end: null } },
    수강료: { type: "number", number: 270000 },
    숨김: { type: "checkbox", checkbox: true },
    합계: { type: "formula", formula: { type: "number", number: 3 } },
    이름표: { type: "formula", formula: { type: "string", string: "중1" } },
    학생수: { type: "rollup", rollup: { type: "number", number: 4 } },
    학교: { type: "rollup", rollup: { type: "array", array: [{ type: "title", title: rt("하다중") }] } },
    담당: { type: "people", people: [{ id: "u1" }] },
    첨부: { type: "files", files: [{ name: "a.pdf", file: { url: "https://x/a.pdf" } }] },
    생성: { type: "button", button: {} },
  })
  assertEquals(out, {
    이름: "홍길동", 메모: "가나", 상태: "등록 중", 진행: "진행 중", 요일: ["월", "수"],
    클래스: ["c1", "c2"], "클래스#more": true, 등록일: { start: "2026-11-01", end: null }, 수강료: 270000, 숨김: true,
    합계: 3, 이름표: "중1", 학생수: 4, 학교: ["하다중"], 담당: ["u1"], 첨부: [{ name: "a.pdf", url: "https://x/a.pdf" }],
  })
})

Deno.test("복사하지 않는 칸: 리포트 토큰 · 웹훅 칸 · 노션 계정", () => {
  const rt = [{ plain_text: "secret" }]
  assertEquals(flattenProps({ 토큰: { type: "rich_text", rich_text: rt }, "웹훅 링크": { type: "formula", formula: { type: "string", string: "x" } }, "웹훅 버튼": { type: "select", select: { name: "a" } }, "노션 계정": { type: "people", people: [{ id: "u" }] }, 이름: { type: "title", title: [{ plain_text: "가" }] } }), { 이름: "가" })
})

Deno.test("빈 값: 고르기 없음은 빈 글자, 날짜 없음은 null, 숫자 없음은 null", () => {
  assertEquals(flattenProps({ a: { type: "select", select: null }, b: { type: "date", date: null }, c: { type: "number", number: null } }), { a: "", b: null, c: null })
})

Deno.test("줄: DB 이름 · id · 이모지 아이콘 · Notion 시각", () => {
  const r = pageRow("학생(학원) DB", { id: "p1", url: "https://n/p1", icon: { type: "emoji", emoji: "🔵" }, created_time: "2026-11-01T00:00:00.000Z", last_edited_time: "2026-11-02T00:00:00.000Z", properties: {} })
  assertEquals([r.db, r.id, r.icon, r.url, r.notion_edited_at], ["학생(학원) DB", "p1", "🔵", "https://n/p1", "2026-11-02T00:00:00.000Z"])
})

Deno.test("DB 고르기: 앱 DB만, 지금 이름이 있으면 옛 이름은 안 씀(없을 때만 옛 이름), 그 밖은 버림", () => {
  const m = pickSources(new Map([["학생(학원) DB", ["s"]], ["교재비(학원) DB", ["old"]], ["청구서(학원) DB", ["new"]], ["교재배부(학원) DB", ["oldline"]], ["업데이트(학원) DB", ["x"]]]))
  assertEquals(m.get("학생(학원) DB"), ["s"])
  assertEquals(m.get("청구서(학원) DB"), ["new"])
  assertEquals(m.get("청구 항목(학원) DB"), ["oldline"])
  assertEquals(m.has("업데이트(학원) DB" as never), false)
})

Deno.test("같은 이름 DB가 여럿: Secrets id → 기준 DB와 같은 최상위 페이지 → 안 좁혀지면 모호함(고르지 않음)", async () => {
  const found = new Map<any, string[]>([
    ["학생(학원) DB", ["stu-a", "stu-b"]],        // Secrets에 stu-a
    ["강사(학원) DB", ["t-a", "t-b", "t-old"]],   // 기준(등록 reg-a)과 같은 최상위 = t-a
    ["시즌(학원) DB", ["se-b", "se-old"]],        // 이 학원 것 없음 → 모호
    ["과목(학원) DB", ["sub-a", "sub-a2"]],       // 같은 최상위에 둘 → 모호
    ["클래스(학원) DB", ["c-a"]],                 // 하나면 그대로(부모 조회 없음)
  ])
  const top: Record<string, string> = { "reg-a": "A", "t-a": "A", "t-b": "B", "t-old": "OLD", "se-b": "B", "se-old": "OLD", "sub-a": "A", "sub-a2": "A" }
  const asked: string[] = []
  const r = await resolveSources(found, ["stu-a", "reg-a"], "reg-a", (id) => { asked.push(id); return Promise.resolve(new Set([top[id]])) })
  assertEquals(r.map.get("학생(학원) DB"), ["stu-a"])
  assertEquals(r.map.get("강사(학원) DB"), ["t-a"])
  assertEquals(r.map.get("클래스(학원) DB"), ["c-a"])
  assertEquals([r.map.has("시즌(학원) DB"), r.map.has("과목(학원) DB")], [false, false])
  assertEquals([...r.problems.keys()].sort(), ["과목(학원) DB", "시즌(학원) DB"])
  assertEquals(asked.includes("c-a") || asked.includes("stu-a"), false)
  // 기준 DB가 없으면(Secrets 없음) 여럿인 것은 모두 모호함
  const r2 = await resolveSources(new Map<any, string[]>([["강사(학원) DB", ["t-a", "t-b"]]]), [], null, () => Promise.resolve(new Set<string>()))
  assertEquals([r2.map.size, r2.problems.size], [0, 1])
})

Deno.test("앱 DB는 모두 예시 비우기 목록(비울 것·남길 것)에 있는 실제 DB 이름", () => {
  for (const db of APP_DBS) assertEquals(CLEAR_DBS.includes(db) || KEEP_DBS.includes(db), true, db)
  assertEquals(isAppDb("수업(학원) DB"), false) // 수업·출석·학습기록·학습활동은 cr_* 복사본
})
