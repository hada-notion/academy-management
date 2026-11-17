// 학생 페이지 → 접수 안내 스냅샷. 네트워크 없이 읽기만 본다.
function assert(v: unknown, msg = "assertion failed") { if (!v) throw new Error(msg) }
const serve = Deno.serve
;(Deno as any).serve = () => ({})
const { snapshotFromPage } = await import("./index.ts")
;(Deno as any).serve = serve

const page = (relation: unknown) => ({
  properties: {
    "학생이름": { type: "title", title: [{ plain_text: "예시 학생" }] },
    "우선 연락 대상": { type: "select", select: { name: "기타 보호자" } },
    "기타 보호자 연락처": { type: "phone_number", phone_number: "010-0000-0000" },
    "학생과의 관계": relation,
  },
})

Deno.test("guardian relation: 선택 칸(v2.0.0)과 옛 글 칸 둘 다 읽는다", () => {
  assert(snapshotFromPage(page({ type: "select", select: { name: "조부모" } })).guardianRelation === "조부모", "select")
  assert(snapshotFromPage(page({ type: "rich_text", rich_text: [{ plain_text: "이모" }] })).guardianRelation === "이모", "rich_text")
  assert(snapshotFromPage(page({ type: "select", select: null })).guardianRelation === "", "empty select")
})
