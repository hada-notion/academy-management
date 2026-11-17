/* 모듈 시안용 예시 데이터(시제품 예시와 같은 이름·가짜 번호 없음) */
HP.today="2026-11-13";
const DEMO={classes:[
 {id:"c1",when:"월·수 16:00",name:"중1 수학",color:"#B794F6",teacher:"이하다",count:7,recent:true},
 {id:"c2",when:"월·수·금 16:00",name:"중2 수학A",color:"#7FA6D9",teacher:"이하다",count:8,recent:true},
 {id:"c3",when:"화·목 18:00",name:"중2 영어B",color:"#5BBF8A",teacher:"김하다",count:7,recent:true},
 {id:"c4",when:"화·목 19:00",name:"중3 영어",color:"#F0A35E",teacher:"김하다",count:13,close:"2026-12-19"},
 {id:"c5",when:"월·수·금 19:00",name:"고1 수학",color:"#E5484D",teacher:"최하다",count:6},
 {id:"c6",when:"화 17:00",name:"고1 수학 1:1",color:"#E8C547",teacher:"최하다",count:2},
 {id:"c7",when:"화·목 17:00",name:"고2 국어",color:"#B08D6E",teacher:"박하다",count:6},
 {id:"c8",when:"월·수·금 14:30",name:"초등 영어",color:"#E88FB5",teacher:"정하다",count:12},
 {id:"c9",when:"월·수 10:00",name:"겨울 특강 문법",color:"#6FB7C9",teacher:"김하다",count:0,kind:"특강",open:"2026-12-22"},
 {id:"c10",when:"화·목 14:00",name:"2025 여름 문법 특강",color:"#A3A3A3",teacher:"김하다",count:0,close:"2025-08-29"},
 {id:"c11",when:"토 10:00",name:"중등 과학",color:"#9CC7A4",teacher:"박하다",count:0,close:"2026-07-31"}],
 students:[["s1","장예린","하다고","고3"],["s2","신은우","바다초","초1"],["s3","류현우","하다고","고2"],["s4","류다은","바다초","초2"],["s5","신지안","바다초","초1"],["s6","안하은","푸른중","중1"],["s7","조채원","푸른중","중2"],["s8","김다은","푸른중",""],["s9","장지우","푸른중","중2"],["s10","조윤서","하다고","고1"],["s11","장채원","바다초","초2"],["s12","오채원","바다초","초1"],["s13","황도윤","푸른중","중2"],["s14","이우진","하다고","고3"],["s15","김현우","바다초","초4"],["s16","권유준","푸른중","중2"],["s17","최하린","하다고","고1"],["s18","권예린","하다고","고1"],["s19","한다은","푸른중","중3"],["s20","서유준","하다중","중2"]].map(([id,name,school,grade])=>({id,name,school,grade}))};
// 등록 클래스(학생 줄 둘째 줄 회색). 없는 학생은 "클래스 없음"
Object.entries({s1:"중1 수학 · 중3 영어",s2:"중2 수학A",s3:"중2 영어B",s4:"중3 영어 · 고1 수학 1:1",s5:"고1 수학 · 초등 영어",s6:"고2 국어",s9:"중1 수학",s10:"고1 수학",s13:"중2 수학A",s14:"고2 국어",s15:"초등 영어",s16:"중2 영어B",s11:"중2 영어B",s7:"고2 국어",s17:"고1 수학",s18:"고1 수학",s19:"중3 영어",s20:"중2 수학A"}).forEach(([id,c])=>{DEMO.students.find(x=>x.id===id).cls=c});

HP.colors=Object.fromEntries(DEMO.classes.map(c=>[c.name,c.color]));
