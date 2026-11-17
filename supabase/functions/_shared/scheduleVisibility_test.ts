import { isParentPublicEvent, publicNoticeFields, noticeReportSyncNotNeeded, NOTICE_VISIBILITY_POLICY } from "./scheduleVisibility.ts"
import { buildStudentNotices, clearNoticeCache, noticeDeps, withFreshNotices } from "./reportCacheBuilder.ts"
function assert(v: unknown, msg = "assertion failed") { if (!v) throw new Error(msg) }
function event(hidden: unknown = false, published: unknown = true, category = "📆 학원 일정"): any {
 return {id:"event", properties:{"숨김":{type:"checkbox",checkbox:hidden},"학부모 공개":{type:"checkbox",checkbox:published},"구분":{type:"select",select:{name:category}},"날짜":{type:"date",date:{start:new Date().toISOString().slice(0,10)}},"이름":{type:"title",title:[{plain_text:"공개 행사"}]}}}
}
for (const hidden of [false,true]) for (const published of [false,true]) Deno.test(`숨김=${hidden}/공개=${published}`,()=>assert(isParentPublicEvent(event(hidden,published)) === (!hidden&&published)))
Deno.test("공개/숨김 누락과 잘못된 값은 비공개",()=>{
 for(const v of [undefined,null,"true",1]) {const e=event();e.properties["학부모 공개"].checkbox=v;assert(!isParentPublicEvent(e))}
 for(const v of [undefined,null,"false",0]) {const e=event();e.properties["숨김"].checkbox=v;assert(!isParentPublicEvent(e))}
 assert(!isParentPublicEvent({properties:{}}))
})
Deno.test("할일/미지정 구분은 공개하지 않음",()=>{for(const c of ["✅ 할일","","내부 일정"]) assert(!isParentPublicEvent(event(false,true,c)))})
Deno.test("학원/학교(새 세 값·옛 학사)/휴원은 공개 조건 적용",()=>{for(const c of ["📆 학원 일정","🏫 학교 행사","📝 시험","🏖️ 방학/휴교","🏫 학사 일정","💤 휴원"]) assert(isParentPublicEvent(event(false,true,c)))})
Deno.test("삭제/아카이브 일정은 비공개",()=>{for(const k of ["archived","in_trash"]) assert(!isParentPublicEvent({...event(),[k]:true}))})
Deno.test("기존 캐시 일정 제거/다른 학생 필드 유지",()=>{const f=publicNoticeFields({student_name:"가상학생",notices:[{title:"직원회의"}]});assert(JSON.stringify(f.notices)==="[]");assert(f.student_name==="가상학생")})
Deno.test("정책 확인된 캐시는 일정 보존/내부 정책값 비노출",()=>{const notices=[{title:"설명회"}];const f=publicNoticeFields({notice_visibility_policy:NOTICE_VISIBILITY_POLICY,notices});assert(f.notices===notices);assert(!("notice_visibility_policy" in f));assert(JSON.stringify(publicNoticeFields({notice_visibility_policy:NOTICE_VISIBILITY_POLICY,notices:null}).notices)==="[]")})
function rel(ids:string[]) {return {type:"relation",relation:ids.map(id=>({id}))}}
// 일정은 연결 기준마다 일정 DB를 조회한다(v2.8.0). 가짜 조회는 관계만 맞추고, 공개·숨김·날짜는 buildStudentNotices가 다시 거른다.
let nextStudent = 0
async function noticesFor(pages:Record<string,any>, props:any, studentId = `student-${++nextStudent}`) {
 const events = Object.values(pages).filter((p:any)=>p?.properties?.["구분"])
 clearNoticeCache()
 noticeDeps.query = (async (_ds:string, filter:any) => {
  const rel = filter.and.find((f:any)=>f.relation)
  if (!rel) return events.filter((e:any)=>["클래스","학생","학교","학년"].every(k=>!(e.properties[k]?.relation?.length)))
  return events.filter((e:any)=>(e.properties[rel.property]?.relation ?? []).some((x:any)=>x.id===rel.relation.contains))
 }) as any
 return await buildStudentNotices(studentId,props,async id=>{assert(!!pages[id],id);return pages[id]})
}
Deno.test("학생 직접 연결도 숨김/공개 조건을 우회하지 않음",async()=>{
 const good=event();good.id="good";const staff=event(false,false);staff.id="staff";const hidden=event(true,true);hidden.id="hidden"
 for (const e of [good,staff,hidden]) e.properties["학생"]=rel(["s1"])
 const n=await noticesFor({good,staff,hidden},{"학원일정":rel(["good","staff","hidden"])},"s1");assert(n.length===1)
})
Deno.test("학교/학년 관련성 조건 유지",async()=>{
 const good=event();good.id="good";good.properties["학교"]=rel(["school"]);good.properties["학년"]=rel(["grade"])
 const other=event();other.id="other";other.properties["학교"]=rel(["school"]);other.properties["학년"]=rel(["other-grade"])
 const n=await noticesFor({good,other},{"학교":rel(["school"]),"학년":rel(["grade"])});assert(n.length===1)
})
Deno.test("클래스 직접 연결 비공개도 제외",async()=>{
 const staff=event(false,false);staff.id="staff";staff.properties["클래스"]=rel(["class"]);const n=await noticesFor({staff,reg:{properties:{"수강상태":{type:"status",status:{name:"수강 중"}},"클래스":rel(["class"])}},class:{properties:{"일정":rel(["staff"])}}},{"등록":rel(["reg"])});assert(n.length===0)
})
Deno.test("날짜 누락 일정 제외",async()=>{const e=event();e.properties["학생"]=rel(["s2"]);delete e.properties["날짜"];assert((await noticesFor({event:e},{"학원일정":rel(["event"])},"s2")).length===0)})
Deno.test("학교 일정이 많아도 학교 페이지 관계(25개 제한)를 읽지 않고 조회로 모두 싣는다",async()=>{
 const pages:Record<string,any>={}
 for(let i=0;i<40;i++){const e=event(false,true,"🏫 학사 일정");e.id=`e${i}`;e.properties["학교"]=rel(["school"]);pages[e.id]=e}
 const n=await noticesFor(pages,{"학교":rel(["school"])});assert(n.length===40,String(n.length))
})
Deno.test("학원 전체 일정(연결 없음)은 모든 학생에게, 다른 반 일정은 제외",async()=>{
 const all=event();all.id="all";const other=event();other.id="other";other.properties["클래스"]=rel(["other-class"])
 const n=await noticesFor({all,other},{});assert(n.length===1&&n[0].title==="공개 행사")
})

