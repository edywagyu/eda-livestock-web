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
