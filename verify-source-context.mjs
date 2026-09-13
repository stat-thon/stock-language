import assert from 'node:assert/strict';
import {validateDataset} from './validate-data.mjs';

// All values below are synthetic. This test never reads, edits or fetches collected posts.
const source={label:'검증용 가상 출처',url:'https://example.com/reference'};
const baseCase={
  id:'fixture-a',stock:'000001',title:'검증용 첫 학습 논점',category:'검증',claimType:'가상 의견',
  publishedAt:'가상 게시시각',collectedAt:'가상 수집일',sourceLabel:'검증용 가상 커뮤니티',
  excerpt:'첫 번째 가상 문장에서 PER를 읽습니다.',
  explanation:'검증용으로 만든 해석입니다.',reason:'논점 분리 검증입니다.',caution:'실제 게시물이 아닙니다.',sourceNote:'검증용 개별 글 주소입니다.',
  sourceUrl:'https://www.tossinvest.com/community/posts/999001',terms:['fixture-per'],
  checks:[{question:'검증용 질문인가요?',detail:'가상 데이터임을 확인합니다.'}],
  postSummary:'원문 맥락 표시를 검증하기 위해 만든 가상 요약입니다.',
  sourceAuthor:'검증용 작성자',sourceShareUrl:'https://www.tossinvest.com/community/posts/999001?share=test',sourceVerifiedAt:'가상 확인일',samePostGroup:'fixture-shared-post',
};
const fixture={
  cases:[baseCase,{...baseCase,id:'fixture-b',title:'검증용 두 번째 학습 논점',excerpt:'다른 가상 문장에서 가격의 의미를 읽습니다.'}],
  glossary:[{id:'fixture-per',name:'PER',category:'검증',level:'기초',aliases:[],definition:'검증용 정의',example:'검증용 가상 예문',pitfall:'검증용 오해',check:'검증용 질문',sources:[source]}],
  meta:{collectedAt:'가상 수집일',method:'가상 검증 데이터',apiStatus:'네트워크 없음',selectionNote:'실제 글을 포함하지 않습니다.',limitations:['가상 데이터입니다.'],sources:[source],stocks:[{code:'000001',name:'가상 종목',sector:'검증'}]},
};
let passed=0;
function check(name,change,expectedError) {
  const data=structuredClone(fixture);change?.(data);
  const result=validateDataset(data);
  if(expectedError) {assert.equal(result.ok,false,`${name}: 거절되어야 합니다.`);assert(result.errors.some(e=>expectedError.test(e)),`${name}: 예상한 검증 오류가 없습니다.\n${result.errors.join('\n')}`);}
  else assert.equal(result.ok,true,`${name}: ${result.errors.join('\n')}`);
  passed++;console.log(`PASS ${name}`);
}

