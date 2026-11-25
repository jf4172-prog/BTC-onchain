(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ETFCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DAY=86400000;
  const dateValue=value=>Date.parse(`${value}T00:00:00Z`);
  const iso=value=>new Date(value).toISOString().slice(0,10);
  const ordered=rows=>[...(rows||[])].sort((a,b)=>dateValue(a.date)-dateValue(b.date));
  const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));

  function nthWeekday(year,month,weekday,n){
    const first=new Date(Date.UTC(year,month,1)),offset=(weekday-first.getUTCDay()+7)%7;
    return iso(Date.UTC(year,month,1+offset+(n-1)*7));
  }
  function lastWeekday(year,month,weekday){
    const last=new Date(Date.UTC(year,month+1,0)),offset=(last.getUTCDay()-weekday+7)%7;
    return iso(Date.UTC(year,month,last.getUTCDate()-offset));
  }
  function observed(year,month,day){
    const value=new Date(Date.UTC(year,month,day)),weekday=value.getUTCDay();
    if(weekday===6)value.setUTCDate(value.getUTCDate()-1);
    if(weekday===0)value.setUTCDate(value.getUTCDate()+1);
    return iso(value);
  }
  function easterSunday(year){
    const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31)-1,day=(h+l-7*m+114)%31+1;
    return Date.UTC(year,month,day);
  }
  function marketHolidays(year){
    const goodFriday=iso(easterSunday(year)-2*DAY);
    return new Set([
      observed(year,0,1),nthWeekday(year,0,1,3),nthWeekday(year,1,1,3),goodFriday,
      lastWeekday(year,4,1),observed(year,5,19),observed(year,6,4),nthWeekday(year,8,1,1),
      nthWeekday(year,10,4,4),observed(year,11,25)
    ]);
  }
  function isTradingDate(date){
    const value=new Date(`${date}T00:00:00Z`),day=value.getUTCDay();
    return day!==0&&day!==6&&!marketHolidays(value.getUTCFullYear()).has(date);
  }
  function latestDate(rows,predicate=()=>true){
    const matches=ordered(rows).filter(predicate);return matches.length?matches.at(-1).date:null;
  }
  function productReportingDates(rows){
    const result={};ordered(rows).forEach(row=>Object.entries(row.products||{}).forEach(([ticker,value])=>{if(finite(value))result[ticker]=row.date}));return result;
  }
  function completeSnapshots(rows){
    return ordered(rows).filter(row=>row.complete&&finite(row.total)&&row.products&&Object.keys(row.products).length);
  }
  function selectSnapshotPair(rows,startDate,endDate){
    const complete=completeSnapshots(rows),end=[...complete].reverse().find(row=>row.date<=endDate)||null,baseline=complete.find(row=>row.date>=startDate&&row.date<=endDate)||null,cutoff=complete.length?complete.at(-1).date:null;
    return{baseline,end,cutoff,incomplete:Boolean(cutoff&&endDate>cutoff),valid:Boolean(baseline&&end&&baseline.date<=end.date)};
  }
  function selectFlows(rows,prices,startDate,endDate){
    const valid=ordered(rows).filter(row=>row.date>=startDate&&row.date<=endDate&&isTradingDate(row.date)&&finite(row.net_flow_usd)),all=ordered(rows).filter(row=>isTradingDate(row.date)&&finite(row.net_flow_usd)),cutoff=all.length?all.at(-1).date:null,priceMap=new Map((prices||[]).map(row=>[row.date,Number(row.price_usd)]));
    const series=valid.map(row=>({date:row.date,netFlow:Number(row.net_flow_usd),price:priceMap.get(row.date)??null}));
    return{series,cutoff,effectiveStart:series[0]?.date||null,effectiveEnd:series.at(-1)?.date||null,total:series.reduce((sum,row)=>sum+row.netFlow,0),inflowDays:series.filter(row=>row.netFlow>0).length,outflowDays:series.filter(row=>row.netFlow<0).length,incomplete:Boolean(cutoff&&endDate>cutoff)};
  }
  function holdingsChanges(rows,startDate,endDate){
    const selection=selectSnapshotPair(rows,startDate,endDate),dates=productReportingDates(rows);
    if(!selection.valid)return{...selection,rows:[],productReportingDates:dates};
    const tickers=[...new Set([...Object.keys(selection.baseline.products),...Object.keys(selection.end.products)])];
    const result=tickers.map(ticker=>{
      const start=Number(selection.baseline.products[ticker]),end=Number(selection.end.products[ticker]),comparable=finite(start)&&finite(end),change=comparable?end-start:null;
      return{ticker,start:finite(start)?start:null,end:finite(end)?end:null,change,changePct:comparable&&start!==0?change/start*100:null,reportingDate:dates[ticker]||null};
    }).sort((a,b)=>(b.change??-Infinity)-(a.change??-Infinity));
    return{...selection,rows:result,productReportingDates:dates};
  }
  function reconciliation(snapshot){
    if(!snapshot)return null;const sum=Object.values(snapshot.products||{}).filter(finite).reduce((a,b)=>a+Number(b),0),total=Number(snapshot.total),difference=finite(total)?sum-total:null,ratio=finite(total)&&total?Math.abs(difference)/Math.abs(total)*100:null;return{sum,total:finite(total)?total:null,difference,ratio,valid:ratio===null?false:ratio<=0.1};
  }
  function marketShares(rows,startDate,endDate){
    const selection=selectSnapshotPair(rows,startDate,endDate),dates=productReportingDates(rows);
    if(!selection.valid)return{...selection,rows:[],productReportingDates:dates,endReconciliation:null};
    const startTotal=Object.values(selection.baseline.products).filter(finite).reduce((a,b)=>a+Number(b),0),endTotal=Object.values(selection.end.products).filter(finite).reduce((a,b)=>a+Number(b),0),tickers=[...new Set([...Object.keys(selection.baseline.products),...Object.keys(selection.end.products)])];
    const result=tickers.map(ticker=>{
      const start=Number(selection.baseline.products[ticker]),end=Number(selection.end.products[ticker]),startShare=finite(start)&&startTotal?start/startTotal*100:null,endShare=finite(end)&&endTotal?end/endTotal*100:null;
      return{ticker,startBalance:finite(start)?start:null,endBalance:finite(end)?end:null,startShare,endShare,changePp:startShare!==null&&endShare!==null?endShare-startShare:null,reportingDate:dates[ticker]||null};
    }).sort((a,b)=>(b.endShare??-Infinity)-(a.endShare??-Infinity));
    return{...selection,rows:result,startTotal,endTotal,productReportingDates:dates,endReconciliation:reconciliation(selection.end)};
  }
  function researchSummary(flow,holdings,shares){
    const lines=[];
    if(flow.series.length)lines.push(`所选区间 BTC 现货 ETF 整体${flow.total>=0?'净流入':'净流出'}。`);
    const comparableHoldings=holdings.rows.filter(row=>row.change!==null);
    if(comparableHoldings.length){const max=[...comparableHoldings].sort((a,b)=>b.change-a.change)[0],min=[...comparableHoldings].sort((a,b)=>a.change-b.change)[0];if(max.change>0)lines.push(`${max.ticker} 的 BTC 持仓增幅最大。`);if(min.change<0)lines.push(`${min.ticker} 的 BTC 持仓降幅最大。`)}
    const comparableShares=shares.rows.filter(row=>row.changePp!==null);
    if(comparableShares.length){const max=[...comparableShares].sort((a,b)=>b.changePp-a.changePp)[0],min=[...comparableShares].sort((a,b)=>a.changePp-b.changePp)[0];if(max.changePp>0)lines.push(`${max.ticker} 的 USD Balance 市占率提升最多。`);if(min.changePp<0)lines.push(`${min.ticker} 的 USD Balance 市占率下降最多。`)}
    return lines.join('');
  }
  return{isTradingDate,latestDate,productReportingDates,completeSnapshots,selectSnapshotPair,selectFlows,holdingsChanges,reconciliation,marketShares,researchSummary};
});
