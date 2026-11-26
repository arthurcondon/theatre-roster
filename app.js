// LOGIC-START
const SLOTS=[6,7,10,12,13,14];
const MGR_START={AM:6,PM:13};
const SLOTS_AM=[6,7,10],SLOTS_PM=[12,13,14];
// Staffing needed per start time, by number of cases in that half of the day (starting guesses, tuned by feedback)
const DEF_TABLES={
 am:[{max:15,need:{6:2,7:2,10:0}},{max:22,need:{6:2,7:3,10:0}},{max:30,need:{6:2,7:3,10:1}},{max:999,need:{6:2,7:4,10:1}}],
 pm:[{max:15,need:{12:0,13:1,14:2}},{max:22,need:{12:0,13:1,14:2}},{max:30,need:{12:1,13:1,14:2}},{max:999,need:{12:1,13:1,14:3}}]
};
const SLOT_MAX={6:2};
const capIssues=asg=>Object.keys(SLOT_MAX).map(t=>({t:+t,have:asg.filter(x=>x.t===+t).length,max:SLOT_MAX[t]})).filter(x=>x.have>x.max);
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const nextMonday=()=>{const d=new Date();d.setDate(d.getDate()+((8-d.getDay())%7||7));return iso(d)};
const fortDates=start=>{const r=[];for(let w=0;w<2;w++)for(let i=0;i<5;i++)r.push(addDays(start,w*7+i));return r};
const fmtH=h=>((h+11)%12)+1;
const slotLabel=t=>fmtH(t)+'–'+fmtH(t+8);
const clone=o=>JSON.parse(JSON.stringify(o));
const inPart=(t,p)=>p==='all'||(p==='am'?t<12:t>=12);
const isFree=v=>v==='A'||v==='O';
function bandIdx(n,table){for(let i=0;i<table.length;i++)if(n<=table[i].max)return i;return table.length-1}
function mgrCounts(staff){const m={};SLOTS.forEach(t=>m[t]=0);staff.filter(s=>s.role).forEach(s=>{m[MGR_START[s.role]]++});return m}
function casesOf(cs,C){
  if(cs&&(cs.am!=null||cs.pm!=null)){const am=+cs.am||0,pm=+cs.pm||0;return {am,pm,n:am+pm,est:false}}
  if(cs&&cs.n!=null){const n=+cs.n,a=Math.round(n/2);return {am:a,pm:n-a,n,est:false}}
  const n=+C.plan,a=Math.round(n/2);return {am:a,pm:n-a,n,est:true};
}
function requiredFor(cz,C){
  const m=mgrCounts(C.staff),r={};
  [['am',SLOTS_AM],['pm',SLOTS_PM]].forEach(function(x){const row=C.tables[x[0]][bandIdx(cz[x[0]],C.tables[x[0]])].need;x[1].forEach(t=>r[t]=Math.max(+row[t]||0,m[t]))});
  return r;
}
const totalFor=(cz,C)=>{const r=requiredFor(cz,C);return SLOTS.reduce((a,t)=>a+r[t],0)};
const halfTotal=(h,x,C)=>{const r=requiredFor({am:x,pm:x},C);return (h==='am'?SLOTS_AM:SLOTS_PM).reduce((a,t)=>a+r[t],0)};
// A free, O free+OT, L limited ("other"), X not available. Availability is stored per person for the whole year.
const _wk=new WeakMap();
const mondayOf=d=>addDays(d,-((parse(d).getDay()+6)%7));
function weeksIdx(a){
  const build=()=>{
    const w={};
    Object.keys(a.days||{}).forEach(d=>{const g=parse(d).getDay();if(g<1||g>5)return;const m=mondayOf(d);(w[m]=w[m]||{})[g]={v:a.days[d],p:(a.tp&&a.tp[d])||'any'}});
    // weeks where the person was away the whole week are leave, not their usual pattern
    return Object.keys(w).filter(m=>Object.keys(w[m]).some(g=>w[m][g].v!=='X')).sort().reverse().map(m=>({m,w:w[m]}));
  };
  if(a.nomemo)return build();
  if(!a.days)return [];
  let r=_wk.get(a.days);if(!r){r=build();_wk.set(a.days,r)}return r;
}
const codeVP=c=>c==='M'?{v:'A',p:'am'}:c==='P'?{v:'A',p:'pm'}:c==='X'?{v:'X',p:'any'}:c==='A'?{v:'A',p:'any'}:null;
// What we assume for a day nobody filled in: their standing pattern if they set one, otherwise the most common
// status for that weekday across their last 6 filled-in weeks (so one short week doesn't change it).
function usualOf(a,d){
  const g=parse(d).getDay();if(!a||g<1||g>5)return null;
  if(a.base&&a.base.from&&a.base.from<=d&&a.base.dow){const vp=codeVP(a.base.dow[g]);if(vp)return vp}
  const mon=mondayOf(d),weeks=weeksIdx(a).filter(x=>x.m<mon).slice(0,6),tally={};
  weeks.forEach((x,k)=>{const e=x.w[g];if(!e)return;const key=e.v+'|'+e.p;const t=tally[key]=tally[key]||{n:0,best:k,v:e.v,p:e.p};t.n++;if(k<t.best)t.best=k});
  let best=null;Object.keys(tally).forEach(k=>{const t=tally[k];if(!best||t.n>best.n||(t.n===best.n&&t.best<best.best))best=t});
  return best?{v:best.v,p:best.p}:null;
}
function resolveDay(s,d,a){
  const v=a&&a.days&&a.days[d];
  if(v)return {v:(v==='A'&&a.ot)?'O':v,p:(a.tp&&a.tp[d])||'any',asm:false};
  const un=usualOf(a,d);
  if(un)return {v:(un.v==='A'&&a.ot)?'O':un.v,p:un.p,asm:true};
  return {v:s.role?'A':'X',p:'any',asm:false};
}
function statusOf(s,d,start,avail){return resolveDay(s,d,avail[s.id]).v}
function dayInfo(s,d,start,avail){const a=avail[s.id]||{},r=resolveDay(s,d,avail[s.id]);return {v:r.v,p:r.p,f:(a.pf&&a.pf[d])||'',asm:r.asm}}
function slotOK(s,d,t,start,avail){const p=dayInfo(s,d,start,avail).p;return p==='any'||inPart(t,p)}
function weekOf(dates,d){return dates.indexOf(d)<5?0:1}
function fortStartFor(d,anchor){const k=Math.floor(Math.round((parse(d)-parse(anchor))/86400000)/14);return addDays(anchor,k*14)}

function autoFill(C,dates,avail,cases,roster,keep){
  const why=[];const asg={};dates.forEach(d=>{asg[d]=keep?((roster[d]&&roster[d].a)||[]).map(x=>Object.assign({},x)):[]});
  const cnt={},wk={};C.staff.forEach(s=>{cnt[s.id]=0;wk[s.id]=[0,0]});
  dates.forEach(d=>asg[d].forEach(x=>{if(cnt[x.s]!=null){cnt[x.s]++;wk[x.s][weekOf(dates,d)]++}}));
  const wantOf=s=>{const a=avail[s.id];return a&&a.want!=null?+a.want:(+s.want||0)};
  const gaps=[];
  dates.forEach((d,di)=>{
    const day=asg[d],have=id=>day.some(x=>x.s===id);
    const add=(s,t,x,w)=>{day.push(x?{s:s.id,t,x:1}:{s:s.id,t});cnt[s.id]++;wk[s.id][weekOf(dates,d)]++;why.push({d,s:s.id,t,w:w||''})};
    C.staff.filter(s=>s.role).forEach(m=>{if(!have(m.id)&&isFree(statusOf(m,d,C.start,avail)))add(m,MGR_START[m.role],0,'Always starts at '+slotLabel(MGR_START[m.role]))});
    const req=requiredFor(casesOf(cases[d],C),C);
    SLOTS.forEach(t=>{
      let missing=req[t]-day.filter(x=>x.t===t).length;
      while(missing>0){
        const free=C.staff.filter(s=>!s.role&&!have(s.id)&&isFree(statusOf(s,d,C.start,avail))&&slotOK(s,d,t,C.start,avail)&&wk[s.id][weekOf(dates,d)]<5);
        const left=s=>dates.slice(di).filter(x=>isFree(statusOf(s,x,C.start,avail))).length||1;
        let pool=free.filter(s=>cnt[s.id]<wantOf(s)),extra=false;
        if(pool.length){
          const bonus=s=>{const a=avail[s.id]||{};let v=0;const f=a.pf&&a.pf[d];if(f==='+')v+=.3;else if(f==='-')v-=.3;if(a.tpref)v+=inPart(t,a.tpref)?.15:-.15;return v};
          const sc=s=>(wantOf(s)-cnt[s.id])/left(s)+bonus(s);
          pool.sort((a,b)=>sc(b)-sc(a)||(statusOf(a,d,C.start,avail)==='O')-(statusOf(b,d,C.start,avail)==='O')||cnt[a.id]-cnt[b.id]);
        }else{
          pool=free.filter(s=>statusOf(s,d,C.start,avail)==='O').sort((a,b)=>(cnt[a.id]-wantOf(a))-(cnt[b.id]-wantOf(b)));extra=true;
          if(!pool.length){pool=free.slice().sort((a,b)=>(cnt[a.id]-wantOf(a))-(cnt[b.id]-wantOf(b))||cnt[a.id]-cnt[b.id]);extra='over'}
        }
        if(!pool.length){gaps.push({d,t,n:missing});break}
        {const p0=pool[0],a0=avail[p0.id]||{},f0=a0.pf&&a0.pf[d],parts=[];
          if(extra==='over')parts.push('free, but already at the days they wanted. Added only because the day was short and nobody else was free');else if(extra)parts.push('Overtime-available, and nobody else was free');
          else{parts.push((cnt[p0.id]+1)+' of '+wantOf(p0)+' days wanted');if(statusOf(p0,d,C.start,avail)==='O')parts.push('happy to do overtime');}
          if(f0==='+')parts.push('asked for this day');
          if(a0.tpref&&inPart(t,a0.tpref))parts.push('prefers '+(a0.tpref==='am'?'mornings':'afternoons'));
          if(resolveDay(p0,d,a0).asm)parts.push('using their usual week');
          add(p0,t,extra===true,parts.join(', '));}
        missing--;
      }
    });
  });
  return {asg,gaps,why};
}

// Ranked list of who to ask to cover slot t on date d when absentId can't work it
function rankCover(C,d,t,absentId,avail,roster){
  const start=fortStartFor(d,C.anchor),dates=fortDates(start),wi=dates.indexOf(d)<5?0:1;
  const cnt={},wk={};C.staff.forEach(s=>{cnt[s.id]=0;wk[s.id]=0});
  dates.forEach(x=>((roster[x]&&roster[x].a)||[]).forEach(a=>{if(a.s===absentId&&x===d)return;if(cnt[a.s]!=null){cnt[a.s]++;if((dates.indexOf(x)<5?0:1)===wi)wk[a.s]++}}));
  const day=r=>((roster[r]&&roster[r].a)||[]);
  const today=day(d),prev=day(addDays(d,-1)),next=day(addDays(d,1));
  const ranked=[],blocked=[];
  C.staff.filter(s=>!s.role&&s.id!==absentId&&!today.some(a=>a.s===s.id)).forEach(s=>{
    const i=dayInfo(s,d,start,avail),a=avail[s.id]||{},want=a.want!=null?+a.want:(+s.want||0);
    if(i.v==='L'){blocked.push({s,why:'Limited: '+((a.nt&&a.nt[d])||'see note')});return}
    if(i.v==='X'){blocked.push({s,why:a.days&&a.days[d]?'Marked not available':i.asm?'Usually not available this day':'Hasn’t entered availability'});return}
    if(!slotOK(s,d,t,start,avail)){blocked.push({s,why:i.p==='am'?'Mornings only':'Afternoons only'});return}
    if(wk[s.id]>=5){blocked.push({s,why:'Already 5 days this week'});return}
    let sc=0;const rs=[];
    rs.push(i.v==='O'?{k:'ot',t:'Free + OT'}:{k:'ok',t:'Free'});
    const under=want-cnt[s.id];
    if(under>0){sc+=Math.min(under,5);rs.push({k:'info',t:under+' day'+(under>1?'s':'')+' under target'})}
    else{sc+=Math.max(under,-3)-0.5;rs.push({k:'warn',t:'At or over target (extra)'})}
    if(i.f==='+'){sc+=2;rs.push({k:'ok',t:'Prefers this day'})}else if(i.f==='-'){sc-=2;rs.push({k:'warn',t:'Prefers not this day'})}
    if(a.tpref){if(inPart(t,a.tpref)){sc+=1;rs.push({k:'ok',t:'Prefers '+(a.tpref==='am'?'mornings':'afternoons')})}else{sc-=1;rs.push({k:'warn',t:'Prefers '+(a.tpref==='am'?'afternoons':'mornings')})}}
    const closedBefore=prev.some(p=>p.s===s.id&&p.t>=13)&&t<=7,earlyAfter=next.some(p=>p.s===s.id&&p.t<=7)&&t>=13;
    if(closedBefore||earlyAfter){sc-=1.5;rs.push({k:'warn',t:'Short turnaround'})}
    ranked.push({s,sc,rs,cnt:cnt[s.id],want});
  });
  ranked.sort((a,b)=>b.sc-a.sc||a.cnt-b.cnt);
  return {ranked,blocked};
}

// One point per day with feedback for that half: cases in the half, people rostered in the half, team verdict
function feedbackPoints(fb,cases,roster,h){
  const key=h==='am'?'rm':'ra',by={};
  Object.keys(fb).forEach(k=>{const f=fb[k];if(f[key])(by[f.d]=by[f.d]||[]).push(f)});
  return Object.keys(by).sort().map(d=>{
    let f=0,r=0,m=0;by[d].forEach(x=>{const v=x[key];if(v==='few')f++;else if(v==='many')m++;else r++});
    const cs=cases[d],cn=cs&&cs[h]!=null?+cs[h]:(cs&&cs.n!=null?Math.round(+cs.n/2):null);
    const hh=((roster[d]&&roster[d].a)||[]).filter(x=>inPart(x.t,h)).length;
    return {d,n:cn,h:hh,f,r,m,v:(f>=r&&f>=m&&f>0)?'few':(m>r&&m>f)?'many':'right',score:(m-f)/(f+r+m)};
  });
}
// Estimated sweet-spot headcount for each 5-case band, from rated days
function sweetSpot(pts,C,h){
  const bins={};pts.filter(p=>p.n!=null&&p.h>0).forEach(p=>{const b=Math.floor(p.n/5)*5;(bins[b]=bins[b]||[]).push(p)});
  return Object.keys(bins).map(Number).sort((a,b)=>a-b).map(b=>{
    const ps=bins[b],hs=v=>ps.filter(p=>p.v===v).map(p=>p.h),right=hs('right'),few=hs('few'),many=hs('many');
    let est=right.length?Math.round(right.reduce((a,x)=>a+x,0)/right.length):null;
    const maxFew=few.length?Math.max.apply(null,few):null,minMany=many.length?Math.min.apply(null,many):null;
    if(maxFew!=null&&(est==null||est<=maxFew))est=maxFew+1;
    if(minMany!=null&&(est==null||est>=minMany))est=minMany-1;
    return {b,days:ps.length,right:right.length,few:few.length,many:many.length,est,cur:halfTotal(h,b+2,C)};
  });
}
function tuningStats(C,fb,cases,roster){
  const out={},mc=mgrCounts(C.staff);
  ['am','pm'].forEach(function(h){
    const tbl=C.tables[h],key=h==='am'?'rm':'ra',slots=h==='am'?SLOTS_AM:SLOTS_PM;
    const bands=tbl.map((r,i)=>({h,i,max:r.max,min:i?tbl[i-1].max+1:0,days:0,few:0,right:0,many:0,votes:{}}));
    const by={};Object.keys(fb).forEach(k=>{const f=fb[k];(by[f.d]=by[f.d]||[]).push(f)});
    feedbackPoints(fb,cases,roster,h).forEach(p=>{
      if(p.n==null)return;const b=bands[bandIdx(p.n,tbl)];b.days++;
      if(p.v==='few'){b.few++;(by[p.d]||[]).forEach(x=>{if(x[key]==='few'&&x.sl&&inPart(+x.sl,h))b.votes[x.sl]=(b.votes[x.sl]||0)+1})}else if(p.v==='many')b.many++;else b.right++;
    });
    bands.forEach(b=>{
      const need=tbl[b.i].need;b.sug=null;
      if(b.days>=2){
        if(b.few>b.right&&b.few>=b.many){const top=Object.keys(b.votes).sort((x,y)=>b.votes[y]-b.votes[x])[0];b.sug={slot:+(top||slots[1]),delta:1}}
        else if(b.many>b.right&&b.many>b.few){const s=(h==='am'?[10,7,6]:[12,14,13]).find(t=>(+need[t]||0)>mc[t]);if(s)b.sug={slot:s,delta:-1}}
      }
    });
    out[h]=bands;
  });
  return out;
}
// LOGIC-END
const $app=document.getElementById('app');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db=null,isAdmin=false,ready=false,timedOut=false;
let cfg=null,avail={},cases={},roster={},fb={},chg={},ntf={},seen={},mails={};
let helpNote=null,tab='cal',part='all',calMode='month',calSel='',calMonth='',showOff=false,weOpen={},sheetDraft={},hoursOpen='',hrs={d:'',st:7,en:15},acts={},viewStart=null,me='',draft=null,availView='fort',availMonth='',bell=false;
let blk={from:'',to:'',st:'X',note:''},call={open:false,who:'',d:'',reason:'Sick',note:'',touched:false},cantFor=null,cantReason='Sick',cantNote='',cantWho='',msgKey='',yesFor=null,addFor=null,fbState={d:'',rm:'',ra:'',sl:'',note:''},lvPart='am';
let toastT=null,pending=false,wq=Promise.resolve();
let lg={names:null,err:'',busy:false,mode:'in',pick:''},issued=null;
let pat={dow:{1:'A',2:'A',3:'A',4:'A',5:'A'},from:'',span:'ongoing',to:'',every:'1'};

const IC={
 cal:'<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
 av:'<svg class="ic" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 11l2 2 4-4"/></svg>',
 ro:'<svg class="ic" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
 fb:'<svg class="ic" viewBox="0 0 24 24"><path d="M4 20V11M10 20V4M16 20v-7M22 20H2"/></svg>',
 set:'<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
 bell:'<svg class="ic" viewBox="0 0 24 24"><path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 004 0"/></svg>'
};
const dayLabel=s=>parse(s).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
const typeName={FT:'Full-time',PT:'Part-time',CAS:'Casual'};
const anchor=()=>(cfg&&cfg.start)||nextMonday();
function curStart(){if(viewStart)return viewStart;const a=anchor(),t=iso(new Date());const k=Math.floor(Math.round((parse(t)-parse(a))/86400000)/14);return addDays(a,k*14)}
const C=()=>({anchor:anchor(),start:curStart(),plan:cfg&&cfg.plan!=null?+cfg.plan:45,pub:(cfg&&cfg.published)||'',sat:(cfg&&cfg.sat)||'',all:(cfg&&cfg.staff)||[],staff:((cfg&&cfg.staff)||[]).filter(s=>!s.off),tables:(cfg&&cfg.tables)||clone(DEF_TABLES)});

function toast(m){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t)}t.textContent=m;t.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>{t.style.display='none'},3400)}
function save(path,data,del){
  wq=wq.then(async()=>{
    if(!db){toast('Not connected');return}
    try{if(del)await db.doc(path).delete();else await db.doc(path).set(data)}
    catch(e){toast(e&&e.code==='invalid_argument'?'You don’t have permission to change this':'Couldn’t save, try again')}
  });
  return wq;
}
async function mutCfg(fn){const c=clone(C());c.staff=c.all;fn(c);await save('cfg/main',{start:c.anchor,plan:c.plan,published:c.pub,sat:c.sat||'',staff:c.staff,tables:c.tables})}
function editing(){const a=document.activeElement;return a&&$app.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)}
function render(){if(editing()){pending=true;return}pending=false;draw()}
document.addEventListener('focusout',()=>{setTimeout(()=>{if(pending&&!editing())render()},50)});

