// _shared/propAlias.ts
//
// 메모 칸 이름 규칙(v2.8.0 항목 64): 알림톡으로 나가는 칸 = "○○ 안내 메모", 학부모 보고서에 보이는 칸 = "선생님 한마디",
// 내부용 = "메모(내부용)". 원본은 2026-11-15에 이름을 바꾸고, 아직 바꾸지 않은 학원은 예전 이름 그대로다.
// 서버는 두 이름을 모두 알아본다(새 이름 먼저).
//  - 읽기: 페이지에 있는 이름.
//  - 페이지 없이 쓰기: 새 이름으로 보내고, Notion이 그 속성이 없다(400)고 하면 예전 이름으로 다시 보낸다(이름을 기억).
// 출석 `메모(내부용)`(항목 62)은 attendanceMemo.ts가 따로 맡는다.

type Page = Record<string, any>

export const REG_NOTICE_MEMO = ["등록 안내 메모", "안내 메모"] as const // 등록(학원) DB: 등록·클래스 변경·시간표 변경 안내 전달사항
export const LETTER_NOTICE_MEMO = ["가정통신문 안내 메모", "가정통신문 전달사항"] as const // 알림톡 발송함(학원) DB
export const EVENT_NOTICE_MEMO = ["일정 안내 메모", "메모"] as const // 일정(학원) DB: 일정 안내 전달사항·학부모 리포트 공개 일정
export const ACTIVITY_MEMO = ["메모(내부용)", "메모"] as const // 학습활동(학원) DB: 선생님용

// 페이지(또는 속성 묶음)에 있는 이름. 둘 다 없으면 새 이름.
export function propKey(pageOrProps: Page | null | undefined, names: readonly string[]): string {
	const props = pageOrProps?.properties ?? pageOrProps
	if (props && typeof props === "object") for (const k of names) if (props[k] !== undefined) return k
	return names[0]
}

// 그 칸의 rich_text 배열(없으면 빈 배열).
export function propRich(pageOrProps: Page | null | undefined, names: readonly string[]): any[] {
	const props = pageOrProps?.properties ?? pageOrProps
	return (props?.[propKey(props, names)]?.rich_text ?? []) as any[]
}

function missingProp(err: unknown, name: string): boolean {
	const msg = String((err as Error)?.message ?? err)
	return /\b400\b/.test(msg) && msg.includes(name)
}

// 페이지 없이 쓸 때: 새 이름(또는 기억한 이름)으로 run, 그 속성이 없다는 400이면 다른 이름으로 한 번 더.
export function nameLearner(names: readonly string[]) {
	let learned: string | null = null
	return {
		reset() { learned = null },
		async run<T>(fn: (name: string) => Promise<T>): Promise<T> {
			const first = learned ?? names[0]
			try {
				const out = await fn(first)
				learned = first
				return out
			} catch (err) {
				if (!missingProp(err, first)) throw err
				const other = names.find((n) => n !== first)!
				const out = await fn(other)
				learned = other
				return out
			}
		},
	}
}
