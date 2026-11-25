const assert=require('node:assert/strict');
const core=require('../etf-core.js');
const payload=require('../etf-data.json');
const d=payload.datasets;

assert.ok(d.net_flow.length>0,'net flow must not be empty');
assert.ok(d.btc_holdings.length>0,'holdings must not be empty');
assert.ok(d.usd_balances.length>0,'USD balances must not be empty');
assert.equal(core.isTradingDate('2026-11-26'),false,'Thanksgiving is not a trading day');
assert.equal(core.isTradingDate('2026-11-27'),true,'Friday after Thanksgiving is a trading day');

const start=d.net_flow[0].date,end=d.net_flow.at(-1).date;
const flow=core.selectFlows(d.net_flow,d.btc_price,start,end);
assert.ok(flow.series.length>0);
assert.ok(Number.isFinite(flow.total));
assert.equal(flow.cutoff,d.net_flow.at(-1).date);

const holdings=core.holdingsChanges(d.btc_holdings,start,end);
assert.ok(holdings.valid,'complete holdings snapshots should be comparable');
assert.ok(holdings.rows.some(row=>row.ticker==='IBIT'));
assert.ok(holdings.rows.filter(row=>row.change!==null).length>0,'synchronized products are compared');

const shares=core.marketShares(d.usd_balances,start,end);
assert.ok(shares.valid,'complete USD snapshots should be comparable');
const shareTotal=shares.rows.reduce((sum,row)=>sum+(row.endShare||0),0);
assert.ok(Math.abs(shareTotal-100)<1e-6,`market shares sum to ${shareTotal}`);
assert.ok(shares.endReconciliation.valid,'product USD balances reconcile to Glassnode total');

const late=core.marketShares(d.usd_balances,start,'2099-12-31');
assert.equal(late.incomplete,true,'selected end after cutoff must be disclosed');

const missing=core.marketShares(d.usd_balances,'2020-01-01','2020-01-02');
assert.equal(missing.valid,false,'missing history must return invalid, never estimates');

console.log('ETF core tests passed');
