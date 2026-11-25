(function(){
  'use strict';
  const payload=window.ETF_DATA,core=window.ETFCore,NS='http://www.w3.org/2000/svg';
  if(!payload||!payload.datasets||!core){document.body.innerHTML='<p class="fatal-error">ETF data failed to load.</p>';return;}
  const data={net_flows:payload.datasets.net_flow||[],holdings_native:payload.datasets.btc_holdings||[],balances_usd:payload.datasets.usd_balances||[],btc_price:payload.datasets.btc_price||[]};
  const $=id=>document.getElementById(id),svgEl=(name,attrs={})=>{const node=document.createElementNS(NS,name);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));return node;};
  const fmtUsd=value=>value==null?'N/A':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:Math.abs(value)>=1e9?'compact':'standard',maximumFractionDigits:Math.abs(value)>=1e9?2:0}).format(value);
  const fmtBtc=value=>value==null?'N/A':`${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value)} BTC`;
  const fmtPct=value=>value==null?'N/A':`${value.toFixed(2)}%`,fmtPp=value=>value==null?'N/A':`${value>=0?'+':''}${value.toFixed(2)} pp`;
  const signedUsd=value=>value==null?'N/A':`${value>=0?'+':''}${fmtUsd(value)}`,signedBtc=value=>value==null?'N/A':`${value>=0?'+':''}${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value)} BTC`;
  const allDates=[...(data.net_flows||[]),...(data.holdings_native||[]),...(data.balances_usd||[])].map(row=>row.date).sort();
  const startInput=$('etfStartDate'),endInput=$('etfEndDate');
  startInput.min=endInput.min=allDates[0];startInput.max=endInput.max=allDates.at(-1);
  startInput.value=allDates[0];endInput.value=allDates.at(-1);
  $('retrievedAt').textContent=`数据获取时间 ${new Date(payload.retrieved_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`;
  let holdingsSort='change';

  function clear(svg){while(svg.firstChild)svg.removeChild(svg.firstChild)}
  function scale(value,min,max,a,b){return max===min?(a+b)/2:a+(value-min)/(max-min)*(b-a)}
  function warning(id,message){const el=$(id);el.hidden=!message;el.textContent=message||''}
  function axisText(svg,x,y,text,anchor='middle',className='rank-label'){const node=svgEl('text',{x,y,'text-anchor':anchor,class:className});node.textContent=text;svg.appendChild(node)}
  function tooltipFor(container,tooltip,event,html){tooltip.innerHTML=html;tooltip.style.display='block';const box=container.getBoundingClientRect();tooltip.style.left=`${Math.min(event.clientX-box.left+12,box.width-tooltip.offsetWidth-4)}px`;tooltip.style.top=`${Math.max(4,event.clientY-box.top-tooltip.offsetHeight-12)}px`}
  function hideTooltip(tooltip){tooltip.style.display='none'}

  function drawFlow(result){
    const svg=$('flowChart'),tip=$('flowTooltip'),wrap=svg.parentElement;clear(svg);const width=Math.max(720,wrap.clientWidth),height=wrap.clientHeight,margin={top:18,right:72,bottom:50,left:82},w=width-margin.left-margin.right,h=height-margin.top-margin.bottom;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    if(!result.series.length){axisText(svg,width/2,height/2,'所选区间无完整交易日流量数据');return}
    const maxAbs=Math.max(...result.series.map(row=>Math.abs(row.netFlow)),1),prices=result.series.map(row=>row.price).filter(Number.isFinite),pMin=Math.min(...prices),pMax=Math.max(...prices),zero=margin.top+h/2,step=w/result.series.length,barWidth=Math.max(3,Math.min(24,step*.62));
    for(let i=-2;i<=2;i++){const y=zero-i*h/4;svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+w,y1:y,y2:y,stroke:'#e8e8e8'}));axisText(svg,margin.left-10,y+4,fmtUsd(i*maxAbs/2),'end')}
    svg.appendChild(svgEl('line',{x1:margin.left,x2:margin.left+w,y1:zero,y2:zero,class:'etf-zero'}));
    const points=[];result.series.forEach((row,index)=>{const x=margin.left+step*index+step/2,y=scale(row.netFlow,-maxAbs,maxAbs,margin.top+h,margin.top),rect=svgEl('rect',{x:x-barWidth/2,y:Math.min(y,zero),width:barWidth,height:Math.max(1,Math.abs(zero-y)),class:row.netFlow>=0?'etf-positive':'etf-negative'});rect.addEventListener('mousemove',event=>tooltipFor(wrap,tip,event,`<b>${row.date}</b><br>Net Flow: ${signedUsd(row.netFlow)}<br>BTC Price: ${fmtUsd(row.price)}`));rect.addEventListener('mouseleave',()=>hideTooltip(tip));svg.appendChild(rect);if(Number.isFinite(row.price))points.push(`${x},${scale(row.price,pMin,pMax,margin.top+h,margin.top)}`);if(index===0||index===result.series.length-1||index%Math.ceil(result.series.length/6)===0)axisText(svg,x,height-18,row.date.slice(5));});
    if(points.length>1)svg.appendChild(svgEl('polyline',{points:points.join(' '),class:'etf-price-line'}));
    if(prices.length){axisText(svg,width-6,margin.top+5,fmtUsd(pMax),'end','axis-right');axisText(svg,width-6,margin.top+h,fmtUsd(pMin),'end','axis-right')}
  }

  function drawDiverging(rows){
    const svg=$('holdingsChart'),tip=$('holdingsTooltip'),wrap=svg.parentElement;clear(svg);const valid=rows.filter(row=>row.change!==null),width=Math.max(720,wrap.clientWidth),height=wrap.clientHeight,margin={top:14,right:95,bottom:18,left:70},w=width-margin.left-margin.right;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);if(!valid.length){axisText(svg,width/2,height/2,'需要开始日前和结束日前的完整同步快照');return}
    const maxAbs=Math.max(...valid.map(row=>Math.abs(row.change)),1),rowH=(height-margin.top-margin.bottom)/valid.length,zero=margin.left+w/2;svg.appendChild(svgEl('line',{x1:zero,x2:zero,y1:margin.top,y2:height-margin.bottom,class:'etf-zero'}));
    valid.forEach((row,index)=>{const y=margin.top+index*rowH+rowH*.18,barH=Math.max(5,rowH*.58),barW=Math.abs(row.change)/maxAbs*w*.46,x=row.change>=0?zero:zero-barW,rect=svgEl('rect',{x,y,width:barW,height:barH,class:row.change>=0?'etf-positive':'etf-negative'});rect.addEventListener('mousemove',event=>tooltipFor(wrap,tip,event,`<b>${row.ticker}</b><br>Start: ${fmtBtc(row.start)}<br>End: ${fmtBtc(row.end)}<br>Change: ${signedBtc(row.change)} (${fmtPct(row.changePct)})`));rect.addEventListener('mouseleave',()=>hideTooltip(tip));svg.appendChild(rect);axisText(svg,margin.left-10,y+barH*.72,row.ticker,'end');axisText(svg,row.change>=0?x+barW+7:x-7,y+barH*.72,signedBtc(row.change),row.change>=0?'start':'end','rank-value')});
  }

  function drawShares(rows){
    const svg=$('shareChart'),tip=$('shareTooltip'),wrap=svg.parentElement;clear(svg);const valid=rows.filter(row=>row.endShare!==null),width=Math.max(720,wrap.clientWidth),height=wrap.clientHeight,margin={top:14,right:145,bottom:25,left:70},w=width-margin.left-margin.right;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);if(!valid.length){axisText(svg,width/2,height/2,'需要开始日前和结束日前的完整同步快照');return}
    const max=Math.max(...valid.map(row=>row.endShare),1),rowH=(height-margin.top-margin.bottom)/valid.length;
    valid.forEach((row,index)=>{const y=margin.top+index*rowH+rowH*.18,barH=Math.max(5,rowH*.58),barW=row.endShare/max*w,rect=svgEl('rect',{x:margin.left,y,width:barW,height:barH,fill:'#ff8a00'});rect.addEventListener('mousemove',event=>tooltipFor(wrap,tip,event,`<b>${row.ticker}</b><br>Start Share: ${fmtPct(row.startShare)}<br>End Share: ${fmtPct(row.endShare)}<br>Change: ${fmtPp(row.changePp)}<br>USD Balance: ${fmtUsd(row.endBalance)}`));rect.addEventListener('mouseleave',()=>hideTooltip(tip));svg.appendChild(rect);axisText(svg,margin.left-10,y+barH*.72,row.ticker,'end');axisText(svg,margin.left+barW+7,y+barH*.72,`${fmtPct(row.endShare)} · ${fmtPp(row.changePp)}`,'start','rank-value')});
  }

  function tableHoldings(result){
    const rows=[...result.rows].sort((a,b)=>(b[holdingsSort]??-Infinity)-(a[holdingsSort]??-Infinity));$('holdingsTable').innerHTML=rows.map(row=>`<tr><td>${row.ticker}</td><td>${fmtBtc(row.start)}</td><td>${fmtBtc(row.end)}</td><td class="${row.change>=0?'positive-value':'negative-value'}">${signedBtc(row.change)}</td><td>${fmtPct(row.changePct)}</td></tr>`).join('')||'<tr><td colspan="5">N/A</td></tr>';
  }
  function tableShares(result){$('shareTable').innerHTML=result.rows.map(row=>`<tr><td>${row.ticker}</td><td>${fmtPct(row.startShare)}</td><td>${fmtPct(row.endShare)}</td><td class="${row.changePp>=0?'positive-value':'negative-value'}">${fmtPp(row.changePp)}</td><td>${fmtUsd(row.endBalance)}</td></tr>`).join('')||'<tr><td colspan="5">N/A</td></tr>'}
  function partialNotice(result,label,end){if(!result.cutoff)return `${label} 暂无完整同步数据。`;if(result.incomplete)return `选择结束日 ${end} 晚于完整数据截止 ${result.cutoff}；仅展示截止日以内的完整数据，不补零、不估算。`;return result.valid===false?'所选区间缺少可比较的完整同步快照。':''}

  function render(){
    let start=startInput.value,end=endInput.value;if(start>end){[start,end]=[end,start];startInput.value=start;endInput.value=end}
    const flow=core.selectFlows(data.net_flows,data.btc_price,start,end),holdings=core.holdingsChanges(data.holdings_native,start,end),shares=core.marketShares(data.balances_usd,start,end);
    $('flowCutoff').textContent=`ETF Net Flow · 数据截至 ${flow.cutoff||'N/A'}`;$('holdingsCutoff').textContent=`BTC Holdings · 数据截至 ${holdings.cutoff||'N/A'}`;$('shareCutoff').textContent=`USD Balance Market Share · 数据截至 ${shares.cutoff||'N/A'}`;
    $('flowEffective').textContent=flow.effectiveStart?`有效区间 ${flow.effectiveStart} → ${flow.effectiveEnd}`:'有效区间 N/A';$('holdingsEffective').textContent=holdings.valid?`同步快照 ${holdings.baseline.date} → ${holdings.end.date}`:'同步快照 N/A';$('shareEffective').textContent=shares.valid?`同步快照 ${shares.baseline.date} → ${shares.end.date}`:'同步快照 N/A';
    warning('flowWarning',flow.incomplete?`选择结束日 ${end} 晚于流量数据截止 ${flow.cutoff}；区间合计仅覆盖已完整报告的交易日。`:'');warning('holdingsWarning',partialNotice(holdings,'BTC Holdings',end));warning('shareWarning',partialNotice(shares,'USD Balance',end));
    $('netFlowKpi').textContent=flow.series.length?signedUsd(flow.total):'N/A';$('flowDaysKpi').textContent=flow.series.length?`${flow.inflowDays} / ${flow.outflowDays}`:'N/A';$('flowAssetsKpi').textContent=shares.valid?fmtUsd(shares.endTotal):'N/A';
    drawFlow(flow);drawDiverging(holdings.rows);drawShares(shares.rows);tableHoldings(holdings);tableShares(shares);$('researchSummary').textContent=core.researchSummary(flow,holdings,shares)||'当前区间数据不足，无法生成可靠观察。';
  }
  [startInput,endInput].forEach(input=>input.addEventListener('change',render));document.querySelectorAll('[data-holdings-sort]').forEach(button=>button.addEventListener('click',()=>{holdingsSort=button.dataset.holdingsSort;render()}));window.addEventListener('resize',render);render();
})();
