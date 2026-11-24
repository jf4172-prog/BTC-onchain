(function(root,factory){
  const migration=typeof module==='object'&&module.exports?require('./migration.js'):root.URPDMigration;
  const api=factory(migration);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.URPDDepletion=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(migration){
  const sum=values=>values.reduce((total,value)=>total+value,0);
  function invalid(reason,previous,current){return{valid:false,reason,previousTimestamp:previous?.t,currentTimestamp:current?.t}}
  function bucketBounds(snapshot,index){
    const width=snapshot.ath_price/(snapshot.partitions.length+1);
    return{lower:(index+1)*width,upper:(index+2)*width};
  }
  function dailyDepletion(previous,current){
    if(!previous||!current)return invalid('missing-snapshot',previous,current);
    if(current.t-previous.t!==migration.DAY_SECONDS)return invalid('missing-daily-snapshot',previous,current);
    if(!migration.sameBucketGrid(previous,current))return invalid('bucket-boundary-change',previous,current);
    if(!Number.isFinite(current.current_price))return invalid('missing-price',previous,current);
    let profit=0,loss=0,unclassified=0;
    current.partitions.forEach((value,index)=>{
      const depletion=Math.max(previous.partitions[index]-value,0);if(!depletion)return;
      const bounds=bucketBounds(current,index);
      if(bounds.upper<current.current_price)profit+=depletion;
      else if(bounds.lower>current.current_price)loss+=depletion;
      else unclassified+=depletion;
    });
    const classified=profit+loss,totalObserved=classified+unclassified;
    return{valid:true,date:current.t,previousDate:previous.t,price:current.current_price,profit,loss,unclassified,classified,totalObserved,profitShare:classified?profit/classified*100:null,lossShare:classified?loss/classified*100:null,unclassifiedShare:totalObserved?unclassified/totalObserved*100:null,chartProfit:profit,chartLoss:-loss};
  }
  function buildCache(snapshots){
    const rows=[...snapshots].sort((a,b)=>a.t-b.t),indexByTimestamp=new Map(rows.map((row,index)=>[row.t,index])),daily=[];
    const prefixProfit=[0],prefixLoss=[0],prefixUnclassified=[0],prefixInvalid=[0];
    for(let index=1;index<rows.length;index++){
      const result=dailyDepletion(rows[index-1],rows[index]);daily.push(result);
      prefixProfit[index]=prefixProfit[index-1]+(result.valid?result.profit:0);
      prefixLoss[index]=prefixLoss[index-1]+(result.valid?result.loss:0);
      prefixUnclassified[index]=prefixUnclassified[index-1]+(result.valid?result.unclassified:0);
      prefixInvalid[index]=prefixInvalid[index-1]+(result.valid?0:1);
    }
    return{rows,indexByTimestamp,daily,prefixProfit,prefixLoss,prefixUnclassified,prefixInvalid};
  }
  function aggregateRange(cache,startTimestamp,endTimestamp){
    const startIndex=cache.indexByTimestamp.get(startTimestamp),endIndex=cache.indexByTimestamp.get(endTimestamp);
    if(startIndex===undefined||endIndex===undefined)return{valid:false,reason:'date-not-found'};
    if(startIndex>endIndex)return{valid:false,reason:'invalid-range'};
    if(startIndex===endIndex)return{valid:true,profit:0,loss:0,unclassified:0,classified:0,totalObserved:0,profitShare:null,lossShare:null,unclassifiedShare:null,observations:0,daily:[]};
    const daily=cache.daily.slice(startIndex,endIndex),invalidCount=cache.prefixInvalid[endIndex]-cache.prefixInvalid[startIndex];
    if(invalidCount)return{valid:false,reason:daily.find(item=>!item.valid)?.reason||'incomplete-range',daily,observations:daily.length};
    const profit=cache.prefixProfit[endIndex]-cache.prefixProfit[startIndex],loss=cache.prefixLoss[endIndex]-cache.prefixLoss[startIndex],unclassified=cache.prefixUnclassified[endIndex]-cache.prefixUnclassified[startIndex],classified=profit+loss,totalObserved=classified+unclassified;
    return{valid:true,profit,loss,unclassified,classified,totalObserved,profitShare:classified?profit/classified*100:null,lossShare:classified?loss/classified*100:null,unclassifiedShare:totalObserved?unclassified/totalObserved*100:null,observations:daily.length,daily};
  }
  function formatVolume(value){return`${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value)} BTC`}
  function formatShare(value){return value===null?'N/A':`${value.toFixed(2)}%`}
  return{bucketBounds,dailyDepletion,buildCache,aggregateRange,formatVolume,formatShare};
});