function counts(c){const n={};c.staff.forEach(s=>n[s.id]=0);fortDates(c.start).forEach(d=>((roster[d]&&roster[d].a)||[]).forEach(x=>{if(n[x.s]!=null)n[x.s]++}));return n}
function dayReport(d,c,ov){
  const cz=casesOf(cases[d],c),req=requiredFor(cz,c),asg=ov||(roster[d]&&roster[d].a)||[];
  const have={};SLOTS.forEach(t=>have[t]=asg.filter(x=>x.t===t).length);
  let need=0,got=0,short=0,over=0;SLOTS.forEach(t=>{need+=req[t];got+=have[t];if(have[t]<req[t])short+=req[t]-have[t];if(have[t]>req[t])over+=have[t]-req[t]});
  return {n:cz.n,am:cz.am,pm:cz.pm,est:cz.est,req,have,asg,need,got,short,over,cap:capIssues(asg)};
}
function partStats(R,p){let need=0,got=0,short=0,over=0;SLOTS.forEach(t=>{if(!inPart(t,p))return;need+=R.req[t];got+=R.have[t];if(R.have[t]<R.req[t])short+=R.req[t]-R.have[t];if(R.have[t]>R.req[t])over+=R.have[t]-R.req[t]});return{need,got,short,over}}
function partBar(){return '<div class="row wrap" style="margin:10px 0"><div class="seg">'+[['all','All day',''],['am','☀ Morning','am'],['pm','☾ Afternoon','pm']].map(o=>'<button class="'+(part===o[0]?'on '+o[2]:'')+'" data-act="pt" data-v="'+o[0]+'">'+o[1]+'</button>').join('')+'</div>'+(part==='am'?'<span class="sub">Starts before 12</span>':part==='pm'?'<span class="sub">Starts 12 or later</span>':'')+'</div>'}
function statusChip(R,p){const st=partStats(R,p||'all');if(R.est&&!(R.cap&&R.cap.length))return st.got?'<span class="chip info">Cases not in yet</span>':'<span class="chip gap">Not rostered</span>';return st.got?(R.cap&&R.cap.length&&(p||'all')!=='pm'?'<span class="chip warn">Too many at '+slotLabel(R.cap[0].t)+'</span>':st.short?(st.got<st.need?'<span class="chip warn">Short '+(st.need-st.got)+'</span>':'<span class="chip warn">Check start times</span>'):st.over?'<span class="chip info">'+st.over+' over</span>':'<span class="chip ok">Covered</span>'):'<span class="chip gap">Not rostered</span>'}
const staffOpts=c=>c.staff.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===me?' selected':'')+'>'+esc(s.name)+'</option>').join('');

function draw(){
  if(!ready){$app.innerHTML='<div class="empty">'+(timedOut?'Can’t reach the roster data yet. Check your connection.':'Loading…')+'</div>';return}
  if(!db){$app.innerHTML=loginView();return}
  const c=C(),dates=fortDates(c.start);
  if(tab==='roster'||(!isAdmin&&tab==='setup'))tab='cal';
  if(!draft||draft.id!==me)loadDraft(c);
  const bc=alertCount(c),oc=isAdmin?needCount(c):0;
  let h='<div class="hero"><div class="row"><div><div class="brand"><div><div class="ey">Macquarie University Hospital</div><h1>Theatre Roster</h1></div></div></div><span class="sp"></span><img class="logo" src="logo.png" alt="Macquarie University Hospital" onerror="this.remove()"><button class="bell" data-act="bell" aria-label="Notifications">'+IC.bell+(bc?'<i>'+bc+'</i>':'')+'</button></div>'+(tab==='cal'||tab==='avail'?'<div class="fn"><button data-act="fn" data-v="-14" aria-label="Previous fortnight">‹</button><div class="mid">'+esc(dayLabel(dates[0]))+' – '+esc(dayLabel(dates[9]))+''+((isAdmin||tab==='avail')?'<small>'+c.staff.filter(s=>hasEntries(s,dates)).length+' of '+c.staff.length+' have entered availability</small>':'')+'</div><button data-act="fn" data-v="14" aria-label="Next fortnight">›</button></div>':'')+'</div>';
  if(bell)h+=bellPanel(c);
  if(!c.staff.length&&tab!=='setup')h+='<div class="banner">'+(isAdmin?'No staff yet. Open Setup to add your team.':'The manager hasn’t added the team yet.')+'</div>';
  h+=tab==='cal'?vCal(c,dates):tab==='avail'?vAvail(c,dates):tab==='fb'?vFb(c,dates):vSetup(c,dates);
  if(tab==='cal')h+=accountCard();
  const tabs=[['cal',isAdmin?'Calendar':'My shifts',IC.cal,oc],['avail','Availability',IC.av,0]];
  tabs.push(['fb','Feedback',IC.fb,0]);
  if(isAdmin)tabs.push(['setup','Setup',IC.set,0]);
  h+='<div class="nav">'+tabs.map(t=>'<button class="'+(tab===t[0]?'on':'')+'" data-act="tab" data-v="'+t[0]+'">'+t[2]+t[1]+(t[3]?'<b>'+t[3]+'</b>':'')+'</button>').join('')+'</div>';
  h+='<div class="foot">Team roster tool for the operating theatre assistants. Not an official hospital system.</div>';
  $app.innerHTML=h;
}


