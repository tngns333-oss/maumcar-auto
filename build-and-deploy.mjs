// 마음카 매물 자동 갱신 스크립트 (서버용, 비밀번호 불필요)
// 실행: node build-and-deploy.mjs   (Node 18+ 필요 — 내장 fetch 사용)
// 필요 환경변수(GitHub Secrets):
//   MEGAM_REFRESH_TOKEN : 메가엠 refreshToken 쿠키 값
// 결과물: ./dist/index.html (+ 로고·robots·sitemap) → Netlify 배포는 워크플로에서 처리
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.m-park.co.kr/megam/api/v1';
const KEYWORD = '오토허브';                 // 소속상사 검색어
const DANJI = '10,11,15';                  // 엠파크 단지코드(랜드/타워/허브)
const SELLER = { shop:'오토허브 엠파크지점', assoc:'한국자동차매매사업조합연합회', empName:'임수훈', empNo:'IM25-00720', tel:'010-2218-2310', tradeType:'알선' };
const OWN_EMP = '임수훈';                    // 이 종사원 매물 = 특가

const RT = process.env.MEGAM_REFRESH_TOKEN;
if (!RT) { console.error('MEGAM_REFRESH_TOKEN 환경변수가 없습니다.'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getAccessToken() {
  const r = await fetch(`${API}/comm/refreshToken`, { method:'POST', headers:{ Authorization:`Bearer ${RT}` } });
  const j = await r.json();
  if (j.statusCode !== 0 || !j.data?.accessToken) throw new Error('토큰 재발급 실패(refreshToken 만료?): ' + (j.responseMessage||''));
  return j.data.accessToken;
}

async function getListings(at) {
  const u = `${API}/searchCar/saleCarList?MparkDanji=${DANJI}&currentPage=1&pageSize=500&listOrder=${encodeURIComponent('StrDemoDay DESC')}&photoYN=Y&strKeyword=${encodeURIComponent(KEYWORD)}`;
  const j = await (await fetch(u, { headers:{ Authorization:`Bearer ${at}` } })).json();
  return j.data?.items?.searchCarList || [];
}

async function getCarCheck(checkNo) {
  try {
    const j = await (await fetch(`${API}/comm/getCarCheck?checkNo=${checkNo}`)).json();
    const it = j.data?.item; if (!it) return null;
    return { sago:it.SagoGbn||'', rep:it.SimpleRepairGbn||'', wat:it.WaterGbn||'', ve:it.ChkEndDay||'', tun:it.TuningGbn||'', rc:it.RecallComplateYN||'' };
  } catch { return null; }
}

const OPT_WL = ['내비게이션','후방카메라','전방카메라','어라운드뷰','썬루프','파노라마','통풍시트','열선시트','열선핸들','스마트키','버튼시동','크루즈','HUD','헤드업','차선이탈','후측방','전동시트','메모리시트','파워트렁크','전동트렁크','하이패스','4WD','4륜','앰비언트','전자제어서스펜션','에어서스','JBL','렉시콘','뱅앤','하만카돈','마크레','부메스터','크렐','서라운드뷰','원격시동','빌트인캠'];
async function getOptions(demoNo, at) {
  try {
    const j = await (await fetch(`${API}/searchCar/getDeatilInfo?strDemoNo=${demoNo}`, { headers:{ Authorization:`Bearer ${at}` } })).json();
    const it = j.data?.items; if (!it) return [];
    const sel = (it.getABSelOptionInfoMap||[]).map(o=>o.selectOptionName).filter(Boolean);
    const full = (it.getABOptionInfoMap||[]).map(o=>o.optionName||'').join(',').split(',').map(s=>s.trim()).filter(Boolean);
    const key = full.filter(o=>OPT_WL.some(w=>o.includes(w)));
    return [...new Set([...sel, ...key])].slice(0, 14);
  } catch { return []; }
}

// ---- 변환 헬퍼 (사이트 데이터 스키마) ----
const fuelMap = { '가솔린':'가솔린','디젤':'디젤','가솔린+전기':'하이브리드','디젤+전기':'디젤+전기','전기':'전기','LPG':'LPG','하이브리드':'하이브리드' };
const brandOf = n => (n||'').split(' ')[0];
function variantOf(n){
  const disp=(n.match(/(\d\.\d)/)||[])[1]||'';
  const turbo=/터보/.test(n)?'T':'';
  const dr=(n.match(/(AWD|2WD|4WD|4매틱|4MATIC)/i)||[])[1]||'';
  const fuel=/디젤/.test(n)?'디젤':(/하이브리드|HEV|\+전기/.test(n)?'하이브리드':(/가솔린/.test(n)?'가솔린':(/전기/.test(n)?'전기':(/LPG/.test(n)?'LPG':''))));
  const seat=(n.match(/(\d인승)/)||[])[1]||'';
  const p=[];
  if(seat)p.push(seat);
  if(disp)p.push(disp+turbo); else if(fuel)p.push(fuel);
  if(dr)p.push(dr==='4MATIC'?'4매틱':dr);
  return p.join(' ').trim()||'기본형';
}
function typeOf(n){ if(/카니발|스타리아|카렌스/.test(n))return'RV'; if(/GV80|GV70|GV60|팰리세이드|쏘렌토|싼타페|투싼|스포티지|모하비|렉스턴|코란도|QM6|티볼리|X3|X4|X5|X6|GLS|GLC|GLE|Q5|Q7|트레일블레이저|콜로라도|익스플로러|쿠페/.test(n))return'SUV'; if(/포터|봉고|마이티/.test(n))return'화물'; if(/모닝|레이|스파크|캐스퍼/.test(n))return'경차'; return'세단'; }
function modelOf(n){ let m=n.match(/\b(S\d{3}|E\d{3})/);if(m)return m[1]; m=n.match(/\b(GV\d{2})/);if(m)return m[1]; if(/EQ900/.test(n))return'EQ900'; m=n.match(/\b(G\d0)\b/);if(m)return m[1]; const kw=['카니발','모하비','팰리세이드','싼타페','쏘렌토','투싼','스포티지','그랜저','아반떼','쏘나타','에쿠스','모닝','레이','포터','QM6','렉스턴','코란도','콜로라도','트레일블레이저','익스플로러','GLS','GLC','GLE']; for(const k of kw)if(n.includes(k))return k; m=n.match(/\bK(\d)\b/);if(m)return'K'+m[1]; m=n.match(/(\d시리즈)/);if(m)return m[1]; m=n.match(/\b([XQ]\d)\b/);if(m)return m[1]; return(n.split(' ')[1]||n).replace(/\(.*\)/,''); }
function colorOf(b){ return ({'제네시스':'#0f172a','기아':'#1f2937','현대':'#13294b','벤츠':'#111827','BMW':'#0b3d6b','아우디':'#1e293b','쉐보레(대우)':'#7a1f2b','르노(삼성)':'#1d4ed8','KG모빌리티(쌍용)':'#374151','포드':'#0a2a43'})[b]||'#1f2937'; }
function imgOf(u){ if(!u)return''; if(u.startsWith('http'))return u; return 'https://dwe-on-mpark.s3.ap-northeast-2.amazonaws.com/mpark/AttEdit/CarPhoto/'+u.replace(/^\/?(mpark\/AttEdit\/CarPhoto\/)?/,''); }
const fmtDate = d => (d&&d.length===8)?`${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`:'';
function pdfOf(carNo, checkNo){ if(!checkNo)return''; return encodeURI(`https://image.m-park.co.kr/mpark/AttEdit/Check_PDFImage/20${checkNo.slice(0,4)}/${carNo}_${checkNo}.pdf`); }

async function pool(items, size, fn){ const out=[]; for(let i=0;i<items.length;i+=size){ out.push(...await Promise.all(items.slice(i,i+size).map(fn))); } return out; }

(async () => {
  console.log('1) 토큰 재발급...');
  const at = await getAccessToken();
  console.log('2) 매물 목록 수집...');
  const raw = await getListings(at);
  console.log('   매물 수:', raw.length);
  if (!raw.length) { console.error('매물 0건 — 중단'); process.exit(1); }

  console.log('3) 성능·옵션 수집...');
  const cars = await pool(raw, 8, async o => {
    const carNo = o.CarNo, demoNo = o.DemoNo, checkNo = o.CheckNo;
    const [chk, opts] = await Promise.all([ getCarCheck(checkNo), getOptions(demoNo, at) ]);
    await sleep(30);
    const name = (o.title||o.name||'').trim();
    const brand = brandOf(name);
    let pf = null;
    if (chk && checkNo) pf = { acc: chk.sago==='무', water: !!(chk.wat&&chk.wat!=='무'&&chk.wat!=='N'&&chk.wat!==''), repair: chk.rep==='Y', tuning: chk.tun==='Y', recall: chk.rc==='Y', valid: fmtDate(chk.ve), pdf: pdfOf(carNo, checkNo) };
    return {
      id: carNo, name, brand, model: modelOf(name), variant: variantOf(name),
      year: parseInt(o.YYMM)||0, yymm: o.YYMM||'',
      km: Number(o.Km)||0, fuel: fuelMap[o.Gas]||o.Gas||'기타', gear: o.AutoGbn||'오토',
      price: Number(o.DemoAmt)||0, type: typeOf(name),
      dealer: SELLER.empName, phone: SELLER.tel,      // 종사원 정보 통일(마음카)
      img: imgOf(o.imageUrl||o.image||''), c2: colorOf(brand),
      cat: (o.EmpName===OWN_EMP) ? '특가' : '일반',
      demo: demoNo||'', opts, noacc: pf?pf.acc:null, pf
    };
  });
  const 특가 = cars.filter(c=>c.cat==='특가').length;
  const 무사고 = cars.filter(c=>c.noacc===true).length;
  console.log(`   완료 — 총 ${cars.length}대 / 특가 ${특가} / 무사고 ${무사고}`);

  console.log('4) HTML 빌드...');
  const logoB64 = 'data:image/png;base64,' + fs.readFileSync('maumcar_logo_240.png').toString('base64');
  let html = fs.readFileSync('template.html','utf8')
    .replace('/*__DATA__*/', 'const CARS=' + JSON.stringify(cars) + ';')
    .split('__LOGO__').join(logoB64);
  fs.mkdirSync('dist', { recursive:true });
  fs.writeFileSync('dist/index.html', html);
  for (const f of ['maumcar_logo.png','robots.txt','sitemap.xml']) { if (fs.existsSync(f)) fs.copyFileSync(f, path.join('dist', f)); }
  console.log('완료 — dist/index.html 생성됨');
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
