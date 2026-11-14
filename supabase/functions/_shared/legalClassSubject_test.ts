import { assertEquals } from "jsr:@std/assert@1"
import { legalClassSubject } from "./legalClassSubject.ts"

const titlePage = (id: string, name: string) => ({ id, properties: { "영역명": { type: "title", title: [{ plain_text: name }] } } })
const areas: Record<string, any> = { a1: titlePage("a1", "수학"), a2: titlePage("a2", "영어") }

function fakeCache() {
  const calls: string[] = []
  const cache = new Map<string, Promise<any>>()
  const get = (id: string) => {
    if (!cache.has(id)) {
      calls.push(id)
      cache.set(id, areas[id] ? Promise.resolve(areas[id]) : Promise.reject(new Error("404")))
    }
    return cache.get(id)!
  }
  return { get, calls }
}

const multi = (...names: string[]) => ({ type: "multi_select", multi_select: names.map((name) => ({ name })) })
const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })) })

Deno.test("새 구조: 클래스 영역 관계의 영역 제목을 ', '로 잇고, 같은 영역은 캐시로 한 번만 읽는다", async () => {
  const c = fakeCache()
  assertEquals(await legalClassSubject({ properties: { "영역": rel("a1", "a2") } }, c.get), "수학, 영어")
  assertEquals(await legalClassSubject({ properties: { "영역": rel("a1") } }, c.get), "수학")
  assertEquals(c.calls, ["a1", "a2"])
})

Deno.test("새 구조가 옛 과목 다중 선택보다 먼저다(옮기는 중 둘 다 있을 때)", async () => {
  assertEquals(await legalClassSubject({ properties: { "영역": rel("a2"), "과목": multi("국어") } }, fakeCache().get), "영어")
})

Deno.test("옛 구조: 영역 관계가 없으면 과목 다중 선택 이름을 쓴다", async () => {
  const c = fakeCache()
  assertEquals(await legalClassSubject({ properties: { "과목": multi("국어", "수학") } }, c.get), "국어, 수학")
  assertEquals(c.calls, [])
})

Deno.test("영역 관계가 비었거나 영역 페이지를 읽지 못하면 옛 과목으로, 둘 다 없으면 빈 값", async () => {
  assertEquals(await legalClassSubject({ properties: { "영역": rel(), "과목": multi("과학") } }, fakeCache().get), "과학")
  assertEquals(await legalClassSubject({ properties: { "영역": rel("gone"), "과목": multi("과학") } }, fakeCache().get), "과학")
  assertEquals(await legalClassSubject({ properties: { "영역": rel("gone", "a1") } }, fakeCache().get), "수학")
  assertEquals(await legalClassSubject({ properties: {} }, fakeCache().get), "")
  assertEquals(await legalClassSubject(null, fakeCache().get), "")
})