const fmtT=x=>{const h=Math.floor(x),m=Math.round((x-h)*60);return fmtH(h%24)+(m?':'+pad(m):'')};
const fmtDur=h=>(Math.round(h*10)/10)+'h';
const myAsg=d=>((roster[d]&&roster[d].a)||[]).find(x=>x.s===me);
const actTag=(d,s,t)=>{const a=acts[d+'_'+s];if(!a)return '';const ot=a.en-a.st-8;return '<span class="tag '+(ot>0?'ot':'')+'">worked '+fmtT(a.st)+'–'+fmtT(a.en)+(ot>0?' · +'+fmtDur(ot)+' OT':'')+'</span>'};
const visDay=d=>{const p=(cfg&&cfg.published)||'';return isAdmin||(!!p&&d<=p)};
const effAsg=d=>sheetDraft[d]||(visDay(d)?((roster[d]&&roster[d].a)||[]):[]);
function monthOf(ym){const p=ym.split('-').map(Number),first=new Date(p[0],p[1]-1,1),last=new Date(p[0],p[1],0);const s=new Date(first);s.setDate(1-((first.getDay()+6)%7));const e=new Date(last);e.setDate(last.getDate()+((7-last.getDay())%7));const r=[];for(const d=new Date(s);d<=e;d.setDate(d.getDate()+1))r.push(iso(d));return r}
function isWorking(d,c){
  const g=parse(d).getDay();if(g>=1&&g<=5)return true;
  if(g===6){if(roster[d]&&roster[d].a&&roster[d].a.length)return true;if(c.sat){const k=Math.round((parse(d)-parse(c.sat))/86400000);return k%14===0}}
  return false;
}
function nextWorking(d,c){let x=addDays(d,1);for(let i=0;i<10;i++){if(isWorking(x,c))return x;x=addDays(x,1)}return addDays(d,1)}
const casesIn=d=>{const k=cases[d];return !!k&&(k.am!=null||k.pm!=null||k.n!=null)};
function caseInputs(d,cs){
  const tot=cs.n!=null?cs.n:'';
  return '<div class="row wrap" style="margin:6px 0 2px"><label class="sub">Total cases <input type="number" min="0" data-ch="ctot" data-d="'+d+'" value="'+esc(tot)+'"></label><label class="sub">Total theatres <input type="number" min="0" data-ch="th" data-d="'+d+'" value="'+(cs.th!=null?esc(cs.th):'')+'" style="width:70px"></label></div><div class="row wrap" style="margin:4px 0 2px"><label class="sub">\u2600 Morning cases <input type="number" min="0" data-ch="cam" data-d="'+d+'" value="'+(cs.am!=null?esc(cs.am):'')+'"></label><label class="sub">\u263e Afternoon cases <input type="number" min="0" data-ch="cpm" data-d="'+d+'" value="'+(cs.pm!=null?esc(cs.pm):'')+'"></label></div><div class="sub">Enter the total, or just morning and afternoon (the total is added up for you).</div>';
}
function prevWorking(d,c){let x=addDays(d,-1);for(let i=0;i<10;i++){if(isWorking(x,c))return x;x=addDays(x,-1)}return addDays(d,-1)}
function dayPager(c){
  const today=iso(new Date()),first=isWorking(today,c)?today:nextWorking(today,c);
  const days=[];let x=first;for(let i=0;i<10;i++){days.push(x);x=nextWorking(x,c)}
  let h='<div class="pager" data-pager="1"><div class="row"><button class="pg" data-act="dstep" data-v="-1" aria-label="Previous day">\u2039</button><div class="pgm"><b>'+esc(dayLabel(calSel))+'</b></div><button class="pg" data-act="dstep" data-v="1" aria-label="Next day">\u203a</button>'+(calSel!==first?'<button class="btn sm" data-act="cday" data-d="'+first+'">Today</button>':'')+'</div>';
  h+='<div class="strip">'+days.map(d=>'<button class="'+(d===calSel?'on':'')+(d===today?' td':'')+'" data-act="cday" data-d="'+d+'"><small>'+esc(parse(d).toLocaleDateString('en-AU',{weekday:'short'}))+'</small>'+parse(d).getDate()+'</button>').join('')+'</div></div>';
  return h;
}
function homeCards(c){
  const today=iso(new Date());
  if(!calSel)calSel=isWorking(today,c)?today:nextWorking(today,c);
  const lab=d=>d===today?'Today':d===addDays(today,1)?'Tomorrow':parse(d).toLocaleDateString('en-AU',{weekday:'long'});
  let h=dayPager(c);
  if(isAdmin)return h+dayCard(c,calSel);
  return h+'<div class="two">'+[calSel,nextWorking(calSel,c)].map(d=>homeCard(c,d,lab(d))).join('')+'</div>';
}
function homeCard(c,d,label){
  const R=dayReport(d,c,effAsg(d)),pub=visDay(d);
  let h='<div class="card hc" data-hc="'+d+'"><div class="row"><div><div class="hl">'+esc(label)+'</div><div class="sub">'+esc(dayLabel(d))+'</div></div></div>';
  if(!pub)return h+'<div class="sub" style="margin-top:10px">This day\u2019s roster hasn\u2019t been published yet.</div></div>';
  ['am','pm'].forEach(p=>{
    const list=R.asg.filter(x=>inPart(x.t,p)).sort((a,b)=>a.t-b.t||nameOf(c,a.s).localeCompare(nameOf(c,b.s)));
    h+='<div class="half '+p+'"><div class="hh">'+(p==='am'?'\u2600 Morning':'\u263e Afternoon')+'<span>'+list.length+'</span></div>';
    if(!list.length)h+='<div class="sub">Nobody rostered.</div>';
    list.forEach(x=>{
      const s=c.all.find(z=>z.id===x.s);if(!s)return;
      const cant=chgList().some(q=>q.k==='cant'&&q.s===x.s&&q.d===d&&q.st==='open');
      h+='<div class="pr'+(x.s===me?' mine':'')+'"><span class="tm">'+slotLabel(x.t)+'</span><span class="nm">'+(cant?'<s>'+esc(s.name)+'</s>':esc(s.name))+'</span>'+(s.role?'<span class="tag mgr">'+s.role+'</span>':'')+(cant?'<span class="tag red">can\u2019t work</span>':'')+'</div>';
    });
    h+='</div>';
  });
  const cs=cases[d]||{};
  if(casesIn(d)){
    const bx=(l,v)=>'<div class="cbx"><b>'+(v!=null?esc(v):'\u2013')+'</b><span>'+l+'</span></div>';
    h+='<div class="cgrid">'+bx('Total cases',R.n)+bx('Theatres',cs.th!=null?cs.th:null)+bx('\u2600 Morning cases',R.am)+bx('\u263e Afternoon cases',R.pm)+'</div>';
  }else h+='<div class="sub" style="margin-top:12px">Cases not entered yet.</div>';
  return h+'</div>';
}
function checkCasesAlert(){
  try{
    if(!isAdmin||typeof Notification==='undefined'||Notification.permission!=='granted'||!document.hidden)return;
    const c=C(),now=new Date(),today=iso(now);if(now.getHours()<13)return;
    const nx=nextWorking(isWorking(today,c)?today:addDays(today,-1),c);if(casesIn(nx))return;
    const key='rp_casesalert_'+today;if(localStorage.getItem(key))return;localStorage.setItem(key,'1');
    navigator.serviceWorker.ready.then(r=>r.showNotification('Theatre Roster',{body:'Enter the cases for '+dayLabel(nx)+' and check the roster.',icon:'icon-192.png',tag:'rp-cases'}));
  }catch(e){}
}
const nextWeekday=d=>{let x=addDays(d,1);for(let i=0;i<7;i++){const w=parse(x).getDay();if(w>0&&w<6)return x;x=addDays(x,1)}return x};
const pmFirst=c=>{const m=c.staff.find(s=>s.role==='PM');return m?String(m.name).split(' ')[0]:'your manager'};
function smartDate(who){
  const now=new Date(),today=iso(now),hr=now.getHours()+now.getMinutes()/60;
  const ds=Object.keys(roster).sort().filter(d=>d>=today&&((roster[d]&&roster[d].a)||[]).some(z=>z.s===who));
  if(!ds.length)return nextWeekday(today);
  if(ds[0]===today){const x=roster[today].a.find(z=>z.s===who),past=x.t<12?hr>=12:hr>=x.t+4;if(!past)return today;return ds[1]||nextWeekday(today)}
  return ds[0];
}
function callDate(){const who=isAdmin?call.who:me;return call.touched&&call.d?call.d:(who?smartDate(who):'')}
function callPanel(c){
  if(!call.open)return '<div class="row" style="margin:4px 0 10px"><button class="btn '+(isAdmin?'':'ghost')+'" data-act="callopen">'+(isAdmin?'Someone called in sick':'I can’t work a shift')+'</button></div>';
  const who=isAdmin?call.who:me,d=callDate(),x=who&&d?((roster[d]&&roster[d].a)||[]).find(z=>z.s===who):null;
  let h='<div class="card" style="border:2px solid var(--pri)"><h3>'+(isAdmin?'Someone called in sick':'I can’t work a shift')+'</h3>';
  if(isAdmin)h+='<div class="sub" style="margin:8px 0 4px">Who called in?</div><select data-cl="who" style="width:100%"><option value="">Pick a person</option>'+c.staff.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===call.who?' selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select>';
  else h+='<div class="sub" style="margin-top:6px">For <b>'+esc(nameOf(c,me))+'</b></div>';
  if(who){
    h+='<div class="sub" style="margin:12px 0 4px">Which day?</div><div class="row wrap"><input type="date" data-cl="d" value="'+esc(d)+'"><button class="btn sm ghost" data-act="calld" data-v="today">Today</button><button class="btn sm ghost" data-act="calld" data-v="next">Next weekday</button></div>';
    h+='<div class="sub" style="margin-top:6px">'+(x?'Rostered '+slotLabel(x.t)+' ('+(x.t<12?'morning':'afternoon')+')':'<b style="color:var(--bad)">Not rostered on '+esc(dayLabel(d))+'.</b> Pick another day.')+'</div>';
    h+='<div class="sub" style="margin:12px 0 4px">Reason</div><div class="seg seg5">'+['Sick','Personal','Other'].map(r=>'<button class="'+(call.reason===r?'on bA':'')+'" data-act="callreason" data-v="'+r+'">'+r+'</button>').join('')+'</div>';
    h+='<input data-cl="note" value="'+esc(call.note)+'" placeholder="Add a note (optional)" style="width:100%;margin-top:10px" maxlength="120">';
    if(!isAdmin)h+='<div class="banner pri" style="margin-top:12px">This doesn’t replace telling '+esc(pmFirst(c))+'. Please also message '+esc(pmFirst(c))+' directly. Your reason goes to the manager only; colleagues are just told you can’t work the shift.</div>';
  }
  h+='<div class="row" style="margin-top:12px"><button class="btn pri" data-act="callgo"'+(x?'':' disabled')+'>'+(isAdmin?'Log it and find cover':'Send to '+esc(pmFirst(c)))+'</button><button class="btn ghost" data-act="callcancel">Cancel</button></div></div>';
  return h;
}
function myShiftRows(c,list,today){
  return list.map(z=>{
    const a=acts[z.d+'_'+me],st=a?a.st:z.x.t,isToday=z.d===today,past=z.d<today,rep=chgList().some(q=>q.k==='cant'&&q.s===me&&q.d===z.d&&isOpen(q));
    const wd=parse(z.d).toLocaleDateString('en-AU',{weekday:'long'}),dt=parse(z.d).toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    let r='<div class="myshift'+(isToday?' today':'')+'" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #eee"><div style="min-width:92px"><div style="font-weight:700;font-size:17px">'+wd+(isToday?' <span class="chip info">today</span>':'')+'</div><div class="sub">'+dt+'</div></div><div style="flex:1"><span class="shpill '+(st<12?'am':'pm')+'" style="display:inline-block;border-radius:10px;padding:6px 12px;font-weight:700;font-size:16px;background:'+(st<12?'#fde9c0':'#e9d5f0')+'">'+fmtT(st)+' – '+fmtT(a?a.en:st+8)+'</span><div class="sub" style="margin-top:3px">'+(st<12?'Morning':'Afternoon')+(a&&a.en-a.st>8?' · +'+fmtDur(a.en-a.st-8)+' overtime':'')+'</div></div>';
    if(rep)r+='<span class="chip warn">You’ve told the manager you can’t make it</span>';
    else if(!past)r+='<button class="btn sm ghost" data-act="cantopen" data-d="'+z.d+'" data-t="'+z.x.t+'">Can’t make it</button>';
    r+='</div>';
    if(past||isToday)r+=hoursBox(c,z.d);
    return r;
  }).join('');
}
function staffHome(c,dates){
  const today=iso(new Date()),mon=mondayOf(today),nxt=addDays(mon,7),after=addDays(mon,14);
  const mineAll=[];for(let i=-7;i<56;i++){const d=addDays(today,i);if(!c.pub||d>c.pub)continue;const x=myAsg(d);if(x)mineAll.push({d,x})}
  const wk=(f,t)=>mineAll.filter(z=>z.d>=f&&z.d<t);
  const thisW=wk(mon,nxt),nextW=wk(nxt,after),later=mineAll.filter(z=>z.d>=after).slice(0,6);
  let h=emailPrompt();
  h+='<div class="card" style="padding:16px 16px 6px"><div class="hl" style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--pri);font-weight:700">This week</div><div class="sub">'+esc(dayLabel(mon))+' – '+esc(dayLabel(addDays(mon,4)))+'</div>';
  h+=thisW.length?myShiftRows(c,thisW,today):'<div style="padding:18px 0 14px;font-size:17px;font-weight:600">You’re not rostered on this week.</div>';
  h+='</div>';
  h+=callPanel(c);
  if(nextW.length||c.pub>=nxt)h+='<div class="card" style="padding:16px 16px 6px"><div class="hl" style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--pri);font-weight:700">Next week</div><div class="sub">'+esc(dayLabel(nxt))+' – '+esc(dayLabel(addDays(nxt,4)))+'</div>'+(nextW.length?myShiftRows(c,nextW,today):'<div style="padding:18px 0 14px;font-weight:600">Not rostered on.</div>')+'</div>';
  else h+='<div class="banner">Next week’s roster hasn’t been published yet.</div>';
  if(later.length)h+='<div class="card" style="padding:16px 16px 6px"><div class="hl" style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--pri);font-weight:700">Later</div>'+myShiftRows(c,later,today)+'</div>';
  h+='<div class="row wrap" style="margin:6px 0 14px"><button class="btn pri" data-act="tab" data-v="avail">Change my availability</button></div>';
  h+='<h2>Team roster</h2>'+homeCards(c)+vSheet(c,dates);
  return h;
}
function vCal(c,dates){
  const today=iso(new Date());
  if(!calMonth)calMonth=today.slice(0,7);
  if(!isAdmin)return staffHome(c,dates);
  let h=emailPrompt()+homeCards(c);
  const calls=chgList().filter(x=>x.k==='cant'&&isOpen(x)),gaps=isAdmin?gapItems(c):[],caps=isAdmin?capItems(c):[];
  if(isAdmin&&(calls.length+gaps.length+caps.length))h+='<h2 style="margin-top:6px">Needs attention <span class="chip red">'+(calls.length+gaps.length+caps.length)+'</span></h2>'+attention(c,calls)+caps.map(g=>capCard(c,g)).join('')+gaps.map(g=>gapCard(c,g)).join('');
  h+=callPanel(c);
  h+=vSheet(c,dates);
  return h;
}
function vMonth(c,today){
  const p=calMonth.split('-').map(Number),title=new Date(p[0],p[1]-1,1).toLocaleDateString('en-AU',{month:'long',year:'numeric'});
  let h='<div class="mnav"><button data-act="mnav" data-v="-1" aria-label="Previous month">‹</button><h2>'+esc(title)+'</h2><button class="tdy" data-act="mtoday">Today</button><button data-act="mnav" data-v="1" aria-label="Next month">›</button></div>';
  h+='<div class="mg" data-swipe="1">'+['M','T','W','T','F','S','S'].map(x=>'<div class="wd">'+x+'</div>').join('');
  monthOf(calMonth).forEach(d=>{
    const dt=parse(d),w=dt.getDay(),out=d.slice(0,7)!==calMonth,we=w===0||w===6;
    const x=((roster[d]&&roster[d].a)||[]).find(z=>z.s===me),a=acts[d+'_'+me];
    let inner='<span class="n">'+dt.getDate()+'</span>';
    if(x){const st=a?a.st:x.t;inner+='<span class="sh '+(st<12?'am':'pm')+'">'+fmtT(st)+'–'+fmtT(a?a.en:st+8)+'</span>'}
    if(isAdmin&&isWorking(d,c)){const R=dayReport(d,c);if(R.got||R.need){const am=partStats(R,'am'),pm=partStats(R,'pm');inner+='<span class="dots"><i style="background:'+(am.short?'#C4320A':'#f59e0b')+'"></i><i style="background:'+(pm.short?'#C4320A':'#80225F')+'"></i></span>'}}
    const op=chgList().some(q=>q.k==='cant'&&q.d===d&&q.st==='open');
    h+='<button class="mc'+(out?' out':'')+(we?' we':'')+(d===today?' today':'')+(d===calSel?' sel':'')+'" data-act="cday" data-d="'+d+'">'+inner+(op?'<i class="rd"></i>':'')+'</button>';
  });
  h+='</div><div class="legend sub" style="margin-top:8px"><span><i class="dot" style="background:#f59e0b"></i>Morning shift</span><span><i class="dot" style="background:#80225F"></i>Afternoon shift</span>'+(isAdmin?'<span><i class="dot" style="background:#C4320A"></i>Short-staffed</span>':'')+'</div>';
  return h+dayCard(c,calSel);
}
function dayCard(c,d){
  const R=dayReport(d,c),cs=cases[d]||{},work=isWorking(d,c)||!!weOpen[d];
  let h='<div class="card" data-day="'+d+'"><div class="row"><h3>'+esc(dayLabel(d))+'</h3><span class="sp"></span>'+(work?statusChip(R,'all'):'')+'</div>';
  if(!work&&!R.got)return h+'<div class="sub" style="margin-top:6px">Not a working day.</div>'+(isAdmin?'<div class="row" style="margin-top:10px"><button class="btn sm" data-act="openwe" data-d="'+d+'">Roster a shift on this day</button></div>':'')+'</div>';
  h+=isAdmin?dayEditor(c,d,R,cs):readDay(c,d,R,cs);
  const my=me?myAsg(d):null;
  if(my&&!isAdmin){
    const reported=chgList().some(q=>q.k==='cant'&&q.s===me&&q.d===d&&isOpen(q));
    if(reported)h+='<div class="banner pri" style="margin-bottom:0">You’ve told the manager you can’t make this shift.</div>';
    else if(d>=iso(new Date()))h+='<div style="margin-top:12px"><button class="btn ghost" data-act="cantopen" data-d="'+d+'" data-t="'+my.t+'">I can’t make this shift</button></div>';
  }
  if(me&&d<=iso(new Date())&&work)h+=hoursBox(c,d);
  return h+'</div>';
}
function readDay(c,d,R,cs){
  let h='<div class="sub" style="margin:4px 0 0">'+(R.est?'Cases not entered yet':R.n+' cases ('+R.am+' morning, '+R.pm+' afternoon)')+(cs.th!=null?' · '+esc(cs.th)+' theatres':'')+(cs.note?' · '+esc(cs.note):'')+'</div>';
  ['am','pm'].forEach(p=>{
    const st=partStats(R,p);
    h+='<div class="half '+p+'"><div class="hh">'+(p==='am'?'☀ Morning':'☾ Afternoon')+'<span>'+st.got+' of '+st.need+'</span></div>';
    SLOTS.filter(t=>inPart(t,p)).forEach(t=>{
      R.asg.filter(x=>x.t===t).forEach(x=>{
        const s=c.all.find(z=>z.id===x.s);if(!s)return;
        const cant=chgList().some(q=>q.k==='cant'&&q.s===x.s&&q.d===d&&q.st==='open'),ot=statusOf(s,d,c.start,avail)==='O';
        h+='<div class="pr'+(x.s===me?' mine':'')+'"><span class="tm">'+slotLabel(t)+'</span><span class="nm">'+(cant?'<s>'+esc(s.name)+'</s>':esc(s.name))+'</span>'+(s.role?'<span class="tag mgr">'+s.role+' manager</span>':'')+(ot?'<span class="tag ot">OT ok</span>':'')+actTag(d,x.s)+(cant?'<span class="tag red">can’t work · finding cover</span>':'')+'</div>';
      });
    });
    if(!st.got)h+='<div class="sub">Nobody rostered yet.</div>';
    h+='</div>';
  });
  return h;
}
function dayEditor(c,d,R,cs){
  const n=counts(c);
  let h=caseInputs(d,cs)+'<input data-ch="note" data-d="'+d+'" value="'+esc(cs.note||'')+'" placeholder="Notes (late lists, long cases…)" style="width:100%;margin:4px 0 6px">';
  h+=(R.est?'<div class="sub">No cases entered yet. Showing a planning estimate of '+R.n+' cases.</div>':'<div class="sub">'+R.n+' cases in total</div>')+sugLine(R);
  SLOTS.forEach(t=>{
    const got=R.asg.filter(x=>x.t===t),need=R.req[t];
    h+='<div class="rs"><div class="tm '+(t<12?'am':'pm')+'">'+slotLabel(t)+'<small>need '+need+'</small></div><div class="sp">';
    got.forEach(x=>{
      const s=c.all.find(z=>z.id===x.s);if(!s)return;
      const v=statusOf(s,d,c.start,avail),ok=slotOK(s,d,x.t,c.start,avail),bad=v==='X'||v==='L'||!ok;
      const why=v==='X'?'Marked not available':v==='L'?'Limited: '+(((avail[s.id]||{}).nt||{})[d]||'see note'):!ok?'Only available '+(dayInfo(s,d,c.start,avail).p==='am'?'mornings':'afternoons'):'';
      const ac=acts[d+'_'+x.s];
      h+='<span class="chip '+(bad?'bad':(t<12?'am':'pm'))+'" title="'+esc(why)+'">'+esc(s.name)+(s.role?' ('+s.role+')':'')+(v==='O'?' · OT':'')+(x.x?' · extra':'')+(s.off?' · inactive':'')+(ac?' · worked '+fmtT(ac.st)+'–'+fmtT(ac.en):'')+(bad?' ⚠':'')+'<button data-act="rm" data-d="'+d+'" data-s="'+esc(x.s)+'" aria-label="Remove">✕</button></span>';
    });
    for(let k=got.length;k<need;k++)h+='<span class="chip gap">needs 1</span>';
    h+='</div><button class="plus" data-act="plus" data-d="'+d+'" data-t="'+t+'" aria-label="Add person to '+slotLabel(t)+'">+</button></div>';
    if(addFor&&addFor.d===d&&addFor.t===t)h+=addBox(c,d,t,n);
  });
  h+='<div class="sub" style="margin-top:8px">Changes here save straight away'+(liveDate(c,d)?' and the staff affected are alerted.':'. Staff aren’t alerted until the roster is published.')+'</div>';
  return h;
}
function hoursBox(c,d){
  const mine=myAsg(d),a=acts[d+'_'+me],opened=hoursOpen===d;
  let h='<div style="margin-top:12px;background:#f3f0ea;border-radius:14px;padding:12px">';
  if(!opened){
    h+='<div class="row wrap"><span class="sub">'+(a?'You logged '+fmtT(a.st)+'–'+fmtT(a.en)+(a.en-a.st>8?' (+'+fmtDur(a.en-a.st-8)+' overtime)':''):mine?'Rostered '+slotLabel(mine.t)+'.':'You weren’t rostered.')+'</span><span class="sp"></span><button class="btn sm" data-act="hropen" data-d="'+d+'">'+(a?'Edit my hours':'Log my actual hours')+'</button></div></div>';
    return h;
  }
  const st=hrs.d===d?hrs.st:(a?a.st:(mine?mine.t:7)),en=hrs.d===d?hrs.en:(a?a.en:st+8);
  const opts=(from,to,cur)=>{let o='';for(let x=from;x<=to;x+=.5)o+='<option value="'+x+'"'+(x===cur?' selected':'')+'>'+fmtT(x)+'</option>';return o};
  h+='<b>What time did you actually work?</b><div class="sub" style="margin:2px 0 8px">Use this if you started or finished at a different time, or did unexpected overtime.</div><div class="row wrap"><label class="sub">Start <select data-hr="st">'+opts(5,16,st)+'</select></label><label class="sub">Finish <select data-hr="en">'+opts(10,24,en)+'</select></label></div>';
  const ot=en-st-8;
  h+='<div class="sub" style="margin-top:8px">'+fmtT(st)+'–'+fmtT(en)+' = '+fmtDur(en-st)+(ot>0?' · <b>'+fmtDur(ot)+' overtime</b>':ot<0?' · '+fmtDur(-ot)+' short of a full shift':'')+'</div>';
  h+='<div class="row" style="margin-top:10px"><button class="btn pri" data-act="hrsave" data-d="'+d+'">Save hours</button>'+(a?'<button class="btn ghost" data-act="hrclear" data-d="'+d+'">Remove</button>':'')+'<button class="btn ghost" data-act="hrclose">Cancel</button></div></div>';
  return h;
}
function cantBox(){return '<div style="margin-top:12px;background:#f3f0ea;border-radius:14px;padding:12px"><div class="row wrap"><select data-ch="creason">'+['Sick','Personal','Other'].map(r=>'<option'+(cantReason===r?' selected':'')+'>'+r+'</option>').join('')+'</select><input data-ch="cnote" value="'+esc(cantNote)+'" placeholder="Note (optional)" style="flex:1;min-width:120px"></div><div class="sub" style="margin-top:6px">Your reason goes to the manager only. Colleagues are just told you can’t work the shift.</div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="cantgo">Send to manager</button><button class="btn ghost" data-act="ccancel">Cancel</button></div></div>'}
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayLab=(v,tp)=>v==='X'?'Not available':v==='L'?'Other':(tp==='am'?'Morning':tp==='pm'?'Afternoon':'All day');
const hasExplicit=(s,dates)=>dates.some(d=>avail[s.id]&&avail[s.id].days&&avail[s.id].days[d]);
const hasEntries=(s,dates)=>hasExplicit(s,dates)||dates.some(d=>dayInfo(s,d,'',avail).asm);
const monthDates=ym=>{const p=ym.split('-').map(Number),r=[],dt=new Date(p[0],p[1]-1,1);while(dt.getMonth()===p[1]-1){const w=dt.getDay();if(w>0&&w<6)r.push(iso(dt));dt.setDate(dt.getDate()+1)}return r};
const avDates=(c)=>availView==='year'?monthDates(availMonth||iso(new Date()).slice(0,7)):fortDates(c.start);
function loadDraft(c){
  if(!me){draft=null;return}
  const a=avail[me]||{},days={};let ot=false;
  Object.keys(a.days||{}).forEach(d=>{let v=a.days[d];if(v==='O'){v='A';ot=true}days[d]=v});
  draft={id:me,days,tp:Object.assign({},a.tp),pf:Object.assign({},a.pf),nt:Object.assign({},a.nt),tpref:a.tpref||'',ot,want:a.want!=null?a.want:((c.all.find(s=>s.id===me)||{}).want||0),dirty:false,ts:a.ts,base:a.base||null,nomemo:true};
}
const usualSel=(c,d)=>{const s=c.all.find(x=>x.id===me);if(!s||draft.days[d])return '';const r=resolveDay(s,d,draft);if(!r.asm)return '';return r.v==='X'?'X':r.v==='L'?'L':r.p==='am'?'M':r.p==='pm'?'P':'A'};
const selOf=d=>{const v=draft.days[d];if(!v)return '';if(v==='X'||v==='L')return v;return draft.tp[d]==='am'?'M':draft.tp[d]==='pm'?'P':'A'};
function setDay(d,k){
  if(k===''){delete draft.days[d];delete draft.tp[d];delete draft.nt[d];delete draft.pf[d];return}
  if(k==='X'){draft.days[d]='X';delete draft.tp[d]}
  else if(k==='L'){draft.days[d]='L';delete draft.tp[d]}
  else{draft.days[d]='A';delete draft.nt[d];if(k==='M')draft.tp[d]='am';else if(k==='P')draft.tp[d]='pm';else delete draft.tp[d]}
}
function normDay(old,d,s){const r=resolveDay(s,d,old);return {v:r.v==='O'?'A':r.v,p:r.p}}
async function logAvailChange(c,old,dr){
  const s=c.all.find(x=>x.id===dr.id);if(!s)return;
  const today=iso(new Date()),sum=[],conflicts=[];
  const ahead=[];for(let i=0;i<56;i++){const x=addDays(today,i),g=parse(x).getDay();if(g>0&&g<6)ahead.push(x)}
  const keys=Array.from(new Set(Object.keys(old.days||{}).concat(Object.keys(dr.days)).concat(ahead))).filter(d=>d>=today).sort();
  keys.forEach(d=>{
    const o=normDay(old,d,s),n=normDay(dr,d,s);
    if(o.v===n.v&&(o.p===n.p||n.v!=='A'))return;
    sum.push(dayLabel(d)+': '+dayLab(o.v,o.p)+' → '+dayLab(n.v,n.p)+(dr.nt[d]?' ("'+dr.nt[d]+'")':''));
    const asg=((roster[d]&&roster[d].a)||[]).find(x=>x.s===s.id);
    if(asg&&(n.v==='X'||n.v==='L'||!(n.p==='any'||inPart(asg.t,n.p))))conflicts.push({d,t:asg.t});
  });
  if(!sum.length)return;
  await save('chg/'+newId(),{k:'avail',s:s.id,sum:sum.slice(0,10).concat(sum.length>10?['+'+(sum.length-10)+' more']:[]),ts:Date.now(),st:'new'});
  for(const x of conflicts){
    await save('chg/'+newId(),{k:'cant',s:s.id,d:x.d,t:x.t,why:'Availability changed',note:(dr.nt[x.d]||'').slice(0,200),ts:Date.now(),st:'open',asked:{}});
    if(liveDate(c,x.d))await notify(colleagues(x.d,x.t,s.id),s.name+' can’t work the '+(x.t<12?'morning':'afternoon')+' shift ('+slotLabel(x.t)+') on '+dayLabel(x.d)+'. The manager is arranging cover.','cover');
  }
}
function usualSummary(c){
  const s=c.all.find(x=>x.id===me);if(!s||!draft)return '';
  const base=nextMonday(),names=['Mon','Tue','Wed','Thu','Fri'];
  const cells=names.map((n,k)=>{const d=addDays(base,k),r=resolveDay(s,d,draft),a=r.v==='X'?'–':r.v==='L'?'~':'✓'+(r.p==='am'?' AM':r.p==='pm'?' PM':'');return '<span class="chip '+(r.v==='X'?'gap':'ok')+'" style="margin:2px">'+n+' '+a+'</span>'});
  const src=draft.base?'your standing pattern (set '+esc(dayLabel(draft.base.from))+')':weeksIdx(draft).length?'the most common pattern over your last few weeks':'nothing yet, so you’re treated as not available until you fill it in';
  return '<div style="margin:6px 0 2px">'+cells.join('')+'</div><div class="sub">If you don’t fill in a week, we use your usual week: '+src+'. One short or sick week won’t change it.</div>';
}
function patternCard(c){
  const today=iso(new Date()),from=pat.from||today,ong=pat.span==='ongoing';
  const opt=(v,l,cur)=>'<option value="'+v+'"'+(String(cur)===String(v)?' selected':'')+'>'+l+'</option>';
  let h='<div style="margin-top:14px;background:#f8eef0;border-radius:16px;padding:14px"><h3>Your usual week</h3>'+usualSummary(c);
  h+='<div class="sub" style="margin:12px 0 10px">Changed? Say it once and it carries on every week until you change it again. Example: uni now takes Monday and Friday, so set those to Not available and the rest to All day.</div>';
  h+='<button class="btn pri" data-act="patall">Available all 5 days, every week</button><div class="sub" style="margin:10px 0 6px">Or set your week:</div>';
  [[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri']].forEach(x=>{
    h+='<div class="row" style="margin:5px 0"><b style="width:44px">'+x[1]+'</b><select data-pt="dow" data-w="'+x[0]+'" style="flex:1">'+opt('A','Available all day',pat.dow[x[0]])+opt('M','Mornings only',pat.dow[x[0]])+opt('P','Afternoons only',pat.dow[x[0]])+opt('X','Not available (e.g. uni)',pat.dow[x[0]])+opt('keep','Leave as it is',pat.dow[x[0]])+'</select></div>';
  });
  h+='<div class="row wrap" style="margin-top:10px"><label class="sub">Starting <input type="date" data-pt="from" value="'+esc(from)+'"></label><label class="sub">For <select data-pt="span">'+[['ongoing','Until I change it'],['4','4 weeks only'],['8','8 weeks only'],['12','12 weeks only'],['26','6 months only'],['date','Until a date']].map(o=>opt(o[0],o[1],pat.span)).join('')+'</select></label>'+(pat.span==='date'?'<label class="sub">Until <input type="date" data-pt="to" value="'+esc(pat.to)+'"></label>':'')+'</div>';
  if(!ong)h+='<div class="row wrap" style="margin-top:8px"><label class="sub">Repeat <select data-pt="every">'+opt('1','Every week',pat.every)+opt('2','Every 2nd week (alternate weeks)',pat.every)+'</select></label></div>';
  h+='<div class="row" style="margin-top:12px"><button class="btn" data-act="patapply">'+(ong?'Make this my usual week':'Apply to my calendar')+'</button></div><div class="sub" style="margin-top:6px">'+(ong?'Applies from the start date onward. Single days you’ve marked yourself still win, and you can block out leave below. Press Save to submit.':'This fills those dates only. Press Save to submit.')+'</div></div>';
  return h;
}
function applyPattern(dow,from,toDate,every){
  let n=0,x=from;const w0=parse(from),mon0=parse(addDays(from,-((w0.getDay()+6)%7)));
  for(let i=0;i<800&&x<=toDate;i++){
    const dt=parse(x),w=dt.getDay();
    if(w>=1&&w<=5){
      const wk=Math.floor(Math.round((dt-mon0)/86400000)/7);
      const code=dow[w];
      if(code&&code!=='keep'&&(every!==2||wk%2===0)){setDay(x,code);n++}
    }
    x=addDays(x,1);
  }
  return n;
}
function vAvail(c,dates){
  const today=iso(new Date());
  if(!availMonth)availMonth=today.slice(0,7);
  const yr=+availMonth.slice(0,4);
  let h='<div class="card"><h3>My availability</h3><div class="sub">Tap one choice for each day, then Save. You can plan the whole year ahead (weddings, holidays, appointments).</div>';
  if(isAdmin)h+='<div class="row" style="margin-top:8px"><label class="sub">Editing availability for <select data-ch="me"><option value="">Pick a person</option>'+c.staff.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===me?' selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label></div>';
  if(me&&draft){
    h+=patternCard(c)+'<div class="row" style="margin-top:14px"><div class="seg"><button class="'+(availView==='fort'?'on':'')+'" data-act="avview" data-v="fort">Next 2 weeks</button><button class="'+(availView==='year'?'on':'')+'" data-act="avview" data-v="year">Whole year</button></div></div>';
    let list=dates;
    if(availView==='year'){
      h+='<div class="row" style="margin-top:8px;justify-content:center"><button class="btn sm" data-act="avyear" data-v="-1">‹</button><b>'+yr+'</b><button class="btn sm" data-act="avyear" data-v="1">›</button></div><div class="months">'+MONTHS.map((m,i)=>{const ym=yr+'-'+pad(i+1);return '<button data-act="avmonth" data-v="'+ym+'" class="'+(availMonth===ym?'on':'')+'">'+m+'</button>'}).join('')+'</div>';
      list=monthDates(availMonth);
    }
    h+='<div class="row" style="margin:8px 0"><span class="sub">Fill all shown:</span><button class="btn sm" data-act="qf" data-v="A">All day</button><button class="btn sm" data-act="qf" data-v="X">Not available</button><button class="btn sm" data-act="qf" data-v="">Clear</button></div>';
    list.forEach((d,i)=>{
      if(availView==='fort'&&(i===0||i===5))h+='<div class="wk">Week '+(i?2:1)+'</div>';
      const sel=selOf(d),asmSel=sel?'':usualSel(c,d),pf=draft.pf[d];
      h+='<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="row"><b>'+esc(dayLabel(d))+'</b>'+(d<today?'<span class="sub">past</span>':'')+'<span class="sp"></span><button class="btn sm" data-act="pf" data-d="'+d+'" title="Preference">'+(pf==='+'?'★ Prefer to work':pf==='-'?'↓ Prefer not':'☆')+'</button></div><div class="seg seg5">'+[['A','All day'],['M','Morning'],['P','Afternoon'],['L','Other'],['X','Not available']].map(o=>'<button class="b'+o[0]+(sel===o[0]?' on':asmSel===o[0]?' asm':'')+'" data-act="day" data-d="'+d+'" data-v="'+o[0]+'">'+o[1]+'</button>').join('')+'</div>'+(asmSel?'<div class="sub" style="margin-top:4px">Assumed from your usual week. Tap to change.</div>':'');
      if(sel==='L'||sel==='X')h+='<input data-ch="nt" data-d="'+d+'" value="'+esc(draft.nt[d]||'')+'" placeholder="'+(sel==='L'?'e.g. have to leave by 2pm':'Reason (optional), e.g. wedding')+'" style="width:100%;margin-top:6px" maxlength="80">';
      h+='</div>';
    });
    h+='<div style="margin-top:14px;background:#f3f0ea;border-radius:14px;padding:12px"><h3>Block out dates for leave</h3><div class="sub">Away on leave? Pick the dates and apply. They’re marked not available. Then press Save.</div><div class="row" style="margin-top:8px"><label>From <input type="date" data-ch="bfrom" value="'+esc(blk.from)+'"></label><label>To <input type="date" data-ch="bto" value="'+esc(blk.to)+'"></label></div><div class="row" style="margin-top:8px"><input data-ch="bnote" value="'+esc(blk.note)+'" placeholder="Note (optional), e.g. leave" style="flex:1;min-width:120px" maxlength="80"><button class="btn" data-act="block">Apply</button></div></div>';
    h+='<div class="row" style="margin-top:12px"><label><input type="checkbox" data-ch="ot"'+(draft.ot?' checked':'')+'> I’m happy to do overtime or stay back if needed</label></div>';
    h+='<div class="row" style="margin-top:8px"><label>Usual preference <select data-ch="tpref"><option value="">No preference</option><option value="am"'+(draft.tpref==='am'?' selected':'')+'>Prefer mornings</option><option value="pm"'+(draft.tpref==='pm'?' selected':'')+'>Prefer afternoons</option></select></label><label>Days I’d like per week <input type="number" min="0" max="5" step="0.5" data-ch="want" value="'+esc((+draft.want||0)/2)+'"></label></div>';
    h+='<div class="sub" style="margin-top:6px">Availability is what you can do. Preferences (★ ↓ and the usual preference) are what you’d rather: the roster tries to match them but may not always.</div>';
    h+='<div class="row" style="margin-top:14px"><button class="btn pri" data-act="saveav">Save availability</button><span class="sub">'+(draft.dirty?'Unsaved changes':draft.ts?'Saved '+esc(new Date(draft.ts).toLocaleString('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit'})):'Not submitted yet')+'</span></div>';
  }
  h+='</div>';
  const mineH=h;h='';
  h+='<h2 style="margin-top:4px">Everyone’s availability</h2><div class="legend sub"><span><i class="dot" style="background:var(--av)"></i>Free</span><span><i class="dot" style="background:var(--ot)"></i>Free + OT</span><span><i class="dot" style="background:var(--warn)"></i>Other (see notes)</span><span>– Not available</span><span>· Not entered</span></div><div class="legend sub"><span>AM / PM = only that half</span><span>★ prefers to work</span><span>↓ prefers not</span></div>';
  h+='<div class="card grid"><table><tr><th></th>'+dates.map(d=>'<th>'+esc(parse(d).toLocaleDateString('en-AU',{weekday:'narrow'}))+'<br>'+parse(d).getDate()+'</th>').join('')+'<th>Want</th></tr>';
  const notes=[];
  c.staff.forEach(s=>{
    const a=avail[s.id];
    h+='<tr><td>'+esc(s.name)+(s.role?' <span class="sub">('+s.role+')</span>':'')+(hasEntries(s,dates)||s.role?'':' <span class="chip red">not entered</span>')+'</td>'+dates.map(d=>{
      const i=dayInfo(s,d,c.start,avail),v=i.v,entered=a&&a.days&&a.days[d];
      if(a&&a.nt&&a.nt[d]&&(v==='L'||v==='X'))notes.push(s.name+' · '+dayLabel(d)+': '+a.nt[d]);
      if(!entered&&!s.role&&!i.asm)return '<td class="U">·</td>';
      return '<td class="'+v+(i.asm?' asm':'')+'">'+(v==='X'?'–':v==='L'?'~':(v==='O'?'OT':'✓')+(i.p==='am'?' AM':i.p==='pm'?' PM':'')+(i.f==='+'?'★':i.f==='-'?'↓':''))+'</td>';
    }).join('')+'<td>'+(a&&a.want!=null?esc(a.want):esc(s.want))+'</td></tr>';
  });
  h+='<tr><td><b>Free</b></td>'+dates.map(d=>'<td><b>'+c.staff.filter(s=>isFree(statusOf(s,d,c.start,avail))).length+'</b></td>').join('')+'<td></td></tr></table></div>';
  if(notes.length)h+='<div class="card"><h3>Notes</h3>'+notes.map(n=>'<div class="sub" style="padding:2px 0">'+esc(n)+'</div>').join('')+'</div>';
  return h+mineH;
}
const fmtAgo=ts=>{const m=Math.round((Date.now()-ts)/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};
const chgList=()=>Object.keys(chg).map(k=>Object.assign({id:k},chg[k])).sort((a,b)=>(b.ts||0)-(a.ts||0));
const isOpen=x=>x.st==='open'||x.st==='new';
const openCount=()=>chgList().filter(isOpen).length;
const newId=()=>'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const nameOf=(c,id)=>{const s=c.all.find(x=>x.id===id);return s?s.name:'Someone'};
const msgText=(c,it,cand)=>'Hi '+String(cand.s.name).split(' ')[0]+', are you able to cover the '+slotLabel(it.t)+' shift on '+dayLabel(it.d)+'? Let me know either way, thanks!';
const myKey=()=>isAdmin?'admin':me;
const liveDate=(c,d)=>!!c.pub&&d<=c.pub&&d>=iso(new Date());
function colleagues(d,t,exclude){return ((roster[d]&&roster[d].a)||[]).filter(x=>(x.t<12)===(t<12)&&x.s!==exclude).map(x=>x.s)}
async function notify(to,txt,kind){to=Array.from(new Set(to)).filter(Boolean);if(!to.length)return;await save('ntf/'+newId(),{to,txt:String(txt).slice(0,300),ts:Date.now(),kind:kind||'info'});Store.mail(to,'Theatre Roster: '+String(txt).slice(0,60),mailShell('<p style="font-size:16px;margin:0">'+esc(String(txt).slice(0,300))+'</p>'))}
function myNtf(){const k=myKey();if(!k)return [];return Object.keys(ntf).map(i=>Object.assign({id:i},ntf[i])).filter(n=>(n.to||[]).indexOf(k)>=0).sort((a,b)=>b.ts-a.ts).slice(0,30)}
function unreadNtf(){const k=myKey();const last=(seen[k]&&seen[k].ts)||0;return myNtf().filter(n=>n.ts>last).length}
function reminders(c){
  const out=[],today=iso(new Date()),wk=nextMonday();
  if(isAdmin&&new Date().getHours()>=13){const base=isWorking(today,c)?today:addDays(today,-1),nx=nextWorking(base,c);if(!casesIn(nx))out.push('Enter the cases for '+(nx===addDays(today,1)?'tomorrow':dayLabel(nx))+' ('+dayLabel(nx)+'). The roster will tell you if the team is right.')}
  if(today>=addDays(wk,-4)&&today<wk){
    const wd=[0,1,2,3,4].map(i=>addDays(wk,i)),missing=c.staff.filter(s=>!s.role&&!hasEntries(s,wd));
    if(isAdmin&&missing.length)out.push('Availability missing for the week of '+dayLabel(wk)+': '+missing.map(s=>s.name).join(', '));
    else if(!isAdmin&&me&&missing.some(s=>s.id===me))out.push('You haven’t entered your availability for the week of '+dayLabel(wk)+'. Please add it in the Availability tab.');
  }
  return out;
}
const alertCount=c=>reminders(c).length+unreadNtf();

async function chgClick(a,b,c){
  const id=b.dataset.id,it=id?chg[id]:null;
  if(a==='cantopen'){call={open:true,who:isAdmin?'':me,d:b.dataset.d,reason:'Sick',note:'',touched:true};tab='cal';draw();window.scrollTo(0,0);return true}
  if(a==='callopen'){call={open:true,who:isAdmin?'':me,d:'',reason:'Sick',note:'',touched:false};draw();window.scrollTo(0,0);return true}
  if(a==='callcancel'){call.open=false;draw();return true}
  if(a==='calld'){call.d=b.dataset.v==='today'?iso(new Date()):nextWeekday(iso(new Date()));call.touched=true;draw();return true}
  if(a==='callgo'){
    const who=isAdmin?call.who:me,d=callDate(),x=who&&d?((roster[d]&&roster[d].a)||[]).find(z=>z.s===who):null;
    if(!x){toast('Not rostered that day');return true}
    if(chgList().some(q=>q.k==='cant'&&q.s===who&&q.d===d&&isOpen(q))){toast('Already logged');return true}
    await save('chg/'+newId(),{k:'cant',s:who,d,t:x.t,why:call.reason,note:call.note.slice(0,200),ts:Date.now(),st:'open',asked:{}});
    if(liveDate(c,d))await notify(colleagues(d,x.t,who),nameOf(c,who)+' can\u2019t work the '+(x.t<12?'morning':'afternoon')+' shift ('+slotLabel(x.t)+') on '+dayLabel(d)+'. The manager is arranging cover.','cover');
    if(!isAdmin)await notify(['admin'],nameOf(c,who)+' can\u2019t work '+dayLabel(d)+' ('+slotLabel(x.t)+'). Reason: '+call.reason+(call.note?' \u00b7 '+call.note.slice(0,80):''),'cover');
    call={open:false,who:'',d:'',reason:'Sick',note:'',touched:false};
    toast(isAdmin?'Logged. Who to ask next is at the top of the Calendar.':'Sent. Please message '+pmFirst(c)+' directly too.');draw();window.scrollTo(0,0);return true;
  }
  if(a==='markread'){const k=myKey();if(k)await save('seen/'+k,{ts:Date.now()});return true}
  if(a==='ycancel'){yesFor=null;draw();return true}
  if(!it)return false;
  if(a==='seen'||a==='close'){await save('chg/'+id,Object.assign({},it,{st:a==='seen'?'seen':'closed'}));return true}
  if(a==='msg'){const k=id+':'+b.dataset.s;msgKey=msgKey===k?'':k;draw();return true}
  if(a==='ask'||a==='no'){const asked=Object.assign({},it.asked||{});asked[b.dataset.s]=a==='ask'?'asked':'no';await save('chg/'+id,Object.assign({},it,{asked}));return true}
  if(a==='yes'){yesFor={id,s:b.dataset.s,t:it.t};draw();return true}
  if(a==='yesgo'&&yesFor){
    const cand=yesFor.s,nt=+yesFor.t;yesFor=null;
    const cur=((roster[it.d]&&roster[it.d].a)||[]).filter(x=>x.s!==it.s&&x.s!==cand);cur.push({s:cand,t:nt});
    await save('roster/'+it.d,{a:cur});
    const asked=Object.assign({},it.asked||{});asked[cand]='yes';
    await save('chg/'+id,Object.assign({},it,{st:'covered',by:cand,ct:nt,asked}));
    if(liveDate(c,it.d)){
      await notify(colleagues(it.d,it.t,it.s).concat(colleagues(it.d,nt,it.s)).filter(x=>x!==cand),nameOf(c,cand)+' is covering '+nameOf(c,it.s)+'’s shift on '+dayLabel(it.d)+', starting '+slotLabel(nt)+'.','cover');
      await notify([cand],'You’ve been added to '+dayLabel(it.d)+', '+slotLabel(nt)+'.','roster');
      await notify([it.s],'Your '+slotLabel(it.t)+' shift on '+dayLabel(it.d)+' has been covered.','cover');
    }
    toast(nameOf(c,cand)+' is now on the roster, and staff have been alerted');return true;
  }
  return false;
}

function cantForm(c,rep){
  const today=iso(new Date());
  const mine=Object.keys(roster).sort().filter(d=>d>=today).map(d=>{const x=((roster[d]&&roster[d].a)||[]).find(z=>z.s===rep);return x?{d,t:x.t}:null}).filter(Boolean);
  if(!rep)return '<div class="sub">Pick a name first.</div>';
  if(!mine.length)return '<div class="sub">No upcoming rostered shifts found.</div>';
  let h='';
  mine.forEach(m=>{
    const reported=chgList().some(x=>x.k==='cant'&&x.s===rep&&x.d===m.d&&isOpen(x));
    h+='<div class="ad row"><b>'+esc(dayLabel(m.d))+'</b><span class="sub sp">'+slotLabel(m.t)+'</span>'+(reported?'<span class="chip warn">Logged</span>':'<button class="btn sm" data-act="cantopen" data-d="'+m.d+'" data-t="'+m.t+'">Can’t make it</button>')+'</div>';
    if(cantFor&&cantFor.d===m.d&&cantFor.t===m.t&&!reported)h+=cantBox();
  });
  return h;
}

function candRows(c,it){
  const R=rankCover(c,it.d,it.t,it.s,avail,roster),asked=it.asked||{};
  let h='';
  if(!R.ranked.length)h+='<div class="sub" style="margin:8px 0">Nobody has marked themselves free for this shift.</div>';
  R.ranked.forEach((r,i)=>{
    const st=asked[r.s.id],k=it.id+':'+r.s.id,yf=yesFor&&yesFor.id===it.id&&yesFor.s===r.s.id,sid=esc(r.s.id);
    h+='<div class="cand" style="'+(st==='no'?'opacity:.45':'')+'"><div class="rk">'+(i+1)+'</div><div class="sp"><b>'+esc(r.s.name)+'</b>'+(r.s.phone?' <span class="sub">'+esc(r.s.phone)+'</span>':'')+'<div>'+r.rs.map(x=>'<span class="chip '+x.k+'">'+esc(x.t)+'</span>').join('')+'</div><div class="sub">'+r.cnt+' of '+r.want+' days this fortnight ('+(r.cnt*8)+'h)</div>';
    h+='<div class="row wrap" style="margin-top:8px"><button class="btn sm ghost" data-act="msg" data-id="'+it.id+'" data-s="'+sid+'">Message</button><button class="btn sm'+(st==='asked'?' pri':' ghost')+'" data-act="ask" data-id="'+it.id+'" data-s="'+sid+'">'+(st==='asked'?'Asked ✓':'Asked')+'</button><button class="btn sm" data-act="yes" data-id="'+it.id+'" data-s="'+sid+'">Said yes</button><button class="btn sm ghost" data-act="no" data-id="'+it.id+'" data-s="'+sid+'">Said no</button></div>';
    if(yf)h+='<div class="row wrap" style="margin-top:8px"><label class="sub">Starts at <select data-ch="yt">'+SLOTS.map(t=>'<option value="'+t+'"'+(+yesFor.t===t?' selected':'')+'>'+slotLabel(t)+'</option>').join('')+'</select></label><button class="btn sm pri" data-act="yesgo" data-id="'+it.id+'">Confirm and alert staff</button><button class="btn sm ghost" data-act="ycancel">Cancel</button></div>';
    if(msgKey===k)h+='<textarea readonly onclick="this.select()" style="margin-top:8px">'+esc(msgText(c,it,r))+'</textarea><div class="sub">Tap the text to select it, then copy and send it however you normally message them.</div>';
    h+='</div></div>';
  });
  if(R.blocked.length)h+='<details style="margin-top:8px"><summary>Not available ('+R.blocked.length+')</summary>'+R.blocked.map(x=>'<div class="sub" style="padding:2px 0">'+esc(x.s.name)+' · '+esc(x.why)+'</div>').join('')+'</details>';
  return h;
}

function attention(c,open){
  let h='';
  open.forEach(it=>{
    h+='<div class="card" style="border-left:5px solid var(--bad)"><div class="row wrap"><b>'+esc(nameOf(c,it.s))+'</b><span class="sub">can’t make '+esc(dayLabel(it.d))+' '+slotLabel(it.t)+'</span><span class="sp"></span><span class="sub">'+fmtAgo(it.ts)+'</span><button class="x" data-act="close" data-id="'+it.id+'" aria-label="Dismiss">✕</button></div><div class="sub" style="margin-top:2px">'+esc(it.why||'')+(it.note?' · '+esc(it.note):'')+'</div><h3 style="margin-top:12px">Who to ask, best first</h3>'+candRows(c,it)+'</div>';
  });
  return h;
}
function usualCases(d){
  const g=parse(d).getDay(),today=iso(new Date()),arr=Object.keys(cases).filter(k=>k<today&&parse(k).getDay()===g&&casesIn(k)).sort().reverse().slice(0,8);
  if(arr.length<3)return null;
  const med=a=>{const s=a.slice().sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2)};
  const cz=arr.map(k=>casesOf(cases[k],C()));
  return {am:med(cz.map(x=>x.am)),pm:med(cz.map(x=>x.pm)),n:arr.length};
}
function gapItems(c){
  const today=iso(new Date()),out=[];
  for(let i=0;i<=21;i++){
    const d=addDays(today,i);if(!isWorking(d,c))continue;
    if(!((roster[d]&&roster[d].a)||[]).length)continue;
    let cz,src;
    if(casesIn(d)){cz=casesOf(cases[d],c);src='entered'}
    else{const us=usualCases(d);if(!us)continue;cz={am:us.am,pm:us.pm,n:us.am+us.pm,est:false};src='usual'}
    const R=Object.assign({},dayReport(d,c),{req:requiredFor(cz,c)});
    ['am','pm'].forEach(p=>{
      const st=partStats(R,p);if(!st.short)return;
      const dm=chg['dm_'+d+'_'+p];if(dm&&st.short<=(+dm.n||0))return;
      out.push({d,p,short:st.short,need:st.need,got:st.got,src,cases:p==='am'?cz.am:cz.pm,R});
    });
  }
  return out;
}
function gapCard(c,g){
  const wd=parse(g.d).toLocaleDateString('en-AU',{weekday:'long'});
  return '<div class="card" style="border-left:5px solid var(--warn)"><div class="row wrap"><b>'+esc(dayLabel(g.d))+' · '+(g.p==='am'?'☀ morning':'☾ afternoon')+'</b>'+(g.got<g.need?'<span class="chip warn">needs '+(g.need-g.got)+' more</span>':'<span class="chip warn">wrong start times</span>')+'<span class="sp"></span><button class="x" data-act="gapdismiss" data-d="'+g.d+'" data-p="'+g.p+'" data-n="'+g.short+'" aria-label="Dismiss">✕</button></div><div class="sub" style="margin-top:4px">'+(g.src==='usual'?'Usual '+esc(wd)+' is about '+g.cases+' '+(g.p==='am'?'morning':'afternoon')+' cases':g.cases+' '+(g.p==='am'?'morning':'afternoon')+' cases entered')+'. That needs '+g.need+' people and '+(g.got===1?'1 is':g.got===0?'none are':g.got+' are')+' rostered'+(g.got>=g.need?', but the start times don’t match.':'.')+'</div>'+slotHints(g.R,g.p)+'<div class="row" style="margin-top:10px"><button class="btn sm" data-act="homeopen" data-d="'+g.d+'">Find someone</button></div></div>';
}
function capItems(c){
  const today=iso(new Date()),out=[];
  for(let i=0;i<=21;i++){
    const d=addDays(today,i),asg=(roster[d]&&roster[d].a)||[];
    capIssues(asg).forEach(x=>{const dm=chg['dm_'+d+'_c'+x.t];if(dm&&x.have<=(+dm.n||0))return;out.push(Object.assign({d},x,{who:asg.filter(z=>z.t===x.t).map(z=>nameOf(c,z.s))}))});
  }
  return out;
}
function capCard(c,g){
  return '<div class="card" style="border-left:5px solid var(--warn)"><div class="row wrap"><b>'+esc(dayLabel(g.d))+' · too many at '+slotLabel(g.t)+'</b><span class="chip warn">'+g.have+' rostered, max '+g.max+'</span><span class="sp"></span><button class="x" data-act="gapdismiss" data-d="'+g.d+'" data-p="c'+g.t+'" data-n="'+g.have+'" aria-label="Dismiss">✕</button></div><div class="sub" style="margin-top:4px">'+g.who.map(esc).join(', ')+' are all on '+slotLabel(g.t)+'. Only '+g.max+' are needed at that start time, so move one to another start.</div><div class="row" style="margin-top:10px"><button class="btn sm" data-act="homeopen" data-d="'+g.d+'">Fix this day</button></div></div>';
}
const needCount=c=>chgList().filter(x=>x.k==='cant'&&isOpen(x)).length+gapItems(c).length+capItems(c).length;

