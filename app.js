const $=s=>document.querySelector(s);
const usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const btc=n=>new Intl.NumberFormat('en-US',{minimumFractionDigits:3,maximumFractionDigits:3}).format(n);
const signed=n=>`${n>=0?'+':'−'}${btc(Math.abs(n))}`;
const axis=n=>n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${Math.round(n/1e3)}K`:`${Math.round(n)}`;
const isoDate=ts=>new Date(ts*1000).toISOString().slice(0,10);
const state={rows:[],byDate:new Map(),start:null,end:null,selection:null,dragging:false,dragStart:null,chart:null,migrationCache:null,depletionCache:null};

function draw(start,end){
  const wrap=$('#chartWrap'),svg=$('#chart');
  const data=end.partitions.map((endSupply,j)=>({start:start.partitions[j],end:endSupply,delta:endSupply-start.partitions[j],price:end.ath_price*(j+1)/100}));
  const W=Math.max(480,wrap.clientWidth),H=Math.max(420,wrap.clientHeight),m={t:8,r:18,b:92,l:64},w=W-m.l-m.r,h=H-m.t-m.b;
  const peak=Math.max(...data.flatMap(d=>[d.start,d.end])),max=Math.ceil(peak/100000)*100000,bw=w/data.length,NS='http://www.w3.org/2000/svg',same=start.t===end.t;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML='';
  const add=(parent,tag,a,text)=>{const e=document.createElementNS(NS,tag);Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;parent.appendChild(e);return e};
  const defs=add(svg,'defs',{}),pattern=add(defs,'pattern',{id:'decreasePattern',width:6,height:6,patternUnits:'userSpaceOnUse',patternTransform:'rotate(45)'});add(pattern,'rect',{width:6,height:6,fill:'#c7c7c7'});add(pattern,'line',{x1:0,y1:0,x2:0,y2:6,stroke:'#8d8d8d','stroke-width':2});
  for(let i=0;i<=7;i++){const f=i/7,y=m.t+h-h*f;add(svg,'line',{x1:m.l,y1:y,x2:W-m.r,y2:y,class:'grid'});add(svg,'text',{x:m.l-10,y:y+4,'text-anchor':'end',class:'axis'},i?axis(max*f):'0')}
  data.forEach((d,j)=>{
    const x=m.l+j*bw,barX=x+bw*.18,barWidth=Math.max(1,bw*.64),group=add(svg,'g',{class:'bar-group'}),min=Math.min(d.start,d.end),minH=min/max*h;
    if(same){add(group,'rect',{x:barX,y:m.t+h-d.end/max*h,width:barWidth,height:d.end/max*h,class:'single'})}
    else{
      add(group,'rect',{x:barX,y:m.t+h-minH,width:barWidth,height:minH,class:'retained'});
      if(d.delta>0)add(group,'rect',{x:barX,y:m.t+h-d.end/max*h,width:barWidth,height:d.delta/max*h,class:'increase'});
      if(d.delta<0)add(group,'rect',{x:barX,y:m.t+h-d.start/max*h,width:barWidth,height:(d.start-d.end)/max*h,class:'decrease'});
    }
    const hit=add(group,'rect',{x:barX,y:m.t,width:barWidth,height:h,class:'bar-hit'});hit.addEventListener('mousemove',e=>tip(e,d,start,end,svg,m,h,x+bw/2));hit.addEventListener('mouseleave',hide);
  });
  const every=W<800?10:8;data.forEach((d,j)=>{if(j%every&&j!==data.length-1)return;const x=m.l+j*bw+bw/2,y=H-m.b+17;add(svg,'text',{x,y,transform:`rotate(-50 ${x} ${y})`,'text-anchor':'end',class:'axis'},usd(d.price))});
  const px=m.l+end.current_price/end.ath_price*w;add(svg,'line',{x1:px,y1:m.t,x2:px,y2:m.t+h,class:'price'});
  const labelText=`CURRENT ${usd(end.current_price)}`,labelWidth=142,labelX=Math.min(W-m.r-labelWidth,Math.max(m.l,px-labelWidth/2));
  add(svg,'rect',{x:labelX,y:m.t,width:labelWidth,height:26,rx:2,class:'price-label-bg'});
  add(svg,'text',{x:labelX+labelWidth/2,y:m.t+17,'text-anchor':'middle',class:'price-label'},labelText);
  state.chart={svg,data,m,w,h,bw,W,H,start,end};
  renderSelection();
  svg.onpointerdown=e=>{
    const index=pointerIndex(e);if(index===null)return;
    state.dragging=true;state.dragStart=index;state.selection=[index,index];renderSelection();hide();e.preventDefault();
  };
  svg.onpointermove=e=>{
    if(!state.dragging)return;const index=pointerIndex(e);if(index===null)return;
    state.selection=[Math.min(state.dragStart,index),Math.max(state.dragStart,index)];renderSelection();
  };
  svg.ondblclick=()=>{state.selection=null;renderSelection()};
}
function pointerIndex(e){
  const c=state.chart;if(!c)return null;const rect=c.svg.getBoundingClientRect(),x=(e.clientX-rect.left)*c.W/rect.width,y=(e.clientY-rect.top)*c.H/rect.height;
  if(x<c.m.l||x>c.m.l+c.w||y<c.m.t||y>c.m.t+c.h)return null;
  return Math.max(0,Math.min(c.data.length-1,Math.floor((x-c.m.l)/c.bw)));
}
function renderSelection(){
  const c=state.chart;if(!c)return;c.svg.querySelectorAll('.selection-layer').forEach(n=>n.remove());
  const summary=$('#selectionSummary');if(!state.selection){summary.hidden=true;return}
  const [a,b]=state.selection,NS='http://www.w3.org/2000/svg',g=document.createElementNS(NS,'g');g.setAttribute('class','selection-layer');
  const x=c.m.l+a*c.bw,width=(b-a+1)*c.bw,rect=document.createElementNS(NS,'rect');Object.entries({x,y:c.m.t,width,height:c.h,class:'selection-band'}).forEach(([k,v])=>rect.setAttribute(k,v));g.appendChild(rect);
  [x,x+width].forEach(edge=>{const line=document.createElementNS(NS,'line');Object.entries({x1:edge,x2:edge,y1:c.m.t,y2:c.m.t+c.h,class:'selection-edge'}).forEach(([k,v])=>line.setAttribute(k,v));g.appendChild(line)});c.svg.appendChild(g);
  const selected=c.data.slice(a,b+1),supply=selected.reduce((sum,d)=>sum+d.end,0),change=selected.reduce((sum,d)=>sum+d.delta,0),changeEl=$('#selectedChange');
  $('#selectedPrice').textContent=`${usd(selected[0].price)} – ${usd(selected.at(-1).price)}`;$('#selectedSupply').textContent=`${btc(supply)} BTC`;changeEl.textContent=`${signed(change)} BTC`;changeEl.className=change>=0?'positive':'negative';summary.hidden=false;
}
function tip(e,d,start,end,svg,m,h,x){
  svg.querySelectorAll('.crosshair').forEach(n=>n.remove());const l=document.createElementNS('http://www.w3.org/2000/svg','line');Object.entries({x1:x,x2:x,y1:m.t,y2:m.t+h,class:'crosshair'}).forEach(([k,v])=>l.setAttribute(k,v));svg.appendChild(l);
  const t=$('#tooltip'),share=d.end/end.total_supply*100,deltaPct=d.start?d.delta/d.start*100:0,cls=d.delta>=0?'positive':'negative';
  t.innerHTML=`<div class="tip-price">${usd(d.price)}</div><div class="tip-row"><span>End UTXO supply</span><b>${btc(d.end)} BTC (${share.toFixed(2)}%)</b></div><div class="tip-row"><span>${isoDate(start.t)} → ${isoDate(end.t)}</span><b>${btc(d.start)} → ${btc(d.end)}</b></div><div class="tip-row"><span>Net change</span><b class="${cls}">${signed(d.delta)} BTC (${d.delta>=0?'+':''}${deltaPct.toFixed(2)}%)</b></div>`;
  t.style.display='block';const r=$('#chartWrap').getBoundingClientRect();t.style.left=`${Math.min(r.width-t.offsetWidth-6,Math.max(6,e.clientX-r.left+12))}px`;t.style.top=`${Math.min(r.height-t.offsetHeight-6,Math.max(6,e.clientY-r.top-t.offsetHeight-10))}px`;
}
function hide(){$('#tooltip').style.display='none';$('#chart').querySelectorAll('.crosshair').forEach(n=>n.remove())}
function migrationReason(reason){
  if(reason==='bucket-boundary-change')return'所选时间区间内 ATH 分区边界发生变化，无法按相同 USD 价格桶可靠比较。';
  if(reason==='missing-daily-snapshot')return'所选时间区间缺少连续日度快照，累计指标不可计算。';
  return'所选时间区间数据不完整，累计指标不可计算。';
}
function setMigrationMetric(result,rateSelector,volumeSelector){
  if(!result.valid){$(rateSelector).textContent='N/A';$(volumeSelector).textContent='N/A';return}
  $(rateSelector).textContent=URPDMigration.formatRate(result.rate);$(volumeSelector).textContent=URPDMigration.formatVolume(result.volume);
}
function updateMigrationPanel(){
  if(!state.migrationCache||!state.start||!state.end)return;
  const result=URPDMigration.aggregateRange(state.migrationCache,state.start.t,state.end.t),sevenDay=URPDMigration.aggregateRange(state.migrationCache,state.end.t-7*URPDMigration.DAY_SECONDS,state.end.t),thirtyDay=URPDMigration.aggregateRange(state.migrationCache,state.end.t-30*URPDMigration.DAY_SECONDS,state.end.t),warning=$('#migrationWarning');
  setMigrationMetric(sevenDay,'#migration7dRate','#migration7dVolume');setMigrationMetric(thirtyDay,'#migration30dRate','#migration30dVolume');
  if(!result.valid){
    $('#migrationRate').textContent='N/A';$('#migrationVolume').textContent='N/A';warning.textContent=migrationReason(result.reason);warning.hidden=false;drawMigrationChart([]);return;
  }
  setMigrationMetric(result,'#migrationRate','#migrationVolume');
  if(result.anomalyCount){warning.textContent=`${result.anomalyCount} 个日度区间的可比供给变化超过 0.10%，请结合供给覆盖变化解读。`;warning.hidden=false}else warning.hidden=true;
  drawMigrationChart(result.daily);
}
function drawMigrationChart(series){
  const wrap=$('#migrationChartWrap'),svg=$('#migrationChart'),W=Math.max(360,wrap.clientWidth),H=Math.max(220,wrap.clientHeight),m={t:12,r:18,b:42,l:64},w=W-m.l-m.r,h=H-m.t-m.b,NS='http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML='';
  const add=(tag,a,text)=>{const e=document.createElementNS(NS,tag);Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;svg.appendChild(e);return e};
  const maxRate=series.length?Math.max(...series.map(d=>d.rate),0.01):0.01,top=Math.ceil(maxRate*100)/100;
  for(let i=0;i<=4;i++){const f=i/4,y=m.t+h-h*f;add('line',{x1:m.l,y1:y,x2:W-m.r,y2:y,class:'grid'});add('text',{x:m.l-10,y:y+4,'text-anchor':'end',class:'axis'},`${(top*f).toFixed(2)}%`)}
  if(!series.length){add('text',{x:m.l+w/2,y:m.t+h/2,'text-anchor':'middle',class:'axis'},'No daily migration intervals');return}
  const bw=w/series.length,labelEvery=Math.max(1,Math.ceil(series.length/6));
  series.forEach((d,index)=>{
    const x=m.l+index*bw,bh=d.rate/top*h,bar=add('rect',{x:x+bw*.18,y:m.t+h-bh,width:Math.max(2,bw*.64),height:bh,class:'migration-bar'});
    bar.addEventListener('mousemove',event=>showMigrationTip(event,d));bar.addEventListener('mouseleave',()=>{$('#migrationTooltip').style.display='none'});
    if(index%labelEvery===0||index===series.length-1)add('text',{x:x+bw/2,y:H-15,'text-anchor':'middle',class:'axis'},isoDate(d.date).slice(5));
  });
}
function showMigrationTip(event,item){
  const tip=$('#migrationTooltip'),wrap=$('#migrationChartWrap'),rect=wrap.getBoundingClientRect();tip.innerHTML=`<b>${isoDate(item.date)}</b><br>Daily migration rate: ${URPDMigration.formatRate(item.rate)}<br>Daily migration volume: ${URPDMigration.formatVolume(item.volume)}`;tip.style.display='block';tip.style.left=`${Math.min(rect.width-tip.offsetWidth-6,Math.max(6,event.clientX-rect.left+12))}px`;tip.style.top=`${Math.min(rect.height-tip.offsetHeight-6,Math.max(6,event.clientY-rect.top-tip.offsetHeight-10))}px`;
}
function depletionReason(reason){
  if(reason==='bucket-boundary-change')return'所选时间区间内 ATH 分区边界发生变化，盈利/亏损净流失不可可靠比较。';
  if(reason==='missing-daily-snapshot')return'所选时间区间缺少连续日度快照，盈利/亏损净流失不可计算。';
  if(reason==='missing-price')return'所选时间区间缺少与 URPD 快照同步的 BTC 价格。';
  return'所选时间区间数据不完整，盈利/亏损净流失不可计算。';
}
function setDepletionPeriod(result,profitSelector,lossSelector,trackSelector,profitBarSelector,lossBarSelector){
  const track=$(trackSelector),valid=result.valid&&result.profitShare!==null&&result.lossShare!==null;
  if(!valid){$(profitSelector).textContent='N/A';$(lossSelector).textContent='N/A';$(profitBarSelector).style.width='0%';$(lossBarSelector).style.width='0%';track.classList.add('is-na');return}
  $(profitSelector).textContent=URPDDepletion.formatShare(result.profitShare);$(lossSelector).textContent=URPDDepletion.formatShare(result.lossShare);$(profitBarSelector).style.width=`${result.profitShare}%`;$(lossBarSelector).style.width=`${result.lossShare}%`;track.classList.remove('is-na');
}
function updateDepletionPanel(){
  if(!state.depletionCache||!state.start||!state.end)return;
  const selected=URPDDepletion.aggregateRange(state.depletionCache,state.start.t,state.end.t),sevenDay=URPDDepletion.aggregateRange(state.depletionCache,state.end.t-7*URPDMigration.DAY_SECONDS,state.end.t),thirtyDay=URPDDepletion.aggregateRange(state.depletionCache,state.end.t-30*URPDMigration.DAY_SECONDS,state.end.t),warning=$('#depletionWarning');
  setDepletionPeriod(sevenDay,'#depletion7dProfit','#depletion7dLoss','#depletion7dTrack','#depletion7dProfitBar','#depletion7dLossBar');setDepletionPeriod(thirtyDay,'#depletion30dProfit','#depletion30dLoss','#depletion30dTrack','#depletion30dProfitBar','#depletion30dLossBar');
  if(!selected.valid){setDepletionPeriod(selected,'#depletionProfit','#depletionLoss','#depletionTrack','#depletionProfitBar','#depletionLossBar');warning.textContent=depletionReason(selected.reason);warning.hidden=false;drawDepletionChart([]);return}
  setDepletionPeriod(selected,'#depletionProfit','#depletionLoss','#depletionTrack','#depletionProfitBar','#depletionLossBar');
  if(selected.unclassifiedShare!==null&&selected.unclassifiedShare>5){warning.textContent=`未分类净流失占总观察净流失的 ${URPDDepletion.formatShare(selected.unclassifiedShare)}，构成占比需谨慎解读。`;warning.hidden=false}else warning.hidden=true;
  drawDepletionChart(selected.daily);
}
function drawDepletionChart(series){
  const wrap=$('#depletionChartWrap'),svg=$('#depletionChart'),W=Math.max(420,wrap.clientWidth),H=Math.max(270,wrap.clientHeight),m={t:18,r:78,b:42,l:96},w=W-m.l-m.r,h=H-m.t-m.b,NS='http://www.w3.org/2000/svg';svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML='';
  const add=(tag,a,text)=>{const e=document.createElementNS(NS,tag);Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;svg.appendChild(e);return e};
  const zeroY=m.t+h/2,half=h/2;
  [100,50].forEach(value=>{const y=zeroY-value/100*half;add('line',{x1:m.l,y1:y,x2:W-m.r,y2:y,class:'grid'});add('text',{x:m.l-10,y:y+4,'text-anchor':'end',class:'axis'},value===100?'100% Profit':'50%')});
  [50,100].forEach(value=>{const y=zeroY+value/100*half;add('line',{x1:m.l,y1:y,x2:W-m.r,y2:y,class:'grid'});add('text',{x:m.l-10,y:y+4,'text-anchor':'end',class:'axis'},value===100?'100% Loss':'50%')});
  add('line',{x1:m.l,y1:zeroY,x2:W-m.r,y2:zeroY,class:'depletion-zero'});add('text',{x:m.l-10,y:zeroY+4,'text-anchor':'end',class:'axis'},'0%');
  if(!series.length){add('text',{x:m.l+w/2,y:m.t+h/2,'text-anchor':'middle',class:'axis'},'No daily depletion intervals');return}
  const prices=series.map(d=>d.price),priceMin=Math.min(...prices),priceMax=Math.max(...prices),pricePad=Math.max(1,(priceMax-priceMin)*.08),pMin=priceMin-pricePad,pMax=priceMax+pricePad,priceY=value=>m.t+(pMax-value)/(pMax-pMin)*h,bw=w/series.length,labelEvery=Math.max(1,Math.ceil(series.length/6)),points=[];
  [pMax,(pMax+pMin)/2,pMin].forEach(value=>{const y=priceY(value);add('text',{x:W-m.r+10,y:y+4,class:'depletion-price-axis'},usd(value))});
  series.forEach((d,index)=>{
    const x=m.l+index*bw,profitH=(d.profitShare??0)/100*half,lossH=(d.lossShare??0)/100*half,barWidth=Math.max(3,bw*.62),barX=x+(bw-barWidth)/2;
    add('rect',{x:barX,y:zeroY-profitH,width:barWidth,height:profitH,class:'depletion-profit'});add('rect',{x:barX,y:zeroY,width:barWidth,height:lossH,class:'depletion-loss'});points.push(`${x+bw/2},${priceY(d.price)}`);
    const hit=add('rect',{x,y:m.t,width:bw,height:h,fill:'transparent'});hit.addEventListener('mousemove',event=>showDepletionTip(event,d));hit.addEventListener('mouseleave',()=>{$('#depletionTooltip').style.display='none'});
    if(index%labelEvery===0||index===series.length-1)add('text',{x:x+bw/2,y:H-15,'text-anchor':'middle',class:'axis'},isoDate(d.date).slice(5));
  });
  add('polyline',{points:points.join(' '),class:'depletion-price-line'});
}
function showDepletionTip(event,item){
  const tip=$('#depletionTooltip'),wrap=$('#depletionChartWrap'),rect=wrap.getBoundingClientRect(),quality=item.unclassifiedShare!==null&&item.unclassifiedShare>5?`<br><span class="quality-note">未分类占比较高：${URPDDepletion.formatShare(item.unclassifiedShare)}</span>`:'';tip.innerHTML=`<b>${isoDate(item.date)}</b><br>BTC Price: ${usd(item.price)}<br><span class="depletion-profit-text">盈利侧净流失占比: ${URPDDepletion.formatShare(item.profitShare)}</span><br><span class="depletion-loss-text">亏损侧净流失占比: ${URPDDepletion.formatShare(item.lossShare)}</span>${quality}`;tip.style.display='block';tip.style.left=`${Math.min(rect.width-tip.offsetWidth-6,Math.max(6,event.clientX-rect.left+12))}px`;tip.style.top=`${Math.min(rect.height-tip.offsetHeight-6,Math.max(6,event.clientY-rect.top-tip.offsetHeight-10))}px`;
}
function updateRange(changed){
  const startInput=$('#startDate'),endInput=$('#endDate');
  if(startInput.value>endInput.value){if(changed==='start')endInput.value=startInput.value;else startInput.value=endInput.value}
  state.start=state.byDate.get(startInput.value);state.end=state.byDate.get(endInput.value);
  if(state.start&&state.end){draw(state.start,state.end);updateMigrationPanel();updateDepletionPanel()}
}
window.addEventListener('pointerup',()=>{state.dragging=false});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){state.selection=null;renderSelection()}});
function initialize(rows){
  state.rows=rows;state.byDate=new Map(rows.map(row=>[isoDate(row.t),row]));state.migrationCache=URPDMigration.buildCache(rows);state.depletionCache=URPDDepletion.buildCache(rows);
  const first=isoDate(rows[0].t),last=isoDate(rows.at(-1).t),start=$('#startDate'),end=$('#endDate');
  start.min=end.min=first;start.max=end.max=last;start.value=first;end.value=last;
  start.addEventListener('change',()=>updateRange('start'));end.addEventListener('change',()=>updateRange('end'));
  updateRange();window.addEventListener('resize',()=>{draw(state.start,state.end);updateMigrationPanel();updateDepletionPanel()});
}
if(Array.isArray(window.URPD_DATA))initialize(window.URPD_DATA);
else fetch('data/utxo.json').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(initialize).catch(error=>{
  $('#migrationWarning').hidden=false;$('#migrationWarning').textContent=`URPD data failed to load: ${error.message}`;
});
