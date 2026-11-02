import { assert, assertEquals } from "jsr:@std/assert@1"
import { buildPlan, canStart, CLEAR_DBS, KEEP_DBS, STALE_MS } from "./exampleClear.ts"

// scripts/clear-example-data.py의 목록과 같아야 한다(PC 스크립트와 화면이 같은 DB를 지운다).
function pyList(src: string, name: string): string[] {
  const block = src.split(`${name} = [`)[1].split("\n]")[0]
  return [...block.matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1])
}

Deno.test("지울·남길 DB 목록이 PC 스크립트와 같다", async () => {
  const src = await Deno.readTextFile(new URL("../../../scripts/clear-example-data.py", import.meta.url))
  assertEquals(CLEAR_DBS, pyList(src, "CLEAR_DBS"))
  assertEquals(KEEP_DBS, pyList(src, "KEEP_DBS"))
})

Deno.test("남기는 DB는 알림톡 설정·과목과 시스템용 메뉴·웹페이지·학년뿐", () => {
  assertEquals([...KEEP_DBS].sort(), ["과목(학원) DB", "메뉴(학원) DB", "알림톡 설정(학원) DB", "웹페이지(학원) DB", "학년(학원) DB"].sort())
  for (const n of KEEP_DBS) assert(!CLEAR_DBS.includes(n))
})

Deno.test("계획은 지울 순서대로, 남길 DB·모르는 DB는 넣지 않는다", () => {
  const sources = new Map([
    ["학생(학원) DB", ["s"]], ["출석(학원) DB", ["a"]], ["과목(학원) DB", ["k"]], ["🔑 키 발급 매뉴얼", ["x"]],
  ])
  const { plan, missing, unknown } = buildPlan(sources)
  assertEquals(plan, [{ name: "출석(학원) DB", ds: "a" }, { name: "학생(학원) DB", ds: "s" }])
  assertEquals(unknown, ["🔑 키 발급 매뉴얼"])
  assert(missing.includes("수업(학원) DB"))
  assert(!missing.includes("패치·이슈 관리 DB")) // 옛 이름은 없어도 된다
})

Deno.test("시작은 처음·오류·오래 멈춘 진행에서만", () => {
  const now = Date.parse("2026-11-02T12:00:00Z")
  assert(canStart(null, null, now))
  assert(canStart({ state: "error" }, "2026-11-02T11:59:00Z", now))
  assert(!canStart({ state: "done" }, "2026-11-02T11:00:00Z", now))
  assert(!canStart({ state: "locked" }, "2026-11-02T11:00:00Z", now))
  assert(!canStart({ state: "running" }, new Date(now - 60_000).toISOString(), now))
  assert(canStart({ state: "running" }, new Date(now - STALE_MS - 1).toISOString(), now))
})