function bellPanel(c){
  const k=myKey(),list=myNtf(),last=(seen[k]&&seen[k].ts)||0,rem=reminders(c);
  let h='<div class="card"><div class="row"><h3>Notifications</h3><span class="sp"></span>'+(list.length?'<button class="btn sm" data-act="markread">Mark all read</button>':'')+'<button class="btn sm ghost" data-act="bell">Close</button></div>';
  if(!isAdmin&&!me)h+='<div class="sub" style="margin-top:8px">Pick your name to see your notifications.</div><div style="margin-top:8px"><select data-ch="me"><option value="">Who are you?</option>'+staffOpts(c)+'</select></div>';
  rem.forEach(r=>{h+='<div class="banner" style="margin:10px 0 0">'+esc(r)+'</div>'});
  if(!list.length&&!rem.length&&(isAdmin||me))h+='<div class="sub" style="margin-top:8px">Nothing new.</div>';
  list.forEach(n=>{h+='<div class="ad"><div>'+(n.ts>last?'<span class="chip info">new</span> ':'')+esc(n.txt)+'</div><div class="sub">'+fmtAgo(n.ts)+'</div></div>'});
  return h+'</div>';
}

function addBox(c,d,t,n){
  const here=new Set(((roster[d]&&roster[d].a)||[]).map(x=>x.s));
  const opts=c.all.filter(s=>!here.has(s.id)).map(s=>{
    const i=dayInfo(s,d,c.start,avail),ok=isFree(i.v)&&slotOK(s,d,t,c.start,avail);
    return {s,v:i.v,ok,rank:s.off?9:ok?0:i.v==='L'?1:isFree(i.v)?2:3,f:i.f,note:(avail[s.id]&&avail[s.id].nt&&avail[s.id].nt[d])||''};
  }).sort((a,b)=>a.rank-b.rank||(b.f==='+')-(a.f==='+')||n[a.s.id]-n[b.s.id]);
  const lab=o=>o.s.name+' · '+(o.s.off?'inactive (manager override)':o.ok?(o.v==='O'?'free + OT':'free'):o.v==='L'?'limited'+(o.note?': '+o.note:''):isFree(o.v)?'wrong half':'not available')+(o.f==='+'?' ★':o.f==='-'?' ↓':'')+' · '+n[o.s.id]+'/'+((avail[o.s.id]&&avail[o.s.id].want!=null)?avail[o.s.id].want:o.s.want)+' days';
  return '<div data-addbox style="background:#f3f0ea;border-radius:14px;padding:10px;margin:2px 0 8px"><div class="sub" style="margin-bottom:6px">Add to the '+slotLabel(t)+' shift, best matches first</div><div class="row wrap"><select style="flex:1;min-width:180px">'+opts.map(o=>'<option value="'+esc(o.s.id)+'">'+esc(lab(o))+'</option>').join('')+'</select><button class="btn sm pri" data-act="plusadd" data-d="'+d+'" data-t="'+t+'">Add</button><button class="btn sm ghost" data-act="plusx">Cancel</button></div></div>';
}

