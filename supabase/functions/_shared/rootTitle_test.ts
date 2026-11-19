// 시스템 타이틀(노션 최상위 페이지 제목) 단위 시험: 부모를 위로 따라 워크스페이스 바로 아래 페이지 제목 · 제목 없음/실패는 null. 가짜 Notion 응답만.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { topPageTitleFrom } = await import("./appCopy.ts")

const tree: Record<string, any> = {
  "data_sources/ds-reg": { parent: { type: "database_id", database_id: "db-reg" } },
  "databases/db-reg": { parent: { type: "page_id", page_id: "pg-menu" } },
  "pages/pg-menu": { parent: { type: "block_id", block_id: "bl-1" }, properties: { title: { type: "title", title: [{ plain_text: "메뉴" }] } } },
  "blocks/bl-1": { parent: { type: "page_id", page_id: "pg-root" } },
  "pages/pg-root": { parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "하다 학원관리 v2.0" }, { plain_text: "(스터디)" }] } } },
  "data_sources/ds-top": { parent: { type: "workspace", workspace: true } },
  "data_sources/ds-empty": { parent: { type: "page_id", page_id: "pg-blank" } },
  "pages/pg-blank": { parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [] } } },
}
const fetcher = (url: string) => Promise.resolve(tree[url.replace("https://api.notion.com/v1/", "")] ?? null)

Deno.test("시스템 타이틀: 등록 DB에서 부모를 위로 따라 맨 위 페이지 제목을 읽음", async () => {
  assertEquals(await topPageTitleFrom("ds-reg", fetcher), "하다 학원관리 v2.0(스터디)")
})
Deno.test("시스템 타이틀: 맨 위에 페이지가 없거나 제목이 비었거나 못 읽으면 null", async () => {
  assertEquals(await topPageTitleFrom("ds-top", fetcher), null)
  assertEquals(await topPageTitleFrom("ds-empty", fetcher), null)
  assertEquals(await topPageTitleFrom("ds-missing", fetcher), null)
})
