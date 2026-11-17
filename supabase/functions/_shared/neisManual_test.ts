import { academicRange, sameOwnedEvent,retryDelayMs, buttonSchoolId } from "./neisManual.ts"
import { ownedProperties, type NeisRow } from "./neisSchool.ts"
function assert(v: unknown,message="assertion failed"){if(!v)throw new Error(message)}
Deno.test("한국시간 3월 1일에 학년도 전환",()=>{
 assert(academicRange(new Date("2027-02-28T14:59:59Z")).year===2026)
 assert(academicRange(new Date("2027-02-28T15:00:00Z")).year===2027)
})
Deno.test("한 학년도 전체와 윤년 2월 포함",()=>{
 const a=academicRange(new Date("2026-10-03T00:00:00Z"));assert(a.from==="20260301"&&a.to==="20270228")
 const leap=academicRange(new Date("2027-10-03T00:00:00Z"));assert(leap.to==="20280229")
})
Deno.test("잘못된 학년도 거부",()=>{
 for(const y of ["NaN",2026.5,1999,9999]){let failed=false;try{academicRange(new Date("2026-10-03T00:00:00Z"),y)}catch{failed=true}assert(failed)}
})
Deno.test("Notion 버튼 본문 data.id와 직접 pageId 지원",()=>{
 const id="3eeba040-586b-8054-8fc7-d2648030298d"
 assert(buttonSchoolId({data:{object:"page",id}})===id.replaceAll("-", ""))
 assert(buttonSchoolId({pageId:id})===id.replaceAll("-", ""))
 assert(buttonSchoolId({source:{type:"automation",automation_id:id},data:{}})===null)
})
Deno.test("숨김/메모를 바꿔도 원본 동기화 내용은 동일",()=>{
 const row:NeisRow={AA_YMD:"20261002",EVENT_NM:"중간고사",EVENT_CNTNT:"",SBTR_DD_SC_NM:"해당없음",TW_GRADE_EVENT_YN:"Y"}
 const properties:any=ownedProperties(row,"school","key",["g2"])
 const page={properties:{...properties,"숨김":{checkbox:false},"학부모 공개":{checkbox:true},"메모":{rich_text:[{plain_text:"수동 메모"}]}}}
 assert(sameOwnedEvent(page,row,"school","key",["g2"]))
 assert(!sameOwnedEvent(page,{...row,EVENT_CNTNT:"새 내용"},"school","key",["g2"]))
 assert(!sameOwnedEvent(page,row,"school","key",["g3"]))
})

Deno.test("사람이 고친 구분은 다시 가져와도 그대로(같은 일정으로 보고 쓰지 않음)",()=>{
 const row:NeisRow={AA_YMD:"20261002",EVENT_NM:"중간고사",EVENT_CNTNT:"",SBTR_DD_SC_NM:"해당없음",TW_GRADE_EVENT_YN:"Y"}
 const properties:any=ownedProperties(row,"school","key",["g2"])
 assert(!("구분" in properties))
 for(const cat of ["🏫 학교 행사","🏫 학사 일정","📆 학원 일정"]){
  const page={properties:{...properties,"구분":{select:{name:cat}},"잠금":{checkbox:false}}}
  assert(sameOwnedEvent(page,row,"school","key",["g2"]),cat)
 }
})

Deno.test("노션 한도(429)면 길게 기다렸다 이어서, 그 밖은 짧게",()=>{
 assert(retryDelayMs("Notion API 오류 429",1)===10000)
 assert(retryDelayMs("data_sources query 429 Too Many Requests",2)===20000)
 assert(retryDelayMs("Notion API 오류 429",5)===20000)
 assert(retryDelayMs("학년 중복: 2",1)===1500)
 assert(retryDelayMs("Notion API 오류 4290",1)===1500)
})