function slotHints(R,p){
  p=p||'all';const out=[];SLOTS.filter(t=>inPart(t,p)).forEach(t=>{const d=R.have[t]-R.req[t];if(d<0)out.push('<b>'+(-d)+' more at '+slotLabel(t)+'</b>');else if(d>0)out.push('<b>'+d+' fewer at '+slotLabel(t)+'</b>')});
  if(R.cap&&R.cap.length)R.cap.filter(x=>inPart(x.t,p)).forEach(x=>out.unshift('<b>'+x.have+' people at '+slotLabel(x.t)+', but the most is '+x.max+'</b>'));
  return out.length&&(partStats(R,p).short||R.cap.filter(x=>inPart(x.t,p)).length)?'<div class="sub" style="margin-top:6px">Needs: '+out.join(' · ')+'</div>':'';
}
function sugLine(R){
  const a=partStats(R,'am'),p=partStats(R,'pm');
  const line=(ico,lab,cs,st)=>'<div class="sub" style="margin-top:5px">'+ico+' <b>'+lab+'</b>: '+cs+' cases → needs <b>'+st.need+'</b>, rostered <b>'+st.got+'</b> '+(st.short?(st.got<st.need?'<span class="chip warn">add '+(st.need-st.got)+'</span>':'<span class="chip warn">wrong start times</span>'):st.over?'<span class="chip info">'+st.over+' extra</span>':'<span class="chip ok">covered</span>')+'</div>';
  let h=line('☀','Morning',R.am,a)+line('☾','Afternoon',R.pm,p)+slotHints(R,'all');
  if(a.over>0&&p.short>0)h+='<div class="banner pri" style="margin:8px 0 0;padding:8px 12px">Morning has '+a.over+' more than needed and the afternoon is short. Consider moving someone to the afternoon.</div>';
  else if(p.over>0&&a.short>0)h+='<div class="banner pri" style="margin:8px 0 0;padding:8px 12px">Afternoon has '+p.over+' more than needed and the morning is short. Consider moving someone to the morning.</div>';
  return h;
}

function fairness(c,dates,n){
  let h='<div class="card grid"><table><tr><th></th><th>Type</th><th>Want (fortnight)</th><th>Rostered</th><th>Free</th><th>OT</th><th>Prefers</th><th></th></tr>';
  c.staff.forEach(s=>{
    const a=avail[s.id],want=a&&a.want!=null?+a.want:(+s.want||0);
    const free=dates.filter(d=>isFree(statusOf(s,d,c.start,avail))).length,ot=dates.filter(d=>statusOf(s,d,c.start,avail)==='O').length;
    let flag='<span class="chip ok">OK</span>';
    if(!s.role){
      if(!hasEntries(s,dates))flag='<span class="chip red">No availability</span>';
      else if(!hasExplicit(s,dates)&&n[s.id]>=want)flag='<span class="chip info">Using usual week</span>';
      else if(n[s.id]<want&&free>n[s.id])flag='<span class="chip info">Under-used (+'+Math.min(want-n[s.id],free-n[s.id])+')</span>';
      else if(n[s.id]>want)flag='<span class="chip warn">Over target</span>';
      else if(n[s.id]<want)flag='<span class="chip warn">Not enough free days</span>';
    }
    h+='<tr><td>'+esc(s.name)+'</td><td>'+esc(typeName[s.type]||'')+'</td><td>'+want+'</td><td><b>'+n[s.id]+'</b></td><td>'+free+'</td><td>'+ot+'</td><td>'+(a&&a.tpref==='am'?'Mornings':a&&a.tpref==='pm'?'Afternoons':'–')+'</td><td>'+flag+'</td></tr>';
  });
  return h+'</table></div>';
}



function rosterWarnings(c,dates){
  const out=[],n={};c.staff.forEach(x=>n[x.id]=0);
  const wkc={};
  dates.forEach((d,i)=>{
    const asg=effAsg(d);if(!asg.length)return;
    capIssues(asg).forEach(x=>out.push({sev:2,t:dayLabel(d)+': '+x.have+' people on '+slotLabel(x.t)+' (most is '+x.max+').'}));
    const R=dayReport(d,c,asg);
    ['am','pm'].forEach(p=>{const st=partStats(R,p);
      if(st.got<st.need)out.push({sev:3,t:dayLabel(d)+' '+(p==='am'?'morning':'afternoon')+': '+st.got+' rostered but about '+st.need+' needed'+(R.est?' (estimate for ~'+R.n+' cases)':' for '+(p==='am'?R.am:R.pm)+' cases')+'.'});
      else if(st.short)out.push({sev:1,t:dayLabel(d)+' '+(p==='am'?'morning':'afternoon')+': right number of people, but start times are off. '+slotHints(R,p).replace(/<[^>]+>/g,'').replace('Needs: ','Needs ')+'.'});
      else if(st.over>=2)out.push({sev:1,t:dayLabel(d)+' '+(p==='am'?'morning':'afternoon')+': '+st.over+' more than needed.'})});
    asg.forEach(x=>{
      const sf=c.all.find(z=>z.id===x.s);if(!sf)return;n[x.s]=(n[x.s]||0)+1;
      const k=x.s+(i<5?'a':'b');wkc[k]=(wkc[k]||0)+1;
      const v=statusOf(sf,d,c.start,avail);
      if(!sf.role&&(v==='X'||v==='L'))out.push({sev:2,t:sf.name+' is rostered on '+dayLabel(d)+' but isn’t available.'});
      else if(!sf.role&&!slotOK(sf,d,x.t,c.start,avail))out.push({sev:1,t:sf.name+' is on the '+(x.t<12?'morning':'afternoon')+' of '+dayLabel(d)+' but is only available '+(x.t<12?'afternoons':'mornings')+'.'});
      if(sf.off)out.push({sev:1,t:sf.name+' is marked inactive but is on '+dayLabel(d)+'.'});
    });
  });
  Object.keys(wkc).forEach(k=>{if(wkc[k]>5){const sf=c.all.find(z=>z.id===k.slice(0,-1));out.push({sev:2,t:(sf?sf.name:'Someone')+' is on '+wkc[k]+' days in one week.'})}});
  c.staff.filter(x=>!x.role).forEach(sf=>{
    const a=avail[sf.id],want=a&&a.want!=null?+a.want:(+sf.want||0),free=dates.filter(d=>isFree(statusOf(sf,d,c.start,avail))).length;
    if(dates.some(d=>effAsg(d).length)){
      if(n[sf.id]<want-1&&free>n[sf.id]+1)out.push({sev:1,t:sf.name+' has only '+n[sf.id]+' day'+(n[sf.id]===1?'':'s')+' but wants '+want+' and is free for '+free+'.'});
      if(n[sf.id]>want+1)out.push({sev:1,t:sf.name+' has '+n[sf.id]+' days, '+(n[sf.id]-want)+' over what they want ('+want+').'});
    }
  });
  return out.sort((x,y)=>y.sev-x.sev);
}
function checkCard(c,dates){
  const w=rosterWarnings(c,dates);if(!w.length)return dates.some(d=>effAsg(d).length)?'<div class="banner" style="margin:10px 0 0">Roster check: nothing to flag.</div>':'';
  return '<details class="card" open style="border-left:5px solid var(--warn)"><summary><b>Roster check</b> <span class="chip warn">'+w.length+' to look at</span></summary>'+w.slice(0,14).map(x=>'<div class="sub" style="padding:4px 0;color:var(--ink)">'+(x.sev>=2?'<span class="chip red">fix</span> ':'<span class="chip info">check</span> ')+esc(x.t)+'</div>').join('')+(w.length>14?'<div class="sub">…and '+(w.length-14)+' more</div>':'')+'</details>';
}
function helpCard(c){
  if(!helpNote)return '';
  const L=helpNote.lines,by={};L.forEach(l=>{(by[l.d]=by[l.d]||[]).push(l)});
  return '<div class="savebar" style="position:static;margin:10px 0"><b>'+(helpNote.mode==='next'?'Next fortnight built':'People added where short')+'</b><div class="sub" style="color:var(--ink);margin-top:4px">'+(L.length?L.length+' shift'+(L.length===1?'':'s')+' placed. Here’s why each person was picked:':'Nothing needed adding.')+'</div>'+Object.keys(by).sort().map(d=>'<div style="margin-top:8px"><b class="sub" style="color:var(--ink)">'+esc(dayLabel(d))+'</b>'+by[d].sort((a,b)=>a.t-b.t).map(l=>'<div class="sub" style="padding:1px 0"><b>'+esc(l.n)+'</b> '+slotLabel(l.t)+': '+esc(l.w)+'</div>').join('')+'</div>').join('')+(helpNote.gaps.length?'<div class="banner" style="margin:10px 0 0">Nobody free to cover: '+helpNote.gaps.map(g=>esc(dayLabel(g.d))+' '+slotLabel(g.t)+(g.n>1?' ×'+g.n:'')).join(', ')+'.</div>':'')+'</div>';
}
const wkj=a=>a.slice(0,5).join('')+'<td class="gapc"></td>'+a.slice(5).join('');
function vSheet(c,dates){
  const dirty=Object.keys(sheetDraft).length;
  let h='';
  if(isAdmin){
    h+='<div class="card"><div class="row wrap"><button class="btn pri sm" data-act="auto" data-v="next">Build next fortnight</button><button class="btn sm" data-act="auto" data-v="gaps">Add people where short</button><button class="btn sm ghost" data-act="clear">Clear</button><span class="sp"></span><button class="btn sm" data-act="pub">Publish</button></div><div class="row wrap" style="margin-top:8px"><button class="btn sm pri" data-act="shareimg" data-v="share">Share roster as image</button><button class="btn sm" data-act="shareimg" data-v="save">Save image</button><button class="btn sm ghost" data-act="shareimg" data-v="copy">Copy image</button></div><div class="sub" style="margin-top:8px">'+(c.pub?'Published through '+esc(dayLabel(c.pub))+'.':'Not published yet.')+' Tap a cell to change someone’s start time, then Save.</div></div>';
  }
  if(isAdmin)h+=helpCard(c);
  const offN=c.all.filter(s=>s.off).length,people=c.all.filter(s=>!s.off||showOff||dates.some(d=>effAsg(d).some(x=>x.s===s.id))).sort((a,b)=>a.name.localeCompare(b.name)),am=people.filter(s=>s.role==='AM'),pm=people.filter(s=>s.role==='PM'),mid=people.filter(s=>!s.role);
  const cell=(s,d,i)=>{
    const x=effAsg(d).find(z=>z.s===s.id),v=statusOf(s,d,c.start,avail),sep=i===5?' style=""':'',edit=isAdmin?' data-act="cyc" data-s="'+esc(s.id)+'" data-d="'+d+'"':'';
    const chg0=sheetDraft[d]&&JSON.stringify((((roster[d]&&roster[d].a)||[]).find(z=>z.s===s.id))||null)!==JSON.stringify(x||null);
    if(x){const bad=(v==='X'||v==='L'||!slotOK(s,d,x.t,c.start,avail));return '<td class="sc '+(x.t<12?'am':'pm')+(bad?' bad':'')+(v==='O'?' otb':'')+(chg0?' edited':'')+'"'+sep+edit+'>'+fmtH(x.t)+'</td>'}
    return '<td class="'+(v==='X'?'na':'fr')+(chg0?' edited':'')+'"'+sep+edit+'>'+(v==='X'?'':'·')+'</td>';
  };
  const row=s=>'<tr'+(s.id===me?' class="me"':'')+(s.off?' class="off"':'')+'><td class="nm">'+esc(s.name)+'</td>'+wkj(dates.map((d,i)=>cell(s,d,i)))+'</tr>';
  const grp=t=>'<tr class="grp"><td colspan="'+(dates.length+1)+'">'+t+'</td></tr>';
  h+='<div class="card sheet"><table><tr><th class="nm"></th>'+wkj(dates.map((d,i)=>'<th data-act="cday" data-d="'+d+'" style="cursor:pointer;'+(i===5?'':'')+(d===calSel?'background:#f3dfe4':'')+'">'+esc(parse(d).toLocaleDateString('en-AU',{weekday:'short'}))+'<br>'+parse(d).getDate()+'</th>'))+'</tr>';
  h+=am.map(row).join('')+mid.map(row).join('')+pm.map(row).join('');
  const tot=part=>'<tr class="tot"><td class="nm">'+(part==='am'?'☀ Morning staff':'☾ Afternoon staff')+'</td>'+wkj(dates.map(d=>{const R=dayReport(d,c,effAsg(d)),s=partStats(R,part);return '<td class="'+(isAdmin&&!R.est&&s.short?'lo':'')+'">'+s.got+'</td>'}))+'</tr>';
  h+=tot('am')+tot('pm');
  h+='</table></div>'+(isAdmin&&offN?'<div class="row" style="margin:6px 0"><button class="btn sm ghost" data-act="showoff">'+(showOff?'Hide':'Show')+' inactive staff ('+offN+')</button></div>':'')+'<div class="legend" style="margin:8px 4px 2px"><span><i class="dot" style="background:#fbd98a"></i>Morning start</span><span><i class="dot" style="background:#dcbfe8"></i>Afternoon start</span><span><i class="dot" style="background:#fbd98a;border-radius:3px;width:12px;height:12px;box-shadow:0 0 0 2.5px #1f7a4d"></i>&nbsp;Can do overtime</span><span><i class="dot" style="background:#C4320A"></i>Rostered but unavailable</span></div><div class="sub" style="margin:4px 4px 6px">Tap a date to open that day. The number is the start hour.</div>';
  if(isAdmin)h+=checkCard(c,dates);
  if(dirty){
    const live=Object.keys(sheetDraft).some(d=>liveDate(c,d));
    h+='<div class="savebar"><div class="sub" style="color:var(--ink)">'+(helpNote?'<b>Suggested roster ready.</b> Edit anything above, then save.':'<b>Unsaved changes.</b>')+' '+(live?'Staff affected will be alerted when you save.':'Nobody is alerted until it’s published.')+'</div><div class="row" style="margin-top:8px"><button class="btn pri" data-act="savesheet">Save changes</button><button class="btn ghost" data-act="discardsheet">Discard</button></div></div>';
  }
  if(isAdmin){
    const n=counts(c);
    h+='<h2>Fairness this fortnight</h2>'+fairness(c,dates,n);
    const ot=c.staff.map(s=>({s,h:dates.reduce((t,d)=>{const a=acts[d+'_'+s.id];return t+(a&&a.en-a.st>8?a.en-a.st-8:0)},0)})).filter(x=>x.h>0);
    if(ot.length)h+='<div class="card"><h3>Overtime logged</h3>'+ot.map(x=>'<div class="sub" style="padding:2px 0">'+esc(x.s.name)+': +'+fmtDur(x.h)+'</div>').join('')+'</div>';
    const done=chgList().filter(x=>x.k!=='dismiss'&&(x.k==='avail'||!isOpen(x))).slice(0,8);
    if(done.length)h+='<h2>Recent changes</h2><div class="card">'+done.map(it=>'<div class="sub" style="padding:3px 0">'+(it.k==='avail'?esc(nameOf(c,it.s))+' changed availability':esc(nameOf(c,it.s))+' · '+esc(dayLabel(it.d))+' '+slotLabel(it.t)+' · '+(it.st==='covered'?'covered by '+esc(nameOf(c,it.by))+(it.ct?' ('+slotLabel(it.ct)+')':''):'closed'))+'</div>').join('')+'</div>';
  }
  return h;
}
async function saveSheet(c){
  const ds=Object.keys(sheetDraft).sort(),msgs={};
  for(const d of ds){
    const old=(roster[d]&&roster[d].a)||[],nw=sheetDraft[d];
    await save('roster/'+d,{a:nw});
    if(liveDate(c,d)){
      const om={},nm={};old.forEach(x=>om[x.s]=x);nw.forEach(x=>nm[x.s]=x);
      for(const s of Array.from(new Set(Object.keys(om).concat(Object.keys(nm))))){
        let t=null;
        if(!om[s]&&nm[s])t='You’ve been added to '+dayLabel(d)+', '+slotLabel(nm[s].t)+'.';
        else if(om[s]&&!nm[s])t='You’ve been taken off '+dayLabel(d)+', '+slotLabel(om[s].t)+'.';
        else if(om[s].t!==nm[s].t)t='Your shift on '+dayLabel(d)+' changed to '+slotLabel(nm[s].t)+'.';
        if(t&&s!==me)(msgs[s]=msgs[s]||[]).push(t);
      }
    }
  }
  let n=0;
  for(const s of Object.keys(msgs)){await notify([s],msgs[s].join(' '),'roster');n++}
  sheetDraft={};helpNote=null;
  toast('Roster saved'+(n?', '+n+' staff alerted':''));
}
function chartScatter(c,pts,h){
  const ps=pts.filter(p=>p.n!=null&&p.h>0);
  const W=340,H=210,L=30,R=10,T=10,B=28,xmin=0,xmax=Math.max(40,Math.max.apply(null,ps.map(p=>p.n+4).concat([0])));
  const ymax=Math.max(8,Math.max.apply(null,ps.map(p=>p.h+1).concat([0])),halfTotal(h,xmax,c)+1);
  const X=v=>L+(v-xmin)/(xmax-xmin)*(W-L-R),Y=v=>H-B-v/ymax*(H-B-T);
  let s='<svg viewBox="0 0 '+W+' '+H+'" class="chart">';
  for(let y=0;y<=ymax;y+=(ymax>10?2:1))s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(y)+'" y2="'+Y(y)+'" stroke="#e6e2d9"/><text x="'+(L-6)+'" y="'+(Y(y)+3)+'" text-anchor="end">'+y+'</text>';
  for(let x=0;x<=xmax;x+=10)s+='<text x="'+X(x)+'" y="'+(H-10)+'" text-anchor="middle">'+x+'</text>';
  s+='<text x="'+((L+W-R)/2)+'" y="'+(H-0)+'" text-anchor="middle">cases</text>';
  let pl='';for(let x=xmin;x<=xmax;x++)pl+=X(x).toFixed(1)+','+Y(halfTotal(h,x,c)).toFixed(1)+' ';
  s+='<polyline points="'+pl+'" fill="none" stroke="#A6192E" stroke-width="2" stroke-dasharray="5 4"/>';
  const sw=sweetSpot(ps,c,h).filter(x=>x.est!=null);
  if(sw.length>1)s+='<polyline points="'+sw.map(x=>X(x.b+2.5).toFixed(1)+','+Y(x.est).toFixed(1)).join(' ')+'" fill="none" stroke="#373A36" stroke-width="2.5"/>';
  sw.forEach(x=>{s+='<rect x="'+(X(x.b+2.5)-4)+'" y="'+(Y(x.est)-4)+'" width="8" height="8" transform="rotate(45 '+X(x.b+2.5)+' '+Y(x.est)+')" fill="#373A36"/>'});
  ps.forEach(p=>{const col=p.v==='few'?'#C4320A':p.v==='many'?'#f59e0b':'#1b7f5c';s+='<circle cx="'+X(p.n)+'" cy="'+Y(p.h)+'" r="5.5" fill="'+col+'" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>'});
  return s+'</svg><div class="legend"><span><i class="dot" style="background:#C4320A"></i>Too few</span><span><i class="dot" style="background:#1b7f5c"></i>About right</span><span><i class="dot" style="background:#f59e0b"></i>Too many</span><span><i class="dot" style="background:#A6192E"></i>Current plan</span><span><i class="dot" style="background:#373A36"></i>Sweet spot</span></div>';
}
function chartTrend(pts){
  if(!pts.length)return '<div class="sub">No ratings yet.</div>';
  const W=340,H=150,L=8,R=8,T=16,B=22,n=pts.length,bw=(W-L-R)/Math.max(n,8),mid=(T+H-B)/2,amp=(H-B-T)/2-4;
  let s='<svg viewBox="0 0 '+W+' '+H+'" class="chart"><line x1="'+L+'" x2="'+(W-R)+'" y1="'+mid+'" y2="'+mid+'" stroke="#e6e2d9"/><text x="'+L+'" y="'+(T-5)+'">Too many</text><text x="'+L+'" y="'+(H-B+12)+'">Too few</text><text x="'+(W-R)+'" y="'+(mid-4)+'" text-anchor="end">Right</text>';
  let line='';
  pts.forEach((p,i)=>{
    const x=L+i*bw+bw*.15,w=bw*.7,hh=Math.abs(p.score)*amp;
    if(hh<1)s+='<rect x="'+x+'" y="'+(mid-2)+'" width="'+w+'" height="4" rx="2" fill="#1b7f5c"/>';
    else s+='<rect x="'+x+'" y="'+(p.score>=0?mid-hh:mid)+'" width="'+w+'" height="'+hh+'" rx="3" fill="'+(p.score>0?'#f59e0b':'#C4320A')+'" fill-opacity=".85"/>';
    const win=pts.slice(Math.max(0,i-4),i+1),m=win.reduce((a,q)=>a+q.score,0)/win.length;
    line+=(x+w/2).toFixed(1)+','+(mid-m*amp).toFixed(1)+' ';
  });
  s+='<polyline points="'+line+'" fill="none" stroke="#A6192E" stroke-width="2.5" stroke-linejoin="round"/>';
  const lbl=d=>parse(d).getDate()+'/'+(parse(d).getMonth()+1);
  s+='<text x="'+L+'" y="'+(H-4)+'">'+lbl(pts[0].d)+'</text><text x="'+(W-R)+'" y="'+(H-4)+'" text-anchor="end">'+lbl(pts[n-1].d)+'</text>';
  return s+'</svg><div class="sub">Bars: how each day felt. Line: 5-day average. As the line settles near the middle, the staffing levels are right.</div>';
}

