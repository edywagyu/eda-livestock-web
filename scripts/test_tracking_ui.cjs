const fs=require('fs'),vm=require('vm'),assert=require('assert');
const page=fs.readFileSync(__dirname+'/../track.html','utf8');
const code=page.split('<script>')[1].split('</script>')[0];
const data=JSON.parse(fs.readFileSync(__dirname+'/../track-data.json'));
const nodes={};const get=id=>nodes[id]??=( {style:{},innerHTML:'',textContent:'',addEventListener(){}} );
const ctx={URLSearchParams,Date,Math,Number,Promise,encodeURIComponent,location:{search:'?id=neatmeat-0904'},fetch:()=>new Promise(()=>{}),setInterval:()=>1,clearInterval(){},setTimeout(){},document:{getElementById:get},navigator:{}};
vm.createContext(ctx);vm.runInContext(code,ctx);ctx.drawMap=()=>{};
let checks=0;
for(const [id,s] of Object.entries(data)){
 if(!s.legs?.length)continue;
 ctx.S=s;
 for(const [ms,phase] of [[Date.parse(s.legs[0].dep)-1,'prep'],[Date.parse(s.legs[0].dep)+1,'flying'],[Date.parse(s.legs.at(-1).arr)+1,'done']]){
 ctx.now=ms;assert.equal(ctx.estimatePosition().phase,phase,id);ctx.render();
 assert.equal(get('liveBadge').style.display,'none');assert.equal(get('etaBox').style.display,'block');
 assert(!get('status').textContent.startsWith('Delivered'));checks++;
 }
}
(async()=>{
for(const [ac,expected] of [[{lat:35,lon:140,seen_pos:20},true],[{lat:35,lon:140,seen_pos:121},false],[{lat:35,lon:140},false],[{lat:null,lon:140,seen_pos:1},false]]){
 ctx.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({ac:[ac]})});assert.equal(!!(await ctx.liveFetch('ANZ90')),expected);checks++;
}
ctx.S=data['neatmeat-0904'];ctx.now=Date.parse(ctx.S.legs[0].dep)+3600000;ctx.state=ctx.estimatePosition();ctx.mode='scrub';
ctx.planeMarker={setLatLng(){return this},setIcon(){return this}};ctx.planeIcon=()=>null;
ctx.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({ac:[{lat:35,lon:140,seen_pos:10}]})});ctx.startLive('ANZ90',140);
await new Promise(r=>setImmediate(r));assert.equal(get('liveBadge').style.display,'inline-flex');
ctx.fetch=()=>Promise.reject(Error('offline'));ctx.startLive('ANZ90',140);
await new Promise(r=>setImmediate(r));assert.equal(get('liveBadge').style.display,'none');assert(get('mapNote').textContent.includes('unavailable'));checks+=2;
console.log('PASS',checks,'schedule/state/signal regression checks');
})().catch(e=>{console.error(e);process.exitCode=1});
// Published schedule refresh: changes, offline, recovery, malformed record.
(async()=>{
 const n={};const el=id=>n[id]??={style:{},innerHTML:'',textContent:'',addEventListener(){}};
 const c={...ctx,document:{getElementById:el},fetch:()=>new Promise(()=>{})};
 vm.createContext(c);vm.runInContext(code,c);c.drawMap=()=>{};c.dataLoading=false;
 const original=JSON.parse(JSON.stringify(data));
 c.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve(original)});
 await c.refreshShipment();assert.equal(c.S.awb,original['neatmeat-0904'].awb);
 const revised=JSON.parse(JSON.stringify(original));revised['neatmeat-0904'].statusNote='Test revised schedule';
 c.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve(revised)});await c.refreshShipment();
 assert.equal(el('status').textContent,'Test revised schedule');
 c.fetch=()=>Promise.reject(Error('offline'));await c.refreshShipment();assert(c.dataRefreshFailed);assert(el('dataFreshness').textContent.includes('unavailable'));
 c.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve(revised)});await c.refreshShipment();assert(!c.dataRefreshFailed);assert.equal(el('status').textContent,'Test revised schedule');
 const invalid=JSON.parse(JSON.stringify(revised));invalid['neatmeat-0904'].legs[0].dep='bad';
 c.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve(invalid)});await c.refreshShipment();assert(c.dataRefreshFailed);assert.notEqual(c.S.legs[0].dep,'bad');
 console.log('PASS 5 schedule refresh regression checks');
})().catch(e=>{console.error(e);process.exitCode=1});
