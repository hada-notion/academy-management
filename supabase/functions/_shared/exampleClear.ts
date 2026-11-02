// _shared/exampleClear.ts
//
// (v2.8.0) 새 학원 최초 설치 때 한 번 쓰는 "예시 데이터 비우기". 관리자 설정 화면 → clear-example-data 함수 →
// sync_queue("example-clear") → process-sync-queue가 DB 하나씩, 한 번에 최대 BATCH건씩 휴지통으로 보낸다.
// 원본 템플릿을 복제한 학원이 자기 Supabase의 NOTION_TOKEN으로 부르므로 자기 워크스페이스 DB만 보인다.
//
// - 지울 DB·남길 DB는 scripts/clear-example-data.py의 CLEAR_DBS/KEEP_DBS와 같다(exampleClear_test.ts가 대조).
// - 한 번 끝나면 hada_setup_flags(example_clear).state = "done"으로 잠긴다. 이미 쓰고 있던 학원(원본 포함)은
//   마이그레이션 20261102010000이 처음 들어갈 때 "locked"로 잠근다. 다시 열려면 그 행을 SQL로 지운다.
//   원본 리허설처럼 일부 DB를 남길 때는 그 행을 {"state":"error","keep":["업데이트(학원) DB"]}처럼 SQL로 바꿔 연다(keep은 다음 실행에도 이어진다).
// - 마지막에 Supabase 사본(hada_clear_example_copies, scripts/clear-example-data.sql과 같은 표)도 비운다.

import { NOTION_API } from "./constants.ts"
import { archivePage, fetchWithRetry, notionHeaders, queryDataSource } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { enqueueSync, wakeSyncQueueWorker } from "./syncQueue.ts"

export const TARGET_EXAMPLE_CLEAR = "example-clear"

// 하위 데이터부터 지운다(앞에 있는 DB부터). 이름은 Notion DB 제목 그대로.
export const CLEAR_DBS = [
  "루틴 체크(학원) DB",
  "학습활동(학원) DB",
  "학습기록(학원) DB",
  "출석(학원) DB",
  "수업(학원) DB",
  "대시보드(학원) DB",
  "진도교재(학원) DB",
  "보고서(학원) DB",
  "결제(학원) DB",
  "수강료(학원) DB",
  "교재결제(학원) DB",
  "교재배부(학원) DB",
  "교재비(학원) DB",
  "가정통신문(학원) DB",
  "알림톡 발송함(학원) DB",
  "자동화 로그(학원) DB",
  "성적(학원) DB",
  "시험정보(학원) DB",
  "시험(학원) DB",
  "일정(학원) DB",
  "시간표(학원) DB",
  "등록(학원) DB",
  "루틴(학원) DB",
  "클래스(학원) DB",
  "학생(학원) DB",
  "학교(학원) DB",
  "근무(학원) DB",
  "강사(학원) DB",
  "자료(학원) DB",
  "단원목록(학원) DB",
  "라이브러리(학원) DB",
  "교시(학원) DB",
  "업데이트(학원) DB",
  "패치·이슈 관리 DB", // 업데이트(학원) DB의 옛 이름
]

// 남기는 DB: 알림톡 설정·과목과 시스템이 쓰는 메뉴·웹페이지·학년(과목이 학년에 연결됨).
export const KEEP_DBS = [
  "메뉴(학원) DB",
  "웹페이지(학원) DB",
  "알림톡 설정(학원) DB",
  "과목(학원) DB",
  "학년(학원) DB",
]

const OLD_NAME = CLEAR_DBS[CLEAR_DBS.length - 1]
// 한 큐 항목이 지우는 최대 건수. 건마다 PAUSE_MS를 쉬어 Notion 평균 초당 3회 한도 안에 두고, 워커 시간 예산(100초) 안에 끝낸다.
const BATCH = 60
const PAUSE_MS = 350
// 진행 중인데 이 시간 동안 소식이 없으면 멈춘 것으로 보고 다시 시작할 수 있게 한다.
export const STALE_MS = 20 * 60_000

export type PlanItem = { name: string; ds: string }
export type ClearState = {
  state: "running" | "done" | "locked" | "error" | "stopped"
  reason?: string
  workspace?: string
  plan?: PlanItem[]
  total?: number
  done?: number
  current?: string
  passes?: number
  keep?: string[]
  error?: string
  startedAt?: string
  finishedAt?: string
  at?: string
}
export type StatusDb = { name: string; count: number; checked: boolean }
export type ClearStatus = {
  workspace: string
  flag: ClearState | null
  updatedAt: string | null
  dbs: StatusDb[]
  total: number
  keep: string[]
  missing: string[]
  unknown: string[]
  canStart: boolean
}

const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const sbHeaders = () => {
  const key = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
}