function vLevels(c){
  const h=lvPart,pts=feedbackPoints(fb,cases,roster,h),rated=pts.filter(p=>p.n!=null);
  let o='<h2>Staffing levels</h2><div class="card"><div class="sub">The system matches each day’s team rating to the number of cases and how many people were rostered, then works out the sweet spot for each case level.</div><div class="seg" style="margin-top:12px">'+[['am','☀ Morning','am'],['pm','☾ Afternoon','pm']].map(x=>'<button class="'+(lvPart===x[0]?'on '+x[2]:'')+'" data-act="lv" data-v="'+x[0]+'">'+x[1]+'</button>').join('')+'</div>';
  if(rated.length<2)o+='<div class="banner pri" style="margin-top:12px">Not enough rated days yet. It needs at least 2 days with a case count and team ratings, then it gets sharper over a few weeks. Until then the starting levels below are used.</div>';
  o+='<h3 style="margin-top:16px">People rostered vs cases</h3>'+chartScatter(c,rated,h)+'<h3 style="margin-top:16px">How it felt over time</h3>'+chartTrend(pts);
  const sp=sweetSpot(rated,c,h);
  if(sp.length){
    o+='<h3 style="margin-top:16px">Sweet spot by case level</h3><div class="grid"><table><tr><th>Cases</th><th>Days</th><th>Few / Right / Many</th><th>Sweet spot</th><th>Plan</th></tr>'+sp.map(x=>'<tr><td>'+x.b+'–'+(x.b+4)+'</td><td>'+x.days+'</td><td>'+x.few+' / '+x.right+' / '+x.many+'</td><td><b>'+(x.est!=null?x.est:'–')+'</b></td><td>'+x.cur+'</td></tr>').join('')+'</table></div>';
  }
  o+='</div>';
  const bands=tuningStats(c,fb,cases,roster)[h],slots=h==='am'?SLOTS_AM:SLOTS_PM;
  o+='<h3 style="margin:18px 2px 0">'+(h==='am'?'Morning':'Afternoon')+' staffing by '+(h==='am'?'morning':'afternoon')+' cases</h3>';
  bands.forEach(b=>{
    const need=c.tables[h][b.i].need;
    o+='<div class="card"><div class="row"><h3>'+b.min+(b.max>=999?'+':'–'+b.max)+' cases</h3><span class="sp"></span><span class="sub">'+b.days+' rated day'+(b.days===1?'':'s')+'</span></div><div class="sub" style="margin:4px 0 6px">Currently: '+slots.filter(t=>+need[t]).map(t=>need[t]+'× '+slotLabel(t)).join(', ')+'</div><span class="chip red">Too few ' + b.few+'</span><span class="chip ok">Right '+b.right+'</span><span class="chip warn">Too many '+b.many+'</span>';
    if(b.sug)o+='<div class="row wrap" style="margin-top:8px"><b>Suggest '+(b.sug.delta>0?'+1 person':'−1 person')+' at '+slotLabel(b.sug.slot)+'</b><span class="sp"></span>'+(isAdmin?'<button class="btn sm pri" data-act="tune" data-h="'+h+'" data-i="'+b.i+'" data-slot="'+b.sug.slot+'" data-delta="'+b.sug.delta+'">Apply</button>':'')+'</div>';
    else if(b.days>=2&&b.right>b.few&&b.right>b.many)o+='<div class="sub" style="margin-top:8px">✓ This level is working. Keep it as the baseline.</div>';
    o+='</div>';
  });
  return o;
}

function myHalf(d){
  const x=((roster[d]&&roster[d].a)||[]).find(z=>z.s===me),a=acts[d+'_'+me],st=a?a.st:(x?x.t:null);
  return st==null?null:(st<12?'am':'pm');
}
function vFb(c,dates){
  const today=iso(new Date()),past=dates.filter(d=>d<=today),opts=past.length?past:dates;
  if(!fbState.d||!opts.includes(fbState.d)){const mineD=opts.filter(d=>myHalf(d));fbState.d=(mineD.length?mineD:opts)[(mineD.length?mineD:opts).length-1]}
  const d=fbState.d,half=myHalf(d),mine=fb[d+'_'+me]||{};
  const rate=(lab,key,val)=>'<div style="margin-top:14px"><b>'+lab+'</b><div class="seg seg5">'+[['few','Too few','bX'],['right','About right','bA'],['many','Too many','bM']].map(o=>'<button class="'+o[2]+(val===o[0]?' on':'')+'" data-act="fbr" data-k="'+key+'" data-v="'+o[0]+'">'+o[1]+'</button>').join('')+'</div></div>';
  let h='<div class="card"><h3>Your shift</h3><div class="sub">Pick a day to log your hours or give feedback.</div><div class="row wrap" style="margin-top:10px"><select data-ch="fbd">'+opts.map(x=>'<option value="'+x+'"'+(x===d?' selected':'')+'>'+esc(dayLabel(x))+(myHalf(x)?' · you worked':'')+'</option>').join('')+'</select></div>';
  const R=dayReport(d,c),my=myAsg(d);
  h+='<div class="sub" style="margin-top:8px">'+(R.est?'No case count recorded':'☀ '+R.am+' morning · ☾ '+R.pm+' afternoon cases')+' · '+partStats(R,'am').got+' rostered in the morning, '+partStats(R,'pm').got+' in the afternoon</div>'+hoursBox(c,d)+'</div>';
  h+='<div class="card"><h3>'+(half==='am'?'☀ Morning staff: how was staffing?':half==='pm'?'☾ Afternoon staff: how was staffing?':'How did staffing go?')+'</h3>';
  if(!half){
    h+='<div class="sub" style="margin-top:6px">You weren’t on this day. If you did work, log your hours above and the right question will appear. Morning staff rate the morning, afternoon staff rate the afternoon.</div></div>';
  }else{
    const key=half==='am'?'rm':'ra',val=fbState[key]||mine[key]||'';
    h+='<div class="sub">Takes 10 seconds. You started in the '+(half==='am'?'morning':'afternoon')+', so you’re rating the '+(half==='am'?'morning':'afternoon')+' team. The manager sees every answer and the system uses them to learn the right staffing for each case level.</div>';
    h+=rate(half==='am'?'Was the morning team size right?':'Was the afternoon team size right?',key,val);
    if(val==='few'){
      const sl=(half==='am'?SLOTS_AM:SLOTS_PM);
      h+='<div class="row" style="margin-top:12px"><label class="sub">When did we need someone? <select data-ch="fbsl"><option value="">Not sure</option>'+sl.map(t=>'<option value="'+t+'"'+(String(fbState.sl||mine.sl||'')===String(t)?' selected':'')+'>'+slotLabel(t)+' start</option>').join('')+'</select></label></div>';
    }
    h+='<div style="margin-top:12px"><textarea data-ch="fbn" placeholder="Anything else? (optional)">'+esc(fbState.note||mine.note||'')+'</textarea></div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="fbsave">Submit</button></div></div>';
  }
  const all=Object.keys(fb).map(k=>fb[k]).filter(f=>f.d===d);
  if(all.length){
    const cnt=(key,v)=>all.filter(f=>f[key]===v).length;
    h+='<div class="card"><h3>Team answers for '+esc(dayLabel(d))+'</h3><div class="sub" style="margin:6px 0 2px">☀ Morning staff: '+cnt('rm','few')+' too few · '+cnt('rm','right')+' right · '+cnt('rm','many')+' too many</div><div class="sub">☾ Afternoon staff: '+cnt('ra','few')+' too few · '+cnt('ra','right')+' right · '+cnt('ra','many')+' too many</div>'+all.filter(f=>f.note).map(f=>'<div class="sub" style="margin-top:6px">“'+esc(f.note)+'”</div>').join('')+'</div>';
  }
  return h+vLevels(c);
}
function vSetup(c,dates){
  let h='<div class="card"><h3>Fortnight</h3><div class="row wrap" style="margin-top:10px"><label class="sub">Cycle starts (a Monday) <input type="date" data-ch="start" value="'+esc(c.anchor)+'"></label><label class="sub">Planning cases per day <input type="number" data-ch="plan" value="'+c.plan+'"></label></div><div class="sub" style="margin-top:8px">Weekdays only. The planning figure (split evenly morning and afternoon) is used for days where real case numbers aren’t in yet.</div></div>';
  h+='<div class="card"><h3>Saturday shifts</h3><div class="sub" style="margin:4px 0 8px">If Saturdays run every second week, pick one Saturday that runs. Every 2nd Saturday after (and before) it counts as a working day, so \u201cnext day\u201d on a Friday shows Saturday in those weeks and Monday otherwise.</div><div class="row wrap"><input type="date" data-ch="sat" value="'+esc(c.sat||'')+'">'+(c.sat?'<button class="btn sm ghost" data-act="satclear">No Saturdays</button>':'')+'</div></div>';
  h+=accessCard(c);
  h+='<div class="card"><h3>Staff</h3><div class="sub" style="margin-top:4px">Type and “want” set the default days per fortnight; people can change their own. Inactive people are greyed out: never auto-rostered, never suggested for cover, hidden from the grid. You can still add them by hand. Managers are rostered every day they’re free (AM at 6, PM at 1).</div>';
  c.all.forEach(s=>{
    h+='<div class="ad row wrap" style="'+(s.off?'opacity:.6;':'')+'"><input data-sf="name" data-s="'+esc(s.id)+'" value="'+esc(s.name)+'" style="width:140px"><select data-sf="type" data-s="'+esc(s.id)+'">'+Object.keys(typeName).map(k=>'<option value="'+k+'"'+(s.type===k?' selected':'')+'>'+typeName[k]+'</option>').join('')+'</select><input type="number" min="0" max="5" step="0.5" title="Days per week" data-sf="want" data-s="'+esc(s.id)+'" value="'+esc((+s.want||0)/2)+'"><select data-sf="role" data-s="'+esc(s.id)+'"><option value="">Staff</option><option value="AM"'+(s.role==='AM'?' selected':'')+'>AM manager</option><option value="PM"'+(s.role==='PM'?' selected':'')+'>PM manager</option></select><input data-sf="phone" data-s="'+esc(s.id)+'" value="'+esc(s.phone||'')+'" placeholder="Phone" style="width:120px">'+pinCell(s.id)+'<select data-sf="off" data-s="'+esc(s.id)+'"><option value="">Active</option><option value="1"'+(s.off?' selected':'')+'>Inactive</option></select>'+(s.off?'<input data-sf="note" data-s="'+esc(s.id)+'" value="'+esc(s.note||'')+'" placeholder="Private note (managers only)" style="width:100%" maxlength="80">':'')+'<button class="btn sm ghost" data-act="rmstaff" data-s="'+esc(s.id)+'">Remove</button></div>';
  });
  h+='<div class="row wrap" style="margin-top:12px"><input id="newname" placeholder="New person’s name" style="width:170px"><button class="btn pri" data-act="addstaff">Add</button>'+(c.all.length?'':'<button class="btn ghost" data-act="sample">Add sample team</button>')+'</div></div>';
  [['am','☀ Morning staffing','morning cases',SLOTS_AM],['pm','☾ Afternoon staffing','afternoon cases',SLOTS_PM]].forEach(x=>{
    h+='<div class="card grid"><h3>'+x[1]+'</h3><div class="sub" style="margin:4px 0 8px">People needed at each start time, by number of '+x[2]+'. Starting guesses; the feedback loop suggests changes. Managers count toward their start time.</div><table><tr><th>Up to '+x[2].split(' ')[0]+' cases</th>'+x[3].map(t=>'<th>'+slotLabel(t)+'</th>').join('')+'</tr>';
    c.tables[x[0]].forEach((r,i)=>{h+='<tr><td><input type="number" data-tb="max" data-h="'+x[0]+'" data-i="'+i+'" value="'+r.max+'"></td>'+x[3].map(t=>'<td><input type="number" min="0" data-tb="need" data-h="'+x[0]+'" data-i="'+i+'" data-t="'+t+'" value="'+(+r.need[t]||0)+'" style="width:56px"></td>').join('')+'</tr>'});
    h+='</table></div>';
  });
  return h+'<div class="row"><button class="btn ghost sm" data-act="resettable">Reset staffing tables to defaults</button></div>';
}

