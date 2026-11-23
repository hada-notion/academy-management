// _shared/registrationEndNotion.ts — 종료 처리 수업 단계(registrationEnd.ts)가 쓰는 노션 길.
// sync-registration-textbook(cleanup-on-end)과 app-api(end-preview)가 같이 쓴다.
import { todaySeoulDate, queryAllPages, fullRelationIds, updatePageProperties } from "./notionClient.ts"
import { DS_CLASS_SESSION } from "./constants.ts"
import { SESSION_PROP_REG, SESSION_PROP_DATE, type EndDeps } from "./registrationEnd.ts"

export const END_DEPS: EndDeps = {
	today: todaySeoulDate,
	sessionsFrom: (regId, from) => queryAllPages(DS_CLASS_SESSION, {
		and: [
			{ property: SESSION_PROP_REG, relation: { contains: regId } },
			{ property: SESSION_PROP_DATE, date: { on_or_after: from } },
		],
	}),
	relationAll: (page, prop) => fullRelationIds(page, prop),
	patch: async (id, props) => { await updatePageProperties(id, props) },
	log: (m) => console.warn(m),
}
