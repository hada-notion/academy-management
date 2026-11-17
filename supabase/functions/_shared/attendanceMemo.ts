// _shared/attendanceMemo.ts
//
// 출석(학원) DB의 내부용 메모 속성 이름(v2.8.0 항목 62). 원본은 `메모`를 `메모(내부용)`으로 바꿨고(2026-11-14),
// 아직 바꾸지 않은 학원은 `메모` 그대로다. 출석 DB에만 쓴다(학습활동·문의·일정 DB의 `메모`는 그대로).
//  - 읽기: 페이지에 있는 이름(새 이름 먼저, 없으면 예전 이름).
//  - 쓰기·조회: 새 이름으로 보내고, Notion이 그 속성이 없다(400)고 하면 예전 이름으로 다시 보낸다.
//    성공한 이름은 함수 인스턴스 동안 기억해 다음 요청부터 바로 쓴다.

type Page = Record<string, any>

export const ATT_MEMO = ["메모(내부용)", "메모"] as const
export const ATT_MEMO_NEW = ATT_MEMO[0]

let learned: string | null = null

// 테스트용: 기억한 이름을 지운다.
export function resetAttMemoName() {
	learned = null
}

// 페이지(또는 속성 묶음)에 있는 메모 속성 이름. 둘 다 없으면 기억한 이름, 그것도 없으면 새 이름.
export function attMemoKey(pageOrProps: Page | null | undefined): string {
	const props = pageOrProps?.properties ?? pageOrProps
	if (props && typeof props === "object") for (const k of ATT_MEMO) if (props[k] !== undefined) return k
	return learned ?? ATT_MEMO_NEW
}

function missingProp(err: unknown, name: string): boolean {
	const msg = String((err as Error)?.message ?? err)
	return /\b400\b/.test(msg) && msg.includes(name)
}

// 이름을 받아 Notion 요청을 보내는 run을 새 이름(또는 기억한 이름)으로 부르고, 그 속성이 없다는 400이면 다른 이름으로 한 번 더.
export async function withAttMemoName<T>(run: (name: string) => Promise<T>): Promise<T> {
	const first = learned ?? ATT_MEMO_NEW
	try {
		const out = await run(first)
		learned = first
		return out
	} catch (err) {
		if (!missingProp(err, first)) throw err
		const other = ATT_MEMO.find((n) => n !== first)!
		const out = await run(other)
		learned = other
		return out
	}
}