// ---------- events ----------
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,c=C(),dates=fortDates(c.start),d=b.dataset.d;
  if(await chgClick(a,b,c))return;
  if(a==='tab'){tab=b.dataset.v;bell=false;addFor=null;draw();window.scrollTo(0,0)}
  else if(a==='bell'){bell=!bell;draw();window.scrollTo(0,0)}
  else if(a==='fn'){viewStart=addDays(c.start,+b.dataset.v);draft=null;calSel='';draw()}
  else if(a==='pt'){part=b.dataset.v;draw()}
  else if(a==='cm'){calMode=b.dataset.v;draw()}
  else if(a==='cday'){calSel=d;calMonth=d.slice(0,7);hoursOpen='';addFor=null;draw();const pg=document.querySelector('[data-pager]');if(pg)pg.scrollIntoView({behavior:'smooth',block:'start'})}
  else if(a==='dstep'){const v=+b.dataset.v;let x=calSel;for(let i=0;i<10;i++){x=addDays(x,v);if(isWorking(x,c))break}calSel=x;calMonth=x.slice(0,7);hoursOpen='';addFor=null;draw()}
  else if(a==='mnav'){const p=calMonth.split('-').map(Number),dt=new Date(p[0],p[1]-1+ +b.dataset.v,1);calMonth=iso(dt).slice(0,7);draw()}
  else if(a==='mtoday'){calMonth=iso(new Date()).slice(0,7);calSel=iso(new Date());draw()}
  else if(a==='satclear'){await mutCfg(x=>{x.sat=''})}
  else if(a==='gapdismiss'){await save('chg/dm_'+d+'_'+b.dataset.p,{k:'dismiss',d,p:b.dataset.p,n:+b.dataset.n,ts:Date.now(),st:'closed'})}
  else if(a==='showoff'){showOff=!showOff;draw()}
  else if(a==='openwe'){weOpen[d]=true;draw()}
  else if(a==='homeopen'){calSel=d;calMonth=d.slice(0,7);draw();setTimeout(()=>{const e=document.querySelector('[data-day="'+d+'"]');if(e)e.scrollIntoView({behavior:'smooth',block:'start'})},60)}
  else if(a==='cyc'){
    if(!isAdmin)return;const s=b.dataset.s,cur=effAsg(d).map(z=>Object.assign({},z)),was=cur.find(z=>z.s===s),order=[6,7,10,12,13,14];
    const nx=!was?order[0]:order.indexOf(was.t)+1>=order.length?null:order[order.indexOf(was.t)+1];
    const rest=cur.filter(z=>z.s!==s);if(nx!==null)rest.push({s,t:nx});
    const base=(roster[d]&&roster[d].a)||[];
    if(JSON.stringify(rest.slice().sort((p,q)=>p.s<q.s?-1:1))===JSON.stringify(base.slice().sort((p,q)=>p.s<q.s?-1:1)))delete sheetDraft[d];else sheetDraft[d]=rest;
    draw();
  }
  else if(a==='lv'){lvPart=b.dataset.v;draw()}
  else if(a==='avview'){availView=b.dataset.v;draw()}
  else if(a==='avyear'){availMonth=(+availMonth.slice(0,4)+ +b.dataset.v)+availMonth.slice(4);draw()}
  else if(a==='avmonth'){availMonth=b.dataset.v;draw()}
  else if(a==='day'){setDay(d,b.dataset.v);draft.dirty=true;draw()}
  else if(a==='pf'){const cur=draft.pf[d]||'';const nx=cur===''?'+':cur==='+'?'-':'';if(nx)draft.pf[d]=nx;else delete draft.pf[d];draft.dirty=true;draw()}
  else if(a==='qf'){avDates(c).forEach(x=>setDay(x,b.dataset.v));draft.dirty=true;draw()}
  else if(a==='block'){
    if(!blk.from||!blk.to){toast('Pick a from and to date');return}
    let a1=blk.from,a2=blk.to;if(a2<a1){const t=a1;a1=a2;a2=t}
    let x=a1,n=0;for(let i=0;i<800&&x<=a2;i++){const w=parse(x).getDay();if(w>0&&w<6){setDay(x,blk.st);if(blk.note&&blk.st==='X')draft.nt[x]=blk.note;n++}x=addDays(x,1)}
    draft.dirty=true;toast(n+' day'+(n===1?'':'s')+' updated. Remember to Save.');draw();
  }
  else if(a==='saveav'){
    const old=avail[me],cut=addDays(iso(new Date()),-60),prune=o=>{const r={};Object.keys(o).forEach(k=>{if(k>=cut)r[k]=o[k]});return r};
    const days={};Object.keys(draft.days).forEach(k=>{let v=draft.days[k];if(v==='A'&&draft.ot)v='O';days[k]=v});
    const baseSave=draft.base||null;
    await save('avail/'+me,{s:me,days:prune(days),tp:prune(draft.tp),pf:prune(draft.pf),nt:prune(draft.nt),tpref:draft.tpref,base:baseSave,ot:!!draft.ot,want:Math.max(0,Math.min(10,+draft.want||0)),ts:Date.now()});
    if(old)await logAvailChange(c,old,draft);
    draft.dirty=false;toast('Availability saved');
  }
  else if(a==='plus'){addFor={d,t:+b.dataset.t};draw()}
  else if(a==='plusx'){addFor=null;draw()}
  else if(a==='plusadd'){
    const box=b.closest('[data-addbox]'),s=box.querySelector('select').value,t=+b.dataset.t;if(!s)return;
    const cur=((roster[d]&&roster[d].a)||[]).filter(x=>x.s!==s);cur.push({s,t});
    await save('roster/'+d,{a:cur});addFor=null;
    if(liveDate(c,d))await notify([s],'You’ve been added to '+dayLabel(d)+', '+slotLabel(t)+'.','roster');
  }
  else if(a==='rm'){
    const s=b.dataset.s,cur=(roster[d]&&roster[d].a)||[],was=cur.find(x=>x.s===s);
    await save('roster/'+d,{a:cur.filter(x=>x.s!==s)});
    if(was&&liveDate(c,d))await notify([s],'You’ve been taken off '+dayLabel(d)+', '+slotLabel(was.t)+'.','roster');
  }
  else if(a==='auto'){
    let ds=dates,mode=b.dataset.v;
    if(mode==='next'){
      let st=curStart();while(st<=addDays(curStart(),0)&&false)st=addDays(st,14);
      st=addDays(curStart(),14);for(let k=0;k<6;k++){const dd=fortDates(st);if(!dd.some(x=>roster[x]&&roster[x].a&&roster[x].a.length))break;st=addDays(st,14)}
      viewStart=st;ds=fortDates(st);sheetDraft={};
    }
    const ro=Object.assign({},roster);Object.keys(sheetDraft).forEach(k=>{ro[k]={a:sheetDraft[k]}});
    const cz=Object.assign({},cases);ds.forEach(x=>{if(!casesIn(x)){const u=usualCases(x);if(u)cz[x]={am:u.am,pm:u.pm}}});
    const r=autoFill(c.start===ds[0]?c:Object.assign({},c,{start:ds[0]}),ds,avail,cz,ro,mode==='gaps');
    ds.forEach(x=>{const base=(roster[x]&&roster[x].a)||[];if(JSON.stringify(r.asg[x])!==JSON.stringify(base))sheetDraft[x]=r.asg[x];else delete sheetDraft[x]});
    const lines=r.why.filter(w=>mode==='next'?true:true).map(w=>({d:w.d,t:w.t,n:nameOf(c,w.s),w:w.w}));
    helpNote={mode,ds,lines,gaps:r.gaps.map(g=>({d:g.d,t:g.t,n:g.n}))};
    toast(r.gaps.length?'Done, but '+r.gaps.reduce((q,g)=>q+g.n,0)+' spot(s) have nobody free. Review, then Save.':'Done. Review and edit, then Save.');draw();window.scrollTo(0,0);
  }
  else if(a==='clear'){dates.forEach(x=>{if((roster[x]&&roster[x].a&&roster[x].a.length)||sheetDraft[x])sheetDraft[x]=[]});draw()}
  else if(a==='savesheet'){await saveSheet(c);draw()}
  else if(a==='discardsheet'){sheetDraft={};helpNote=null;draw()}
  else if(a==='shareimg'){await shareRoster(c,dates,b.dataset.v)}
  else if(a==='savemail'){const v=((document.getElementById('mailin')||{}).value||'').trim();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){toast('That doesn’t look like an email address');return}await save('mail/'+me,{email:v});toast('Email saved')}
  else if(a==='editmail'){e.preventDefault();await save('mail/'+me,{email:''});}
  else if(a==='pub'){
    await mutCfg(x=>{if(!x.pub||x.pub<dates[9])x.pub=dates[9]});
    toast('Publishing…');
    const ids=c.staff.map(s=>s.id);
    await save('ntf/'+newId(),{to:ids,txt:'Roster published for '+dayLabel(dates[0])+' – '+dayLabel(dates[9])+'. Check the Calendar for your shifts.',ts:Date.now(),kind:'roster'});
    const r=await emailRoster(c,dates);
    toast('Published. Emailed '+r.sent+' of '+r.total+(r.miss.length?'. No email yet: '+r.miss.join(', '):''));
  }
  else if(a==='fbr'){fbState[b.dataset.k]=b.dataset.v;draw()}
  else if(a==='fbsave'){
    if(!me)return;const dd=fbState.d,half=myHalf(dd);if(!half){toast('Log your hours first');return}
    const key=half==='am'?'rm':'ra',m=fb[dd+'_'+me]||{},val=fbState[key]||m[key]||'';
    if(!val){toast('Pick an answer first');return}
    const sl=val==='few'?(+fbState.sl||+m.sl||0):0,note=(fbState.note||m.note||'').slice(0,300),rec={d:dd,s:me,sl,note,ts:Date.now()};rec[key]=val;
    await save('fb/'+dd+'_'+me,rec);
    const lab=val==='few'?'too few':val==='many'?'too many':'about right';
    await notify(['admin'],nameOf(c,me)+' ('+(half==='am'?'morning':'afternoon')+' staff) on '+dayLabel(dd)+': '+lab+(sl?' (needed someone at '+slotLabel(sl)+')':'')+(note?' · “'+note.slice(0,80)+'”':''),'feedback');
    fbState.rm='';fbState.ra='';fbState.sl='';fbState.note='';toast('Thanks, feedback sent');
  }
  else if(a==='tune'){await mutCfg(x=>{const row=x.tables[b.dataset.h][+b.dataset.i].need,t=b.dataset.slot;row[t]=Math.max(0,(+row[t]||0)+(+b.dataset.delta))});toast('Staffing level updated')}
  else if(a==='addstaff'){const nm=document.getElementById('newname').value.trim();if(!nm)return;await mutCfg(x=>x.staff.push({id:'s'+Date.now().toString(36),name:nm,type:'CAS',want:5,role:'',phone:''}))}
  else if(a==='rmstaff'){await mutCfg(x=>{x.staff=x.staff.filter(s=>s.id!==b.dataset.s)})}
  else if(a==='sample'){await mutCfg(x=>{['Sam','Alex','Jordan','Priya','Mei','Tom','Chloe','Dan','Nina','Luke'].forEach((n,i)=>x.staff.push({id:'s'+Date.now().toString(36)+i,name:n,type:i<3?'FT':i<6?'PT':'CAS',want:i<3?10:i<6?8:5,role:'',phone:''}));x.staff.push({id:'sam'+Date.now().toString(36),name:'Morning manager',type:'FT',want:10,role:'AM',phone:''},{id:'spm'+Date.now().toString(36),name:'Afternoon manager',type:'FT',want:10,role:'PM',phone:''})})}
  else if(a==='resettable'){await mutCfg(x=>{x.tables=clone(DEF_TABLES)})}
});
document.addEventListener('change',async e=>{
  const el=e.target,c=C();
  if(el.dataset.ch){
    const k=el.dataset.ch,d=el.dataset.d;
    if(k==='me'){me=isAdmin?el.value:(Store.who()||'');draft=null;draw()}
    else if(k==='cam'||k==='cpm'||k==='ctot'||k==='th'||k==='note'){
      const cur=Object.assign({},cases[d]||{});
      if(k==='note')cur.note=el.value.slice(0,200);
      else if(k==='th'){if(el.value==='')delete cur.th;else cur.th=Math.max(0,+el.value)}
      else if(k==='ctot'){
        if(el.value===''){delete cur.n;delete cur.am;delete cur.pm}
        else{
          const n=Math.max(0,Math.round(+el.value)),hasA=cur.am!=null,hasP=cur.pm!=null;
          if(hasA&&hasP&&(+cur.am||0)+(+cur.pm||0)>0){const a=Math.round(n*(+cur.am||0)/((+cur.am||0)+(+cur.pm||0)));cur.am=a;cur.pm=n-a}
          else if(hasA&&!hasP)cur.pm=Math.max(0,n-(+cur.am||0));
          else if(hasP&&!hasA)cur.am=Math.max(0,n-(+cur.pm||0));
          cur.n=n;
        }
      }
      else{
        const f=k==='cam'?'am':'pm',o=k==='cam'?'pm':'am';
        if(el.value==='')delete cur[f];else cur[f]=Math.max(0,Math.round(+el.value));
        if(cur[f]!=null&&cur[o]==null&&cur.n!=null&&!cur._split)cur[o]=Math.max(0,(+cur.n||0)-(+cur[f]));
        if(cur.am==null&&cur.pm==null){if(el.value==='')delete cur.n}else cur.n=(+cur.am||0)+(+cur.pm||0);
      }
      await save('cases/'+d,cur);
    }
    else if(k==='creason')cantReason=el.value;
    else if(k==='cnote')cantNote=el.value;
    else if(k==='lgpick'){lg.pick=el.value;lg.err='';draw()}
    else if(k==='cwho'){cantWho=el.value;cantFor=null;draw()}
    else if(k==='yt'){if(yesFor)yesFor.t=+el.value}
    else if(k==='fbd'){fbState.d=el.value;fbState.rm='';fbState.ra='';draw()}
    else if(k==='fbsl')fbState.sl=el.value;
    else if(k==='fbn')fbState.note=el.value;
    else if(k==='nt'){draft.nt[d]=el.value;draft.dirty=true;draw()}
    else if(k==='ot'){draft.ot=el.checked;draft.dirty=true;draw()}
    else if(k==='tpref'){draft.tpref=el.value;draft.dirty=true;draw()}
    else if(k==='want'){draft.want=Math.max(0,Math.min(10,Math.round((+el.value||0)*2)));draft.dirty=true;draw()}
    else if(k==='bfrom')blk.from=el.value;
    else if(k==='bto')blk.to=el.value;
    else if(k==='bst')blk.st=el.value;
    else if(k==='bnote')blk.note=el.value;
    else if(k==='start'){if(el.value){viewStart=null;await mutCfg(x=>{x.anchor=el.value})}}
    else if(k==='sat'){if(!el.value){await mutCfg(x=>{x.sat=''});return}let v=el.value;const g=parse(v).getDay();if(g!==6)v=addDays(v,6-g);await mutCfg(x=>{x.sat=v});toast('Saturdays run from '+dayLabel(v)+', every 2nd week')}
    else if(k==='plan')await mutCfg(x=>{x.plan=Math.max(0,+el.value||0)});
  }else if(el.dataset.sf){
    const id=el.dataset.s,f=el.dataset.sf;await mutCfg(x=>{const s=x.staff.find(z=>z.id===id);if(s)s[f]=f==='want'?Math.max(0,Math.min(10,Math.round((+el.value||0)*2))):f==='off'?el.value==='1':el.value});
  }else if(el.dataset.tb){
    const i=+el.dataset.i,h=el.dataset.h;await mutCfg(x=>{if(el.dataset.tb==='max')x.tables[h][i].max=+el.value||0;else x.tables[h][i].need[el.dataset.t]=Math.max(0,+el.value||0)});
  }
});

