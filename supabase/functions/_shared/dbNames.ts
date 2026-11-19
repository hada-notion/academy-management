// 관 꼬리표(v2.8.0 항목 102, 261119 — 한 학원에 관이 둘일 때 같은 Notion 검색에서 DB를 구분하려고 DB 이름 끝의 "(학원)"을 관 이름으로 바꾼다).
// 예: "학생(스터디) DB" · "학생(스타트) DB". 서버는 DB를 이름 글자로 찾으므로, 이름의 마지막 괄호 안 글자가 무엇이든 "(학원)"으로 보고 비교한다.
// 이미 "(학원)"인 이름과 괄호가 없는 이름은 그대로. 같은 이름이 여러 관에 있을 때 이 학원 것 하나로 좁히는 규칙(Secrets id → 기준 DB 상위 페이지)은 그대로 쓴다.

// "XXX(관이름) DB" → "XXX(학원) DB". 이름 끝이 "(괄호) DB"가 아니면 그대로.
export const normalizeDbName = (name: string): string => String(name ?? "").replace(/\(([^()]*)\)(\s*DB)\s*$/i, "(학원)$2")

// 공백 · 끝의 "DB"를 뗀 이름(웹훅 체크리스트 링크 키: "학생(학원)")의 관 꼬리표를 "(학원)"으로: "학생(스터디)" → "학생(학원)".
export const normalizeBareDbTitle = (title: string): string => String(title ?? "").replace(/\(([^()]*)\)\s*$/, "(학원)")