check('동일 원글의 명시된 두 학습 논점 허용');
check('전체 확인과 공개된 부분 확인 범위 허용',d=>{d.cases[0].postSummaryScope='full';d.cases[1].postSummaryScope='partial';});
check('개별 URL과 post 쿼리가 같은 게시물이면 함께 합산',d=>{d.cases[1].sourceUrl='https://www.tossinvest.com/stocks/A000001/community?post=999001&utm_source=test';});
check('그룹 표시 없는 중복은 거절',d=>{for(const c of d.cases)delete c.samePostGroup;},/sourceUrl.*samePostGroup/);
check('한 사례에만 그룹이 있으면 거절',d=>{delete d.cases[1].samePostGroup;},/sourceUrl.*samePostGroup/);
check('서로 다른 그룹의 중복은 거절',d=>{d.cases[1].samePostGroup='another-post';},/sourceUrl.*samePostGroup/);
check('세 번째 사례도 같은 그룹을 명시해야 함',d=>{d.cases.push({...baseCase,id:'fixture-c',excerpt:'세 번째 가상 논점',samePostGroup:undefined});},/sourceUrl.*samePostGroup/);
check('그룹이 있어도 같은 발췌 중복은 거절',d=>{d.cases[1].excerpt=d.cases[0].excerpt;},/excerpt.*발췌 중복/);
check('같은 원문 합산 25단어는 허용',d=>{d.cases[0].excerpt=Array.from({length:12},(_,i)=>`first${i}`).join(' ');d.cases[1].excerpt=Array.from({length:13},(_,i)=>`second${i}`).join(' ');});
check('개별 발췌는 짧아도 합산 26단어는 거절',d=>{d.cases[0].excerpt=Array.from({length:13},(_,i)=>`first${i}`).join(' ');d.cases[1].excerpt=Array.from({length:13},(_,i)=>`second${i}`).join(' ');},/동일 원문.*26단어/);
check('URL 표현이 달라도 합산 26단어는 거절',d=>{d.cases[1].sourceUrl='https://www.tossinvest.com/stocks/A000001/community?post=999001';d.cases[0].excerpt=Array.from({length:13},(_,i)=>`first${i}`).join(' ');d.cases[1].excerpt=Array.from({length:13},(_,i)=>`second${i}`).join(' ');},/동일 원문.*26단어/);
check('피드 주소에 전체 맥락 요약은 거절',d=>{d.cases[0].sourceUrl='https://www.tossinvest.com/stocks/A000001/community';d.cases[0].sourceNote='개별 글 링크 미확보 · 피드 주소';},/postSummary.*개별 게시물/);
check('요약 없는 기존 피드 사례는 계속 허용',d=>{d.cases=d.cases.slice(0,1);const c=d.cases[0];c.sourceUrl='https://www.tossinvest.com/stocks/A000001/community';c.sourceNote='개별 글 링크 미확보 · 피드 주소';for(const field of ['postSummary','sourceAuthor','sourceShareUrl','sourceVerifiedAt','samePostGroup'])delete c[field];});
check('요약에는 원문 확인일 필수',d=>{delete d.cases[0].sourceVerifiedAt;},/sourceVerifiedAt/);
check('외부 일반 URL을 개별 토스 게시물로 간주하지 않음',d=>{d.cases[0].sourceUrl='https://www.tossinvest.com.evil.example/community/posts/999001';},/postSummary.*개별 게시물/);
check('일반 URL 중복은 그룹으로 우회할 수 없음',d=>{for(const c of d.cases){delete c.postSummary;c.sourceUrl='https://example.com/article';}},/sourceUrl.*중복/);

for(const [field,value] of [
  ['postSummaryScope',''],['postSummaryScope','complete'],['postSummaryScope',null],['postSummaryScope',false],['postSummaryScope',['full']],
  ['postSummary',''],['postSummary',' '.repeat(10)],['postSummary','가'.repeat(2001)],['postSummary',{}],
  ['sourceAuthor',[]],['sourceAuthor','가'.repeat(201)],['sourceAuthor','이름\u0000'],
  ['sourceVerifiedAt',''],['sourceVerifiedAt',100],['sourceVerifiedAt','가'.repeat(101)],
  ['samePostGroup',false],['samePostGroup',''],['samePostGroup','가'.repeat(101)],
  ['sourceShareUrl','javascript:alert(1)'],['sourceShareUrl','https://user:pass@example.com/post'],
  ['sourceShareUrl',{}],['sourceShareUrl','https://example.com/'+'a'.repeat(2000)],
  ['sourceUrl','data:text/html,hello'],['sourceUrl','https://user:pass@www.tossinvest.com/community/posts/999001'],
]) check(`잘못된 출처 메타데이터 거절: ${field} (${typeof value}, ${String(value).length}자)`,d=>{d.cases[0][field]=value;},new RegExp(`\\.${field}:`));

console.log(`PASS 출처 맥락 검증: ${passed}개 · 가상 데이터만 사용 · 파일 변경 및 네트워크 없음`);