Deno.test("리포트 반영 건너뜀: 비공개 나이스 일정 + 마지막 편집 봇일 때만",()=>{
 const neis=(hidden:boolean,published:boolean,editor:string,key="NEIS-1")=>{const e=event(hidden,published,"🏫 학교 행사");e.properties["NEIS 동기화키"]={type:"rich_text",rich_text:key?[{plain_text:key}]:[]};e.last_edited_by={object:"user",id:editor};return e}
 // 나이스가 새로 만든 줄(숨김·비공개, 봇) → 건너뜀
 assert(noticeReportSyncNotNeeded(neis(true,false,"bot"),"bot"))
 assert(noticeReportSyncNotNeeded(neis(false,false,"bot"),"bot"))
 // 공개 중이면 반영(내용이 바뀌었을 수 있음)
 assert(!noticeReportSyncNotNeeded(neis(false,true,"bot"),"bot"))
 // 사람이 공개를 끈 편집은 반영(리포트에서 빼야 함)
 assert(!noticeReportSyncNotNeeded(neis(true,false,"person"),"bot"))
 // 나이스 일정이 아니면(학원 일정 등) 반영
 assert(!noticeReportSyncNotNeeded(neis(true,false,"bot",""),"bot"))
 // 봇 ID를 모르면 반영(안전한 쪽)
 assert(!noticeReportSyncNotNeeded(neis(true,false,"bot"),null))
 // 일정이 아닌 페이지는 건드리지 않음
 assert(!noticeReportSyncNotNeeded({properties:{"토큰":{type:"rich_text",rich_text:[]}},last_edited_by:{id:"bot"}},"bot"))
})

Deno.test("학부모 응답에는 notice_ids(일정 페이지 id)를 싣지 않음",()=>{
 const f=publicNoticeFields({notice_visibility_policy:NOTICE_VISIBILITY_POLICY,notices:[{title:"a"}],notice_ids:["id-1"],student_name:"가상학생"})
 assert(!("notice_ids" in f) && (f.notices as any[]).length===1)
})

Deno.test("대상을 A → B로 바꾼 직후 조회가 옛 결과(A)를 돌려줘도 A 리포트엔 싣지 않음(지금 관계로 다시 봄)",async()=>{
 const moved=event();moved.id="moved";moved.properties["학생"]=rel(["B"])
 clearNoticeCache()
 // 조회는 바뀌기 전처럼 "학생 contains A"에 이 일정을 돌려준다(Notion 색인 늦음 흉내)
 noticeDeps.query=(async(_ds:string,filter:any)=>{const r=filter.and.find((f:any)=>f.relation);return r&&r.property==="학생"&&r.relation.contains==="A"?[moved]:[]}) as any
 const n=await buildStudentNotices("A",{},async id=>({id,properties:{}}))
 assert(n.length===0,JSON.stringify(n))
})

Deno.test("조회가 바뀌기 전 속성까지 돌려줘도, 방금 바뀐 일정 값(웹훅 본문)으로 A에서 빼고 B에 싣는다",async()=>{
 const stale=event();stale.id="moved";stale.properties["학생"]=rel(["A"])      // 조회가 주는 옛 모습
 const fresh=event();fresh.id="moved";fresh.properties["학생"]=rel(["B"])      // 웹훅 본문의 새 모습
 clearNoticeCache()
 noticeDeps.query=(async(_ds:string,filter:any)=>{const r=filter.and.find((f:any)=>f.relation);return r&&r.property==="학생"&&r.relation.contains==="A"?[stale]:[]}) as any
 const getA=withFreshNotices(async (id:string)=>({id,properties:{}}),[fresh])
 assert((await buildStudentNotices("A",{},getA)).length===0)
 clearNoticeCache()
 const getB=withFreshNotices(async (id:string)=>({id,properties:{}}),[fresh])
 assert((await buildStudentNotices("B",{},getB)).length===1)
})