export async function readFlag(): Promise<{ value: ClearState | null; updatedAt: string | null }> {
  const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/hada_setup_flags?key=eq.example_clear&select=value,updated_at`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`hada_setup_flags 조회 실패: ${res.status} ${await res.text()}`)
  const rows = await res.json() as { value: ClearState; updated_at: string }[]
  return rows[0] ? { value: rows[0].value, updatedAt: rows[0].updated_at } : { value: null, updatedAt: null }
}

export async function writeFlag(value: ClearState): Promise<void> {
  const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/hada_setup_flags?on_conflict=key`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: "example_clear", value, updated_at: new Date().toISOString() }]),
  })
  if (!res.ok) throw new Error(`hada_setup_flags 저장 실패: ${res.status} ${await res.text()}`)
}

// 진행 중일 때만 바꾼다. 화면에서 [중단]을 누르면 state가 바뀌므로, 처리 중이던 묶음이 끝나도 "진행 중"으로 되돌리지 못하고 멈춘다.
export async function writeIfRunning(value: ClearState): Promise<boolean> {
  const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/hada_setup_flags?key=eq.example_clear&value->>state=eq.running`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ value, updated_at: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`hada_setup_flags 저장 실패: ${res.status} ${await res.text()}`)
  return ((await res.json()) as unknown[]).length > 0
}

// 시작할 수 있는지: 처음이거나, 오류·중단으로 멈췄거나, 진행 중인데 오래 소식이 없을 때만.
export function canStart(flag: ClearState | null, updatedAt: string | null, now = Date.now()): boolean {
  if (!flag) return true
  if (flag.state === "error" || flag.state === "stopped") return true
  if (flag.state === "running") return !updatedAt || now - Date.parse(updatedAt) > STALE_MS
  return false
}

export async function workspaceName(): Promise<string> {
  const res = await fetchWithRetry(`${NOTION_API}/users/me`, { headers: notionHeaders() })
  if (!res.ok) throw new Error(`Notion 연결 확인 실패: ${res.status}`)
  const me = await res.json()
  return me?.bot?.workspace_name ?? ""
}

// 이 통합이 볼 수 있는 데이터 소스(이름 → id 목록). 휴지통에 간 DB는 뺀다.
export async function dataSources(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { filter: { property: "object", value: "data_source" }, page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await fetchWithRetry(`${NOTION_API}/search`, { method: "POST", headers: notionHeaders(), body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`Notion 검색 실패: ${res.status} ${await res.text()}`)
    const data = await res.json()
    for (const r of data.results ?? []) {
      if (r.in_trash || r.archived) continue
      const name = (r.title ?? []).map((t: { plain_text?: string }) => t.plain_text ?? "").join("").trim()
      if (!name) continue
      out.set(name, [...(out.get(name) ?? []), r.id])
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return out
}

// 화면에서 고른 DB만 남긴다. 비울 DB 목록에 없는 이름(남기는 DB 등)은 받지 않는다.
export function selectionKeep(selected: unknown): string[] {
  if (!Array.isArray(selected) || !selected.length) throw new ClearError(400, "비울 DB를 하나 이상 고르세요.")
  const names = selected.map(String)
  const bad = names.filter((n) => !CLEAR_DBS.includes(n))
  if (bad.length) throw new ClearError(400, `비울 수 없는 DB입니다: ${bad.join(", ")}`)
  return CLEAR_DBS.filter((n) => !names.includes(n))
}

export function buildPlan(sources: Map<string, string[]>, keep: string[] = []): { plan: PlanItem[]; missing: string[]; unknown: string[] } {
  const plan: PlanItem[] = []
  const clear = CLEAR_DBS.filter((n) => !keep.includes(n))
  for (const name of clear) for (const ds of sources.get(name) ?? []) plan.push({ name, ds })
  const missing = clear.filter((n) => n !== OLD_NAME && !sources.has(n))
  const unknown = [...sources.keys()].filter((n) => !CLEAR_DBS.includes(n) && !KEEP_DBS.includes(n)).sort()
  return { plan, missing, unknown }
}

async function pageIds(ds: string, limit = Infinity): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await queryDataSource(ds, body)
    for (const r of data.results ?? []) if (!r.in_trash && !r.archived) ids.push(r.id)
    cursor = data.has_more && ids.length < limit ? data.next_cursor : undefined
  } while (cursor)
  return ids.slice(0, limit)
}

export async function status(): Promise<ClearStatus> {
  const [{ value, updatedAt }, workspace, sources] = await Promise.all([readFlag(), workspaceName(), dataSources()])
  // 지난번에 남긴 DB(원본 리허설의 업데이트 DB 등)는 처음부터 체크를 풀어 둔다.
  const keep = value?.keep ?? []
  const { plan, missing, unknown } = buildPlan(sources)
  const counts = new Map<string, number>()
  // 이미 끝났거나 잠긴 뒤에는 세지 않는다(화면은 잠김만 보여 준다).
  if (canStart(value, updatedAt)) {
    for (const p of plan) counts.set(p.name, (counts.get(p.name) ?? 0) + (await pageIds(p.ds)).length)
  }
  const dbs = [...new Set(plan.map((p) => p.name))].map((name) => ({ name, count: counts.get(name) ?? 0, checked: !keep.includes(name) }))
  return {
    workspace, flag: value, updatedAt, dbs, total: dbs.filter((d) => d.checked).reduce((s, d) => s + d.count, 0),
    keep: KEEP_DBS.filter((n) => sources.has(n)), missing, unknown, canStart: canStart(value, updatedAt),
  }
}

export class ClearError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function start(confirmWorkspace: string, selected: unknown): Promise<ClearState> {
  const keep = selectionKeep(selected)
  const { value, updatedAt } = await readFlag()
  if (!canStart(value, updatedAt)) {
    throw new ClearError(409, value?.state === "running" ? "이미 비우는 중입니다." : "이 학원은 이미 예시 데이터를 비웠거나 잠겨 있습니다.")
  }
  const workspace = await workspaceName()
  if (!workspace || confirmWorkspace.trim() !== workspace) throw new ClearError(400, "워크스페이스 이름이 맞지 않습니다. 지우지 않았습니다.")
  const { plan } = buildPlan(await dataSources(), keep)
  let total = 0
  for (const p of plan) total += (await pageIds(p.ds)).length
  const state: ClearState = { state: "running", workspace, keep, plan, total, done: 0, current: plan[0]?.name ?? "", passes: 1, startedAt: new Date().toISOString() }
  await writeFlag(state)
  await enqueueSync(TARGET_EXAMPLE_CLEAR, { step: 0 })
  wakeSyncQueueWorker()
  return state
}

// [중단]: 진행 중이면 stopped로 바꾼다. 처리 중이던 묶음(최대 BATCH건)은 끝까지 지우고 다음 묶음을 넣지 않는다.
export async function stop(): Promise<ClearState | null> {
  const { value } = await readFlag()
  if (!value || value.state !== "running") return value
  const stopped: ClearState = { ...value, state: "stopped", current: "", finishedAt: new Date().toISOString() }
  await writeIfRunning(stopped)
  return (await readFlag()).value
}

async function clearCopies(): Promise<void> {
  const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/rpc/hada_clear_example_copies`, { method: "POST", headers: sbHeaders(), body: "{}" })
  if (!res.ok) throw new Error(`Supabase 사본 비우기 실패: ${res.status} ${await res.text()}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 큐 항목 하나: plan[step]에서 BATCH건을 지우고, 남았으면 같은 단계를, 끝났으면 다음 단계를 다시 넣는다.
// 단계가 끝까지 가면 모든 DB를 다시 세어 남은 것이 있으면 그 단계부터 한 번 더(최대 3바퀴), 없으면 사본을 비우고 잠근다.
export async function processExampleClearItem(payload: Record<string, unknown>): Promise<void> {
  const { value } = await readFlag()
  if (!value || value.state !== "running" || !value.plan) return
  const step = Number(payload.step ?? 0)
  const plan = value.plan
  try {
    if (step < plan.length) {
      const { name, ds } = plan[step]
      const ids = await pageIds(ds, BATCH + 1)
      const batch = ids.slice(0, BATCH)
      let done = value.done ?? 0
      for (let i = 0; i < batch.length; i++) {
        await archivePage(batch[i])
        done++
        await sleep(PAUSE_MS)
        // 20건마다 중단 여부를 본다(누르고 나서 몇 초 안에 멈춘다).
        if (i % 20 === 19 && !(await writeIfRunning({ ...value, done, current: name }))) return
      }
      if (!(await writeIfRunning({ ...value, done, current: name }))) return
      await enqueueSync(TARGET_EXAMPLE_CLEAR, { step: ids.length > BATCH ? step : step + 1 })
      return
    }
    for (let i = 0; i < plan.length; i++) {
      if ((await pageIds(plan[i].ds, 1)).length) {
        if ((value.passes ?? 1) >= 3) throw new Error(`${plan[i].name}에 지우지 못한 페이지가 남았습니다.`)
        if (!(await writeIfRunning({ ...value, passes: (value.passes ?? 1) + 1, current: plan[i].name }))) return
        await enqueueSync(TARGET_EXAMPLE_CLEAR, { step: i })
        return
      }
    }
    if ((await readFlag()).value?.state !== "running") return
    await clearCopies()
    await writeIfRunning({ ...value, state: "done", current: "", finishedAt: new Date().toISOString() })
  } catch (err) {
    await writeIfRunning({ ...value, state: "error", error: String((err as Error)?.message ?? err).slice(0, 300) }).catch(() => {})
    throw err
  }
}
