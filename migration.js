(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.URPDMigration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DAY_SECONDS=86400;
  const sum=values=>values.reduce((total,value)=>total+value,0);

  function comparableSupply(snapshot){return sum(snapshot.partitions)}
  function sameBucketGrid(previous,current){
    if(!Array.isArray(previous.partitions)||!Array.isArray(current.partitions))return false;
    if(previous.partitions.length!==current.partitions.length)return false;
    const scale=Math.max(1,Math.abs(previous.ath_price),Math.abs(current.ath_price));
    return Math.abs(previous.ath_price-current.ath_price)<=scale*1e-10;
  }
  function invalid(reason,previous,current){return{valid:false,reason,previousTimestamp:previous?.t,currentTimestamp:current?.t}}
  function dailyMigration(previous,current){
    if(!previous||!current)return invalid('missing-snapshot',previous,current);
    if(current.t-previous.t!==DAY_SECONDS)return invalid('missing-daily-snapshot',previous,current);
    if(!sameBucketGrid(previous,current))return invalid('bucket-boundary-change',previous,current);
    if(previous.partitions.some(v=>!Number.isFinite(v))||current.partitions.some(v=>!Number.isFinite(v)))return invalid('invalid-bucket-value',previous,current);
    const deltas=current.partitions.map((value,index)=>value-previous.partitions[index]);
    const increases=sum(deltas.map(value=>Math.max(value,0)));
    const decreases=sum(deltas.map(value=>Math.max(-value,0)));
    const volume=Math.min(increases,decreases);
    const supply=comparableSupply(current);
    const netSupplyChange=sum(deltas);
    const supplyChangeRatio=supply?Math.abs(netSupplyChange)/supply:0;
    return{valid:true,date:current.t,previousDate:previous.t,volume,rate:supply?volume/supply*100:0,supply,netSupplyChange,supplyChangeRatio,materialSupplyAnomaly:supplyChangeRatio>0.001};
  }
  function buildCache(snapshots){
    const rows=[...snapshots].sort((a,b)=>a.t-b.t),indexByTimestamp=new Map(rows.map((row,index)=>[row.t,index])),daily=[];
    const prefixVolume=[0],prefixInvalid=[0],prefixAnomalies=[0];
    for(let index=1;index<rows.length;index++){
      const result=dailyMigration(rows[index-1],rows[index]);daily.push(result);
      prefixVolume[index]=prefixVolume[index-1]+(result.valid?result.volume:0);
      prefixInvalid[index]=prefixInvalid[index-1]+(result.valid?0:1);
      prefixAnomalies[index]=prefixAnomalies[index-1]+(result.valid&&result.materialSupplyAnomaly?1:0);
    }
    return{rows,daily,indexByTimestamp,prefixVolume,prefixInvalid,prefixAnomalies};
  }
  function aggregateRange(cache,startTimestamp,endTimestamp){
    const startIndex=cache.indexByTimestamp.get(startTimestamp),endIndex=cache.indexByTimestamp.get(endTimestamp);
    if(startIndex===undefined||endIndex===undefined)return{valid:false,reason:'date-not-found'};
    if(startIndex>endIndex)return{valid:false,reason:'invalid-range'};
    const supply=comparableSupply(cache.rows[endIndex]);
    if(startIndex===endIndex)return{valid:true,volume:0,rate:0,supply,observations:0,daily:[],anomalyCount:0};
    const invalidCount=cache.prefixInvalid[endIndex]-cache.prefixInvalid[startIndex];
    const daily=cache.daily.slice(startIndex,endIndex);
    if(invalidCount)return{valid:false,reason:daily.find(item=>!item.valid)?.reason||'incomplete-range',daily,observations:daily.length};
    const volume=cache.prefixVolume[endIndex]-cache.prefixVolume[startIndex];
    return{valid:true,volume,rate:supply?volume/supply*100:0,supply,observations:daily.length,daily,anomalyCount:cache.prefixAnomalies[endIndex]-cache.prefixAnomalies[startIndex]};
  }
  function formatRate(value){return`${value.toFixed(2)}%`}
  function formatVolume(value){return`${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value)} BTC`}
  return{DAY_SECONDS,comparableSupply,sameBucketGrid,dailyMigration,buildCache,aggregateRange,formatRate,formatVolume};
});
