// 법정 서류의 교습과목: 클래스(학원) DB에서 읽는다.
// - 새 구조: 관계 "영역" -> 영역(학원) DB. 연결된 영역 페이지들의 제목을 ", "로 잇는다.
// - 옛 구조: 다중 선택 "과목"(국어/영어/수학/과학). Notion을 올리기 전 학원은 이것만 있다.
// 영역 관계가 없거나 비었거나 제목을 하나도 읽지 못하면 옛 "과목" 다중 선택으로 돌아간다.
// 영역 페이지는 호출하는 쪽의 페이지 캐시(getCachedPage)로 읽어, 같은 영역을 반마다 다시 부르지 않는다.

export const PROP_CLASS_AREA = "영역" // relation -> 영역(학원) DB
export const PROP_CLASS_SUBJECT_OLD = "과목" // multi_select (옛 구조)

function titleOfPage(page: any): string {
  const props = page?.properties ?? {}
  for (const key in props) {
    if (props[key]?.type === "title") return (props[key].title ?? []).map((t: any) => t?.plain_text ?? "").join("").trim()
  }
  return ""
}

function oldSubject(page: any): string {
  return (page?.properties?.[PROP_CLASS_SUBJECT_OLD]?.multi_select ?? []).map((v: any) => v?.name ?? "").filter(Boolean).join(", ")
}

export async function legalClassSubject(page: any, getCachedPage: (id: string) => Promise<any>): Promise<string> {
  const area = page?.properties?.[PROP_CLASS_AREA]
  const ids: string[] = Array.isArray(area?.relation) ? area.relation.map((r: any) => r?.id).filter(Boolean) : []
  if (ids.length) {
    const titles = await Promise.all(ids.map((id) => getCachedPage(id).then(titleOfPage, () => "")))
    const names = titles.filter(Boolean)
    if (names.length) return names.join(", ")
  }
  return oldSubject(page)
}
