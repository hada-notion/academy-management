import { assertEquals, assertRejects } from "jsr:@std/assert@1"
import { ACTIVITY_MEMO, EVENT_NOTICE_MEMO, LETTER_NOTICE_MEMO, nameLearner, propKey, propRich, REG_NOTICE_MEMO } from "./propAlias.ts"

const rt = (s: string) => ({ rich_text: [{ plain_text: s }] })

Deno.test("propKey: 새 이름이 있으면 새 이름, 예전 이름만 있으면 예전 이름, 둘 다 없으면 새 이름", () => {
	assertEquals(propKey({ properties: { "등록 안내 메모": rt("a") } }, REG_NOTICE_MEMO), "등록 안내 메모")
	assertEquals(propKey({ properties: { "안내 메모": rt("a") } }, REG_NOTICE_MEMO), "안내 메모")
	assertEquals(propKey({ "가정통신문 전달사항": rt("a") }, LETTER_NOTICE_MEMO), "가정통신문 전달사항")
	assertEquals(propKey({ properties: {} }, EVENT_NOTICE_MEMO), "일정 안내 메모")
	assertEquals(propKey(null, ACTIVITY_MEMO), "메모(내부용)")
})

Deno.test("propRich: 있는 이름의 글을 읽는다", () => {
	assertEquals(propRich({ properties: { "메모": rt("옛") } }, EVENT_NOTICE_MEMO), [{ plain_text: "옛" }])
	assertEquals(propRich({ properties: { "일정 안내 메모": rt("새"), "메모": rt("옛") } }, EVENT_NOTICE_MEMO), [{ plain_text: "새" }])
	assertEquals(propRich({ properties: {} }, EVENT_NOTICE_MEMO), [])
})

Deno.test("nameLearner: 새 이름이 없다는 400이면 예전 이름으로 다시, 그 뒤로는 예전 이름부터", async () => {
	const l = nameLearner(ACTIVITY_MEMO)
	const tried: string[] = []
	const run = (name: string) => { tried.push(name); if (name === "메모(내부용)") return Promise.reject(new Error(`Notion 400: 메모(내부용) is not a property that exists.`)); return Promise.resolve(name) }
	assertEquals(await l.run(run), "메모")
	assertEquals(await l.run(run), "메모")
	assertEquals(tried, ["메모(내부용)", "메모", "메모"])
	await assertRejects(() => nameLearner(ACTIVITY_MEMO).run(() => Promise.reject(new Error("Notion 500"))))
})