// ---------- sign-in, accounts, sync ----------
function loginView(){
  const nm=lg.names,sel=nm&&nm.find(x=>x.id===lg.pick),mgr=!!(sel&&sel.adm);
  let h='<div class="hero"><div class="row"><div><div class="brand"><div><div class="ey">Macquarie University Hospital</div><h1>Theatre Roster</h1></div></div></div><span class="sp"></span><img class="logo" src="logo.png" alt="Macquarie University Hospital" onerror="this.remove()"></div></div><div class="card"><h3>Who are you?</h3>';
  if(nm===null)return h+'<div class="sub" style="margin-top:8px">Loading…</div></div>';
  if(!nm.length)return h+'<div class="sub" style="margin-top:8px">'+esc(lg.err||'Not set up yet. Ask your manager.')+'</div></div>';
  h+='<div class="sub" style="margin:6px 0 12px">Pick your name to see when you’re rostered on. This is a team roster tool, not an official hospital system.</div><select id="lgname" data-ch="lgpick" style="width:100%"><option value="">Your name</option>'+nm.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===lg.pick?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select>';
  if(mgr)h+='<div style="margin-top:10px"><input id="lgpin" type="password" inputmode="numeric" maxlength="8" placeholder="Manager PIN" autocomplete="current-password" style="width:100%"></div>';
  if(lg.err)h+='<div class="banner" style="margin-top:12px;background:#fdeadf;color:#C4320A">'+esc(lg.err)+'</div>';
  return h+'<div class="row" style="margin-top:12px"><button class="btn pri" data-act="login"'+(lg.busy||!lg.pick?' disabled':'')+'>'+(lg.busy?'Please wait…':'Continue')+'</button></div></div>';
}
const otOK=(sf,d)=>statusOf(sf,d,C().start,avail)==='O';
function drawRosterImage(c,dates,cv){
  const ppl=c.all.filter(x=>dates.some(d=>((roster[d]&&roster[d].a)||[]).some(z=>z.s===x.id)));
  ppl.sort((a,b)=>(a.role==='AM'?0:a.role==='PM'?2:1)-(b.role==='AM'?0:b.role==='PM'?2:1)||a.name.localeCompare(b.name));
  const W=1080,pad=30,nameW=250,gap=26,cw=(W-pad*2-nameW-gap)/10,rh=62,top=210,H=top+rh*ppl.length+140;
  cv.width=W;cv.height=H;const g=cv.getContext('2d');
  g.fillStyle='#f6f4ef';g.fillRect(0,0,W,H);
  const gr=g.createLinearGradient(0,0,W,0);gr.addColorStop(0,'#A6192E');gr.addColorStop(1,'#6F1D46');g.fillStyle=gr;g.fillRect(0,0,W,150);
  g.fillStyle='#fff';g.textBaseline='alphabetic';
  g.font='600 22px Arial, sans-serif';g.fillText('MACQUARIE UNIVERSITY HOSPITAL',pad,52);
  g.font='bold 48px Arial, sans-serif';g.fillText('Theatre Roster',pad,108);
  g.font='28px Arial, sans-serif';g.textAlign='right';g.fillText(dayLabel(dates[0])+' – '+dayLabel(dates[9]),W-pad,108);
  g.textAlign='left';
  const x0=pad+nameW,cx=i=>x0+i*cw+(i>=5?gap:0);
  g.fillStyle='#fff';g.fillRect(pad,top-60,W-pad*2,rh*ppl.length+66);
  g.textAlign='center';
  dates.forEach((d,i)=>{const x=cx(i);
    g.fillStyle='#555';g.font='bold 22px Arial, sans-serif';g.fillText(parse(d).toLocaleDateString('en-AU',{weekday:'short'}),x+cw/2,top-30);
    g.font='20px Arial, sans-serif';g.fillStyle='#888';g.fillText(String(parse(d).getDate()),x+cw/2,top-6)});
  ppl.forEach((sf,r)=>{
    const y=top+r*rh;
    if(r%2)'';g.fillStyle=r%2?'#faf8f4':'#fff';g.fillRect(pad,y+6,W-pad*2,rh);
    g.textAlign='left';g.fillStyle='#2b2d2a';g.font=(sf.role?'bold ':'')+'26px Arial, sans-serif';
    let nm=sf.name;while(g.measureText(nm).width>nameW-14&&nm.length>3)nm=nm.slice(0,-1);g.fillText(nm,pad+10,y+rh/2+14);
    g.textAlign='center';
    dates.forEach((d,i)=>{const z=((roster[d]&&roster[d].a)||[]).find(q=>q.s===sf.id);if(!z)return;
      const x=cx(i);g.fillStyle=z.t<12?'#fbd98a':'#dcbfe8';
      const bx=x+8,by=y+12,bw=cw-16,bh=rh-14,rd=12;g.beginPath();g.moveTo(bx+rd,by);g.arcTo(bx+bw,by,bx+bw,by+bh,rd);g.arcTo(bx+bw,by+bh,bx,by+bh,rd);g.arcTo(bx,by+bh,bx,by,rd);g.arcTo(bx,by,bx+bw,by,rd);g.closePath();g.fill();
      g.fillStyle='#2b2d2a';g.font='bold 28px Arial, sans-serif';g.fillText(String(fmtH(z.t)),x+cw/2,y+rh/2+14);
      if(otOK(sf,d)){g.strokeStyle='#1f7a4d';g.lineWidth=4;g.stroke()}});
  });
  g.fillStyle='#f6f4ef';g.fillRect(x0+5*cw,top-60,gap,rh*ppl.length+66);g.fillStyle='#2b2d2a';g.fillRect(x0+5*cw+gap/2-1.5,top-60,3,rh*ppl.length+66);
  const ly=top+rh*ppl.length+62;g.textAlign='left';
  g.fillStyle='#fbd98a';g.fillRect(pad,ly-22,26,26);g.fillStyle='#555';g.font='22px Arial, sans-serif';g.fillText('Morning start',pad+36,ly);
  g.fillStyle='#dcbfe8';g.fillRect(pad+230,ly-22,26,26);g.fillStyle='#555';g.fillText('Afternoon start',pad+266,ly);
  g.fillStyle='#fbd98a';g.fillRect(pad+502,ly-21,24,24);g.strokeStyle='#1f7a4d';g.lineWidth=4;g.strokeRect(pad+502,ly-21,24,24);g.fillStyle='#555';g.fillText('Can do overtime',pad+540,ly);
  g.fillStyle='#888';g.font='20px Arial, sans-serif';g.fillText('Numbers are start times. Every shift is 8 hours (7 = 7am–3pm, 1 = 1pm–9pm).',pad,ly+44);
  return cv;
}
async function shareRoster(c,dates,mode){
  if(Object.keys(sheetDraft).length){toast('Save your changes first, then share');return}
  const cv=drawRosterImage(c,dates,document.createElement('canvas'));
  const name='roster-'+dates[0]+'.png';
  const blob=await new Promise(r=>cv.toBlob(r,'image/png'));if(!blob){toast('Couldn’t make the image');return}
  const file=new File([blob],name,{type:'image/png'});
  if(mode==='share'){
    try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Theatre roster '+dayLabel(dates[0])+' – '+dayLabel(dates[9])});return}}
    catch(e){if(e&&e.name==='AbortError')return}
    toast('Sharing isn’t available here, so it was saved instead');mode='save';
  }
  if(mode==='copy'){
    try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('Image copied. Paste it into WhatsApp.');return}
    catch(e){toast('Couldn’t copy here, so it was saved instead');mode='save'}
  }
  const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);toast('Image saved');
}
function mailShell(inner){
  return '<div style="background:#f6f4ef;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#2b2d2a"><div style="max-width:640px;margin:0 auto"><div style="background:#A6192E;background-image:linear-gradient(135deg,#A6192E,#6F1D46);color:#fff;padding:18px 20px;border-radius:16px 16px 0 0"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.85">Macquarie University Hospital</div><div style="font-size:22px;font-weight:bold">Theatre Roster</div></div><div style="background:#fff;padding:20px;border-radius:0 0 16px 16px">'+inner+'<p style="font-size:12px;color:#777;margin:18px 0 0">Open the Theatre Roster app to make changes or tell the manager you can’t make a shift.</p></div></div></div>';
}
function rosterEmail(c,dates,sid){
  const nm=nameOf(c,sid),mine=dates.map(d=>({d,x:((roster[d]&&roster[d].a)||[]).find(z=>z.s===sid)})).filter(z=>z.x);
  const cellBg=t=>t<12?'#fde9c0':'#e9d5f0';
  let h='<p style="font-size:16px;margin:0 0 12px">Hi '+esc(nm.split(' ')[0])+', the roster for <b>'+esc(dayLabel(dates[0]))+' – '+esc(dayLabel(dates[9]))+'</b> is out.</p>';
  h+='<div style="font-weight:bold;margin:12px 0 6px">Your shifts</div>'+(mine.length?'<table style="border-collapse:collapse;width:100%">'+mine.map(z=>'<tr><td style="padding:7px 10px;border-bottom:1px solid #eee">'+esc(dayLabel(z.d))+'</td><td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:right"><span style="background:'+cellBg(z.x.t)+';border-radius:8px;padding:3px 9px;font-weight:bold">'+slotLabel(z.x.t)+'</span> <span style="color:#777">'+(z.x.t<12?'morning':'afternoon')+'</span></td></tr>').join('')+'</table>':'<p style="color:#777">You’re not rostered on this fortnight.</p>');
  h+='<div style="font-weight:bold;margin:18px 0 6px">Whole team</div><table style="border-collapse:collapse;width:100%;font-size:12px;text-align:center"><tr><th style="text-align:left;padding:4px"></th>'+dates.map(d=>'<th style="padding:4px;color:#555">'+esc(parse(d).toLocaleDateString('en-AU',{weekday:'short'}))+'<br>'+parse(d).getDate()+'</th>').join('')+'</tr>';
  c.all.filter(s=>dates.some(d=>((roster[d]&&roster[d].a)||[]).some(x=>x.s===s.id))).sort((a,b)=>a.name.localeCompare(b.name)).forEach(s=>{
    h+='<tr'+(s.id===sid?' style="background:#fbeaee"':'')+'><td style="text-align:left;padding:4px;white-space:nowrap;font-weight:'+(s.id===sid?'bold':'normal')+'">'+esc(s.name.split(' ')[0])+'</td>'+dates.map(d=>{const x=((roster[d]&&roster[d].a)||[]).find(z=>z.s===s.id);return '<td style="padding:4px;border:1px solid #f0ede6'+(x?';background:'+cellBg(x.t)+';font-weight:bold':'')+'">'+(x?fmtH(x.t):'')+'</td>'}).join('')+'</tr>';
  });
  return h+'</table><p style="font-size:12px;color:#777;margin:8px 0 0">Numbers are start times (8-hour shifts). Amber is morning, purple is afternoon.</p>';
}
async function emailRoster(c,dates){
  const ids=c.staff.filter(s=>dates.some(d=>((roster[d]&&roster[d].a)||[]).some(x=>x.s===s.id))).map(s=>s.id);
  const have=ids.filter(i=>mails[i]&&mails[i].email),miss=ids.filter(i=>!have.includes(i));
  let sent=0;
  for(const i of have){const r=await Store.mail([i],'Your roster: '+dayLabel(dates[0])+' – '+dayLabel(dates[9]),mailShell(rosterEmail(c,dates,i)));if(r&&r.ok)sent+=r.sent||0}
  return {sent,total:ids.length,miss:miss.map(i=>nameOf(c,i)),off:!have.length&&false};
}
function emailPrompt(){
  if(!me||(mails[me]&&mails[me].email))return '';
  return '<div class="card" style="border-left:5px solid var(--pri)"><h3>Add your work email</h3><div class="sub" style="margin:4px 0 10px">Your Macquarie email, so the roster and any changes to your shifts reach you. You only do this once.</div><div class="row wrap"><input id="mailin" type="email" inputmode="email" autocomplete="email" placeholder="you@mq.edu.au" style="flex:1;min-width:190px"><button class="btn pri sm" data-act="savemail">Save</button></div></div>';
}
function accountCard(){
  const id=Store.who(),s=(cfg&&cfg.staff||[]).find(x=>x.id===id),np=typeof Notification!=='undefined'?Notification.permission:'unsupported';
  return '<div class="card"><h3>Your account</h3><div class="sub">Signed in as <b>'+esc(s?s.name:id)+'</b>'+(isAdmin?' · manager':'')+'</div><div class="sub" style="margin-top:4px">Email: <b>'+esc((mails[id]&&mails[id].email)||'not added')+'</b> · <a href="#" data-act="editmail" style="color:var(--pri)">change</a></div>'+(isAdmin?'<div class="row wrap" style="margin-top:10px"><input id="newpin" type="password" inputmode="numeric" maxlength="8" placeholder="New manager PIN (4–8 digits)" style="width:210px"><button class="btn sm" data-act="chgpin">Change PIN</button></div>':'')+'<div class="row wrap" style="margin-top:10px">'+(np==='unsupported'?'':np==='granted'?'<span class="chip ok">Phone alerts on</span>':np==='denied'?'<span class="sub">Alerts are blocked in your browser settings.</span>':'<button class="btn sm" data-act="notifperm">Turn on phone alerts</button>')+'<button class="btn sm ghost" data-act="logout">Sign out</button></div></div>';
}
function accessCard(c){
  const p=Store.pins(),mg=c.all.filter(x=>p[x.id]&&p[x.id].admin).map(x=>x.name);
  return '<div class="card"><h3>Who can sign in</h3><div class="sub" style="margin-top:4px">Staff just pick their name, with no PIN. Admins have a PIN and can change the roster. Admins now: <b>'+(mg.length?mg.map(esc).join(', '):'none')+'</b>. Being rostered as morning or afternoon manager doesn’t make someone an admin. To give someone admin access, type a PIN beside their name below and tap Make manager.</div></div>';
}
function pinCell(id){
  const p=Store.pins()[id],mg=!!(p&&p.admin);
  if(mg)return '<input data-pin="'+esc(id)+'" type="text" inputmode="numeric" maxlength="8" placeholder="New PIN" style="width:84px"><button class="btn sm" data-act="setpin" data-s="'+esc(id)+'">Reset PIN</button>'+(id!==Store.who()?'<button class="btn sm pri" data-act="setadmin" data-s="'+esc(id)+'" data-v="0">Manager ✓</button>':'<span class="chip info">you</span>');
  return '<input data-pin="'+esc(id)+'" type="text" inputmode="numeric" maxlength="8" placeholder="PIN" style="width:70px"><button class="btn sm ghost" data-act="mkmgr" data-s="'+esc(id)+'">Make manager</button>';
}
function sync(){
  const d=Store.data();
  [avail,cases,roster,fb,chg,ntf,seen,acts,mails].forEach(o=>Object.keys(o).forEach(k=>delete o[k]));
  const by={avail,cases,roster,fb,chg,ntf,seen,act:acts,mail:mails};cfg=null;
  Object.keys(d).forEach(p=>{const i=p.indexOf('/'),c=p.slice(0,i),id=p.slice(i+1);if(c==='cfg'){if(id==='main')cfg=d[p]}else if(by[c])by[c][id]=d[p]});
}
function afterLogin(){db=Store.db;isAdmin=Store.isAdmin();me=Store.who();ready=true;draft=null;tab='cal';calMode='month';weOpen={};sheetDraft={};call={open:false,who:'',d:'',reason:'Sick',note:'',touched:false};hoursOpen='';sync();draw();}
function localAlert(n){
  try{
    if(typeof Notification==='undefined'||Notification.permission!=='granted'||!document.hidden)return;
    const mine=(n.to||[]).includes(Store.who())||(isAdmin&&(n.to||[]).includes('admin'));if(!mine)return;
    navigator.serviceWorker.ready.then(r=>r.showNotification('Theatre Roster',{body:n.txt,icon:'icon-192.png',tag:'rp-'+(n.ts||Date.now())}));
  }catch(e){}
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='login'){
    const id=document.getElementById('lgname').value,pe=document.getElementById('lgpin'),pin=pe?pe.value:'';
    if(!id){lg.err='Pick your name.';draw();return}
    const sel=(lg.names||[]).find(x=>x.id===id);
    if(sel&&sel.adm&&!pin){lg.err='Enter the manager PIN.';draw();return}
    lg.busy=true;lg.err='';draw();
    try{const r=await Store.login(id,pin);lg.busy=false;if(r.ok){afterLogin();return}lg.err=r.err==='locked'?'Too many wrong tries. Wait 10 minutes and try again.':'Wrong PIN. Ask the other manager to reset it.'}
    catch(x){lg.busy=false;lg.err='Can’t reach the server. Check your connection.'}
    draw();
  }
  else if(a==='logout'){Store.logout();db=null;ready=true;lg.err='';draw()}
  else if(a==='notifperm'){try{await Notification.requestPermission()}catch(x){}draw()}
  else if(a==='chgpin'){
    const v=document.getElementById('newpin').value.trim();
    if(!/^\d{4,8}$/.test(v)){toast('PIN must be 4 to 8 digits');return}
    const r=await Store.setPin(Store.who(),v);toast(r.ok?'PIN changed':'Couldn’t change PIN');draw();
  }
  else if(a==='setpin'){
    const s=b.dataset.s,v=(document.querySelector('[data-pin="'+s+'"]').value||'').trim();
    if(!/^\d{4,8}$/.test(v)){toast('PIN must be 4 to 8 digits');return}
    const r=await Store.setPin(s,v);toast(r.ok?'PIN set':'Couldn’t set PIN');draw();
  }
  else if(a==='mkmgr'){const sid=b.dataset.s,v=(document.querySelector('[data-pin="'+sid+'"]').value||'').trim();if(!/^\d{4,8}$/.test(v)){toast('Type a 4 to 8 digit PIN for them first');return}const r=await Store.setPin(sid,v,true);toast(r.ok?'They’re now a manager':'Couldn’t update');draw()}
  else if(a==='setadmin'){const r=await Store.setPin(b.dataset.s,null,b.dataset.v==='1');toast(r.ok?'Updated':'Couldn’t update');draw()}
  else if(a==='issue'){const r=await Store.issuePins();if(r.ok){issued=r.list;draw()}else toast('Couldn’t create PINs')}
  else if(a==='issuedone'){issued=null;draw()}
});
(async function(){
  Store.setOnChange(()=>{if(!db)return;sync();render()});
  Store.setOnDenied(()=>{Store.logout();db=null;ready=true;lg.err='You’ve been signed out. Please pick your name again.';draw()});
  Store.setOnNew(localAlert);
  try{lg.names=await Store.names()}catch(e){lg.names=[];lg.err='Can’t reach the server. Check your connection.'}
  const s=Store.saved();
  if(s){try{const r=await Store.login(s.staff,s.pin);if(r.ok){afterLogin();return}}catch(e){}}
  ready=true;draw();
})();

document.addEventListener('change',e=>{
  const el=e.target;if(!el.dataset.pt)return;
  const k=el.dataset.pt;
  if(k==='dow')pat.dow[el.dataset.w]=el.value;
  else if(k==='from')pat.from=el.value;
  else if(k==='to')pat.to=el.value;
  else if(k==='every')pat.every=el.value;
  else if(k==='span'){pat.span=el.value;draw()}
});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act=patapply],[data-act=patall]');if(!b||!draft)return;
  const today=iso(new Date());
  let dow=pat.dow,from=pat.from||today,every=+pat.every||1,span=pat.span,to;
  if(b.dataset.act==='patall'){dow={1:'A',2:'A',3:'A',4:'A',5:'A'};from=today;every=1;span='ongoing';pat.dow=Object.assign({},dow);pat.every='1';pat.span='ongoing';pat.from=''}
  if(span==='ongoing'){draft.base={from,dow:Object.assign({},dow)};Object.keys(draft.base.dow).forEach(k=>{if(draft.base.dow[k]==='keep')delete draft.base.dow[k]});draft.dirty=true;toast('Usual week set. Press Save to submit.');draw();return}
  if(span==='date'){to=pat.to;if(!to){toast('Pick an end date');return}}else to=addDays(from,(+span)*7-1);
  if(to<from){toast('The end date is before the start');return}
  const n=applyPattern(dow,from,to,every);
  draft.dirty=true;toast(n+' days set. Press Save to submit.');draw();
});

document.addEventListener('change',e=>{
  const el=e.target;if(!el.dataset.hr)return;
  const d=hoursOpen;if(!d)return;
  const a=acts[d+'_'+me],mine=myAsg(d);
  if(hrs.d!==d){const st=a?a.st:(mine?mine.t:7);hrs={d,st,en:a?a.en:st+8}}
  if(el.dataset.hr==='st'){const ot=hrs.en-hrs.st;hrs.st=+el.value;hrs.en=hrs.st+ot}else hrs.en=+el.value;
  draw();
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,d=b.dataset.d,c=C();
  if(a==='hropen'){hoursOpen=d;hrs={d:'',st:7,en:15};draw()}
  else if(a==='hrclose'){hoursOpen='';draw()}
  else if(a==='hrsave'){
    const ac=acts[d+'_'+me],mine=myAsg(d);
    const st=hrs.d===d?hrs.st:(ac?ac.st:(mine?mine.t:7)),en=hrs.d===d?hrs.en:(ac?ac.en:st+8);
    if(en<=st){toast('Finish must be after start');return}
    await save('act/'+d+'_'+me,{d,s:me,st,en,ts:Date.now()});
    const ot=en-st-8;
    if(ot>0||!mine||mine.t!==st)await notify(['admin'],nameOf(c,me)+' worked '+fmtT(st)+'–'+fmtT(en)+' on '+dayLabel(d)+(ot>0?' (+'+fmtDur(ot)+' overtime)':'')+(mine&&mine.t!==st?', rostered '+slotLabel(mine.t):!mine?', not rostered':''),'hours');
    hoursOpen='';toast('Hours saved');draw();
  }
  else if(a==='hrclear'){await save('act/'+d+'_'+me,null,true);hoursOpen='';draw()}
});
(function(){
  let sx=0,sy=0,on=false;
  document.addEventListener('touchstart',e=>{const t=e.target.closest('[data-swipe]');on=!!t;if(on){sx=e.touches[0].clientX;sy=e.touches[0].clientY}},{passive:true});
  document.addEventListener('touchend',e=>{
    if(!on)return;on=false;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)>60&&Math.abs(dy)<45){const p=calMonth.split('-').map(Number),dt=new Date(p[0],p[1]-1+(dx<0?1:-1),1);calMonth=iso(dt).slice(0,7);draw()}
  },{passive:true});
})();

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act=callreason]');if(!b)return;call.reason=b.dataset.v;draw();
});
document.addEventListener('change',e=>{
  const el=e.target,k=el.dataset.cl;if(!k)return;
  if(k==='who'){call.who=el.value;call.touched=false;call.d=''}
  else if(k==='d'){call.d=el.value;call.touched=true}
  else if(k==='note'){call.note=el.value;return}
  draw();
});

setInterval(checkCasesAlert,60000);
