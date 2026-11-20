 'use strict';
const $=id=>document.getElementById(id);let running=false,startTime=0,trip=null,watchId=null,clock=null,points=[],lastRender=0,lastSampleTime=0,lastCheckpoint=0,wakeLock=null,map=null,trackLayer=null,liveLayer=null,allTrips=[],liveDistance=0;const DB='comfort-route-v1';
function readPreference(key){try{return localStorage.getItem(key)}catch{return null}}
const previewTrips=new Map();

function dbOpen(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('trips',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function store(action,data){
 if(location.protocol==='file:'){
  if(action==='read')return [...previewTrips.values()];
  if(action==='delete')return previewTrips.delete(data);
  previewTrips.set(data.id,data);return;
 }
 const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('trips',action==='read'?'readonly':'readwrite'),obj=tx.objectStore('trips'),req=action==='read'?obj.getAll():action==='delete'?obj.delete(data):obj.put(data);req.onsuccess=()=>{if(action==='read')resolve(req.result)};req.onerror=()=>reject(req.error);tx.oncomplete=()=>{db.close();if(action!=='read')resolve(req.result)};tx.onabort=()=>{db.close();reject(tx.error)}})}
function notify(s){$('notice').textContent=s}function fmt(s){s=Math.floor(s);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':')}function setState(on){running=on;document.body.classList.toggle('recording',on);$('touchLock').disabled=!on;if(!on&&$('lockDialog').open)$('lockDialog').close();$('start').disabled=on;$('stop').disabled=!on;$('mode').disabled=on;$('status').textContent=on?'● Recording':'Ready to record';document.querySelectorAll('.mode').forEach(b=>b.disabled=on)}
function draw(){
 const canvas=$('chart'),width=canvas.clientWidth,height=canvas.clientHeight;
 if(!width||!height)return;
 const scale=devicePixelRatio||1;
 canvas.width=width*scale;canvas.height=height*scale;
 const ctx=canvas.getContext('2d');
 ctx.scale(scale,scale);
 const left=31,right=width-9,top=11,bottom=height-17;
 const span=right-left, center=(top+bottom)/2;
 ctx.font='9px system-ui';ctx.fillStyle='#d2e5f1';ctx.strokeStyle='#27404e';
 for(let i=0;i<=4;i++){
  const y=top+(bottom-top)*i/4;
  ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  ctx.textAlign='right';ctx.fillText((1-i*.5).toFixed(1),left-5,y+3);
 }
 for(let i=0;i<=6;i++){
  const x=left+span*i/6;
  ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
  ctx.textAlign='center';ctx.fillText((i*10-60)+'s',x,bottom+12);
 }
 if(!points.length)return;
 const newest=points.at(-1).t;
 ctx.save();ctx.beginPath();ctx.rect(left,top,span,bottom-top);ctx.clip();
 ctx.strokeStyle='#00eff6';ctx.lineWidth=1.5;ctx.beginPath();
 points.forEach((point,index)=>{
  const x=right-(newest-point.t)*span/60000,y=center-point.z*(bottom-top)/2;
  if(!index||point.t-points[index-1].t>250)ctx.moveTo(x,y);else ctx.lineTo(x,y);
 });
 ctx.stroke();ctx.restore();
}
function motion(event){
 if(!running)return;
 const t=Date.now();
 if(t-lastSampleTime<15)return;
 const valid=a=>a&&[a.x,a.y,a.z].every(Number.isFinite);
 const linear=valid(event.acceleration);
 const a=linear?event.acceleration:event.accelerationIncludingGravity;
 if(!valid(a))return;
 lastSampleTime=t;
 const {x,y,z}=a;
 trip.motion.push({time:new Date(t).toISOString(),elapsed_ms:t-startTime,x,y,z,gravity_removed:linear});
 if(linear){
  points.push({t,z});
  while(points.length&&t-points[0].t>60000)points.shift();
 }
 if(t-lastRender<=250)return;
 let sumSquares=0,count=0;
 for(let i=points.length-1;i>=0&&points[i].t>=t-10000;i--){
  sumSquares+=points[i].z**2;count++;
 }
 $('rms').textContent=count?Math.sqrt(sumSquares/count).toFixed(2):'—';
 $('sampleCount').textContent=trip.motion.length;
 draw();
 lastRender=t;
}
function gps(pos){if(!running)return;const c=pos.coords;const previous=trip.gps.at(-1);trip.gps.push({time:new Date(pos.timestamp).toISOString(),elapsed_ms:pos.timestamp-startTime,latitude:c.latitude,longitude:c.longitude,accuracy_m:c.accuracy,speed_mps:c.speed,altitude_m:c.altitude});$('gpsCount').textContent=trip.gps.length;$('speed').textContent=c.speed!=null&&c.speed>=0?(c.speed*3.6).toFixed(1):'—';$('accuracy').textContent='GPS accuracy '+Math.round(c.accuracy)+' m';const point=trip.gps.at(-1);
 $('gpsLive').textContent=c.accuracy<=65?'✓ Live':'Weak';
 $('gpsLive').classList.toggle('live',c.accuracy<=65);
 if(goodPair(previous,point)){
  liveDistance+=distance(previous,point);
  $('distanceLive').textContent=(liveDistance/1000).toFixed(1)+' km';
  addSegment([previous,point],'#36dbb8',true);
 }if(Date.now()-lastCheckpoint>12000){lastCheckpoint=Date.now();store('write',trip).catch(()=>notify('Warning: automatic checkpoint could not be saved.'))}}
async function requestWake(){
 if(wakeLock&&!wakeLock.released)return;
 if(!navigator.wakeLock){$('wakeStatus').textContent='Screen wake lock unavailable';return}
 try{
  const lock=await navigator.wakeLock.request('screen');
  wakeLock=lock;
  $('wakeStatus').textContent='Screen stays awake';
  lock.addEventListener('release',()=>{if(wakeLock===lock){wakeLock=null;$('wakeStatus').textContent='Screen wake lock released'}});
 }catch{$('wakeStatus').textContent='Screen wake lock could not start'}
}
async function releaseWake(){if(wakeLock){try{await wakeLock.release()}catch(e){}wakeLock=null}}
async function start(){if(running)return;if(location.protocol==='file:')return notify('Use the hosted web app or local server to record and retain your drives.');if(!isSecureContext)return notify('HTTPS required. Open the app over HTTPS.');if(!('DeviceMotionEvent'in window))return notify('Motion sensor unavailable. Use iPhone Safari.');if(!navigator.geolocation)return notify('GPS unavailable.');try{if(typeof DeviceMotionEvent.requestPermission==='function'){const p=await DeviceMotionEvent.requestPermission();if(p!=='granted')throw Error('Motion permission denied')}const now=Date.now();startTime=now;trip={id:String(now),started:new Date(now).toISOString(),ended:null,suspension_mode:$('mode').value,motion:[],gps:[],userAgent:navigator.userAgent};points=[];liveDistance=0;$('distanceLive').textContent='0.0 km';$('gpsLive').textContent='Waiting';$('gpsLive').classList.remove('live');$('speed').textContent='—';lastSampleTime=0;$('sampleCount').textContent='0';$('gpsCount').textContent='0';$('rms').textContent='—';$('durationLive').textContent=$('elapsed').textContent='00:00:00';draw();setState(true);clearLines(liveLayer);window.addEventListener('devicemotion',motion);watchId=navigator.geolocation.watchPosition(gps,e=>notify('GPS: '+e.message),{enableHighAccuracy:true,maximumAge:0,timeout:15000});clock=setInterval(()=>{$('durationLive').textContent=$('lockedTime').textContent=$('elapsed').textContent=fmt((Date.now()-startTime)/1000);if(Date.now()-lastCheckpoint>20000){lastCheckpoint=Date.now();store('write',trip).catch(()=>{})}},1000);await requestWake();notify('Recording in '+trip.suspension_mode+' mode. Keep the app in foreground; never interact while driving.')}catch(e){notify('Cannot start: '+e.message);if(running){setState(false);window.removeEventListener('devicemotion',motion);if(watchId!=null)navigator.geolocation.clearWatch(watchId);clearInterval(clock)}}}
async function stop(){if(!running)return;setState(false);window.removeEventListener('devicemotion',motion);if(watchId!=null)navigator.geolocation.clearWatch(watchId);watchId=null;clearInterval(clock);trip.ended=new Date().toISOString();$('gpsLive').textContent='Saved';$('gpsLive').classList.remove('live');await releaseWake();try{await store('write',trip);clearLines(liveLayer);notify('Drive saved and automatically added to your local city map. Export backups regularly.');trip=null;await renderTrips()}catch(e){notify('Save failed: '+e.message)}}
function csvEscape(v){if(v==null)return '';const s=String(v);return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}function csv(rows,fields){return [fields.join(','),...rows.map(r=>fields.map(k=>csvEscape(r[k])).join(','))].join('\r\n')}
function download(filename,body,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
function exportTrip(t){const m=(t.motion||[]).map(x=>({...x,trip_id:t.id,suspension_mode:t.suspension_mode||'Unspecified',record_type:'motion',latitude:'',longitude:'',accuracy_m:'',speed_mps:'',altitude_m:''})),g=(t.gps||[]).map(x=>({...x,trip_id:t.id,suspension_mode:t.suspension_mode||'Unspecified',record_type:'gps',x:'',y:'',z:'',gravity_removed:''}));return csv([...m,...g].sort((a,b)=>a.elapsed_ms-b.elapsed_ms),['trip_id','suspension_mode','record_type','time','elapsed_ms','x','y','z','gravity_removed','latitude','longitude','accuracy_m','speed_mps','altitude_m'])}
function distance(a,b){const r=6371000,lat1=a.latitude*Math.PI/180,lat2=b.latitude*Math.PI/180,dlat=lat2-lat1,dlon=(b.longitude-a.longitude)*Math.PI/180,h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;return 2*r*Math.asin(Math.min(1,Math.sqrt(h)))}
function goodPair(a,b){return a&&b&&Number.isFinite(a.latitude)&&Number.isFinite(b.latitude)&&Number.isFinite(a.longitude)&&Number.isFinite(b.longitude)&&distance(a,b)<180&&Math.abs(Date.parse(b.time)-Date.parse(a.time))<=15000&&(a.accuracy_m==null||a.accuracy_m<100)&&(b.accuracy_m==null||b.accuracy_m<100)}
let googleLoading=false,googleInfo=null,mapReady=false;
function clearLines(lines){if(Array.isArray(lines)){lines.forEach(line=>line.setMap(null));lines.length=0}}
function setMapStatus(message){$('mapStatus').textContent=message}
function initMap(){
 liveLayer=[];trackLayer=[];
 const configured=window.COMFORTROUTE_GOOGLE_MAPS_API_KEY?.trim();
 const key=configured&&configured!=='YOUR_RESTRICTED_BROWSER_KEY'
  ?configured:readPreference('cr_google_maps_key');
 if(key)loadGoogleMaps(key);
 else setMapStatus('Google Maps setup required. Set your browser key in docs/maps-config.js.');
}
function loadGoogleMaps(key){
 if(googleLoading||mapReady)return;
 googleLoading=true;
 setMapStatus('Loading Google Maps…');
 window.gm_authFailure=()=>{
  googleLoading=false;mapReady=false;
  setMapStatus('Google Maps authorization failed. Check website restrictions, API access and billing.');
 };
 window.crGoogleReady=()=>{
  const el=$('map');
  map=new google.maps.Map(el,{
   center:{lat:50.041,lng:22.004},zoom:12,mapTypeId:'roadmap',
   streetViewControl:false,fullscreenControl:true,gestureHandling:'greedy',mapTypeControl:false
  });
  googleInfo=new google.maps.InfoWindow();
  googleLoading=false;mapReady=true;
  setMapStatus('');
  if(trip)for(let i=1;i<trip.gps.length;i++){
   const pair=trip.gps.slice(i-1,i+1);
   if(goodPair(...pair))addSegment(pair,'#36dbb8',true);
  }
  drawMap(true);
 };
 const script=document.createElement('script');
 script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({
  key,callback:'crGoogleReady',loading:'async',v:'weekly'
 });
 script.async=true;
 script.onerror=()=>{
  googleLoading=false;
  setMapStatus('Could not load Google Maps. Check your connection and reload.');
 };
 document.head.append(script);
}
function addSegment(pair,stroke,isLive=false,desc=''){
 if(!mapReady)return;
 const line=new google.maps.Polyline({
  path:pair.map(point=>({lat:point.latitude,lng:point.longitude})),
  strokeColor:stroke,strokeWeight:isLive?6:5,strokeOpacity:.88,map
 });
 if(!isLive&&desc)line.addListener('click',event=>{
  googleInfo.setContent(desc);googleInfo.setPosition(event.latLng);googleInfo.open({map});
 });
 (isLive?liveLayer:trackLayer).push(line);
}
function selectedTrips(){const id=$('routeFilter').value;return id?allTrips.filter(t=>t.id===id):allTrips}
function routeSections(t){
 if(t.sections)return t.sections.map(part=>part.map(p=>({
  latitude:p.lat,longitude:p.lon,rms:p.rms,time:new Date(p.ts*1000).toISOString()
 })));
 const parts=[];let part=[];
 for(const point of t.gps||[]){
  if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180||point.accuracy_m>100)continue;
  if(part.length&&!goodPair(part.at(-1),point)){if(part.length>1)parts.push(part);part=[]}
  part.push(point);
 }
 if(part.length>1)parts.push(part);
 return parts;
}
function fitAll(){
 if(!mapReady)return;
 const coords=selectedTrips().flatMap(t=>routeSections(t).flat());
 if(!coords.length)return;
 if(!$('map').clientWidth)return;
 const bounds=new google.maps.LatLngBounds();
 coords.forEach(p=>bounds.extend({lat:p.latitude,lng:p.longitude}));
 map.fitBounds(bounds,40);
}
function cell(g){const lat=g.latitude,lon=g.longitude;if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;const y=Math.floor(lat*111320/50),x=Math.floor(lon*111320*Math.cos(50.04*Math.PI/180)/50);return x+':'+y}
function drawMap(fit=false){
 const visited=new Set();
 let sectionCount=0,mappedDistance=0;
 const visible=selectedTrips();
 for(const t of visible){
  for(const part of routeSections(t)){
   sectionCount++;
   for(let i=0;i<part.length;i++){
    const key=cell(part[i]);if(key)visited.add(key);
    if(i)mappedDistance+=distance(part[i-1],part[i]);
   }
  }
 }
 $('coverage').textContent=visited.size+' × 50 m cells';
 $('coverageNumber').textContent=visited.size.toLocaleString();
 $('driveTotal').textContent=allTrips.length;
 $('sectionTotal').textContent=sectionCount;
 $('mappedDistance').textContent=(mappedDistance/1000).toFixed(1)+' km';
 $('analysisTotal').textContent=allTrips.length;
 if(!mapReady)return;
 clearLines(trackLayer);
 for(const t of visible){
  for(const part of routeSections(t)){
   for(let i=1;i<part.length;i++){
    const p=part[i],r=p.rms;
    const stroke=r==null?'#78aefc':r<t.thresholds[0]?'#24f03d':r<t.thresholds[1]?'#ffce18':'#ff4b45';
    const info=new Date(p.time).toLocaleString('en-GB',{timeZone:'Europe/Warsaw'})+' · '+(r==null?'GPS only':r.toFixed(2)+' m/s² vibration RMS');
    addSegment([part[i-1],p],stroke,false,info);
   }
  }
 }
 if(fit)fitAll();
}
function exportGeo(){
 const features=selectedTrips().flatMap(t=>routeSections(t).map(part=>({
  type:'Feature',properties:{trip_id:t.id,started:t.started,suspension_mode:t.suspension_mode||'Unspecified'},
  geometry:{type:'LineString',coordinates:part.map(p=>[p.longitude,p.latitude])}
 })));
 download('comfort-route-city-map.geojson',JSON.stringify({type:'FeatureCollection',features},null,2),'application/geo+json');
}
async function renderTrips(){try{allTrips=(await store('read')).sort((a,b)=>Date.parse(b.started)-Date.parse(a.started));const el=$('trips');el.replaceChildren();const filter=$('routeFilter'),previous=filter.value;filter.replaceChildren(new Option('All drives',''));for(const t of allTrips)filter.add(new Option(new Date(t.started).toLocaleString('en-GB',{timeZone:'Europe/Warsaw'}),t.id));if(allTrips.some(t=>t.id===previous))filter.value=previous;if(!allTrips.length)el.textContent='No drives saved yet.';for(const t of allTrips){const r=document.createElement('div');r.className='trip';const desc=document.createElement('div');desc.className='trip-desc';const title=document.createElement('strong');title.textContent=new Date(t.started).toLocaleString();const sub=document.createElement('div');sub.className='trip-sub';sub.textContent=`${t.suspension_mode||'Mode unknown'} · ${(t.motion||[]).length} motion · ${(t.gps||[]).length} GPS`;desc.append(title,sub);const actions=document.createElement('div');actions.className='trip-actions';const exp=document.createElement('button');exp.className='secondary';exp.textContent='CSV';exp.onclick=()=>download('comfort-route-'+t.id+'.csv',exportTrip(t));const del=document.createElement('button');del.className='delete';del.textContent='Delete';del.onclick=async()=>{if(confirm('Permanently delete this drive? Export a backup first.')){await store('delete',t.id);renderTrips()}};actions.append(exp,del);r.append(desc,actions);el.append(r)}renderRecent();drawMap(true)}catch(e){notify('Storage error: '+e.message)}}
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{if(running)return;$('mode').value=b.dataset.mode;document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x===b))}));$('start').addEventListener('click',start);$('stop').addEventListener('click',stop);$('wakeButton').addEventListener('click',requestWake);$('fitMap').addEventListener('click',fitAll);$('exportGeo').addEventListener('click',exportGeo);$('exportAll').addEventListener('click',async()=>{const ts=await store('read');if(!ts.length)return notify('No drives to export');for(const t of ts)download('comfort-route-'+t.id+'.csv',exportTrip(t))});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&running&&!wakeLock)requestWake();if(document.visibilityState==='hidden'&&running)notify('App backgrounded: iOS may suspend recording. Keep it visible.')});window.addEventListener('resize',draw);initMap();initializeHistory();draw();if(/^https?:$/.test(location.protocol)&&'serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

async function initializeHistory(){
 try{
  if(typeof historicalDrive!=='undefined'&&historicalDrive&&(location.protocol==='file:'||!readPreference('cr_history_seed_20261030'))){
   const trips=await store('read');
   const prior=trips.find(t=>t.id===historicalDrive.id);
   if(!prior||!prior.sections){
    await store('write',prior?{...prior,sections:historicalDrive.sections,thresholds:historicalDrive.thresholds}:historicalDrive);
   }
   if(location.protocol!=='file:')localStorage.setItem('cr_history_seed_20261030','1');
  }
 }catch(error){notify('Could not preload the Rzeszów drive: '+error.message)}
 await renderTrips();
}

function csvRecords(content){
 const lines=content.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const fields=line=>Array.from(line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g),
  ([,quoted,plain])=>quoted===undefined?plain:quoted.replaceAll('""','"'));
 const keys=fields(lines.shift());
 const native=keys.includes('timestamp_utc')&&keys.includes('vertical_accel_m_s2');
 if(!(native||['trip_id','record_type','time'].every(key=>keys.includes(key))))throw Error('unsupported CSV format');
 return {native,rows:lines.map(line=>Object.fromEntries(fields(line).map((value,i)=>[keys[i],value])))};
}

async function importFiles(files){
 let imported=0,duplicates=0;
 const errors=[];
 const existing=new Set((await store('read')).map(t=>t.id));
 const num=value=>value!=null&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
 for(const file of files){
  try{
   const {rows,native}=csvRecords(await file.text());
   const drives=new Map(), annotatedSections=new Map();
   const nativeId=file.name.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]||rows[0]?.timestamp_utc;
   for(const row of rows){
    const id=native?nativeId:row.trip_id;
    const time=native?row.timestamp_utc:row.time;
    if(!id||!Number.isFinite(Date.parse(time)))continue;
    if(!drives.has(id))drives.set(id,{id,started:time,ended:time,suspension_mode:row.suspension_mode||'Unspecified',gps:[],motion:[]});
    const drive=drives.get(id);
    const elapsed_ms=native?(num(row.elapsed_s)??0)*1000:num(row.elapsed_ms)??0;
    if(Date.parse(time)<Date.parse(drive.started))drive.started=time;
    if(Date.parse(time)>Date.parse(drive.ended))drive.ended=time;
    const latitude=num(row.latitude),longitude=num(row.longitude);
    if((native||row.record_type==='gps')&&latitude!==null&&longitude!==null&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180){
     const last=drive.gps.at(-1);
     if(!native||last?.latitude!==latitude||last?.longitude!==longitude||Date.parse(time)-Date.parse(last.time)>4000){
      const speed_mps=native?(num(row.speed_kmh)===null?null:num(row.speed_kmh)/3.6):num(row.speed_mps);
      drive.gps.push({time,elapsed_ms,latitude,longitude,speed_mps,accuracy_m:num(row.accuracy_m),altitude_m:num(row.altitude_m)});
      const section=num(row.route_section), low=num(row.rms_band_low), high=num(row.rms_band_high);
      if(!native&&Number.isInteger(section)&&section>=0&&low>=0&&low!==null&&high>low){
       if(!annotatedSections.has(id))annotatedSections.set(id,new Map());
       const sections=annotatedSections.get(id);
       if(!sections.has(section))sections.set(section,[]);
       sections.get(section).push({lat:latitude,lon:longitude,ts:Date.parse(time)/1000,rms:num(row.section_rms)});
       drive.thresholds=[low,high];
      }
     }
    }
    if(native||row.record_type==='motion'){
     const x=num(native?row.user_ax_m_s2:row.x),y=num(native?row.user_ay_m_s2:row.y),z=num(native?row.vertical_accel_m_s2:row.z);
     if([x,y,z].every(v=>v!==null))drive.motion.push({time,elapsed_ms,x,y,z,gravity_removed:native||row.gravity_removed==='true'});
    }
   }
   if(![...drives.values()].some(drive=>drive.gps.length||drive.motion.length))throw Error('no valid GPS or motion rows');
   for(const drive of drives.values()){
    if(!drive.gps.length&&!drive.motion.length)continue;
    if(existing.has(drive.id)){duplicates++;continue}
    drive.gps.sort((a,b)=>a.elapsed_ms-b.elapsed_ms);
    const sections=annotatedSections.get(drive.id);
    if(sections&&[...sections.values()].reduce((total,part)=>total+part.length,0)===drive.gps.length){
     drive.sections=[...sections.entries()].sort(([a],[b])=>a-b).map(([,part])=>part.sort((a,b)=>a.ts-b.ts));
    }
    await store('write',drive);existing.add(drive.id);imported++;
   }
  }catch(error){errors.push(file.name+' ('+error.message+')')}
 }
 await renderTrips();
 const message=imported+' imported · '+duplicates+' already saved'+(errors.length?' · '+errors.join(', '):'');
 notify(message);
 $('importStatus').textContent=message;
}

$('routeFilter').onchange=()=>drawMap(true);
$('touchLock').onclick=()=>{
 $('lockedTime').textContent=$('elapsed').textContent;
 $('lockDialog').showModal();
};
$('lockDialog').oncancel=event=>event.preventDefault();
$('unlockControls').onclick=()=>$('lockDialog').close();
$('importDrive').onchange=async event=>{
 const control=event.target;
 control.disabled=true;
 try{await importFiles(Array.from(control.files))}
 catch(error){$('importStatus').textContent=error.message}
 finally{control.value='';control.disabled=false}
};

function showView(view){
 if(!['record','map','archive','analytics'].includes(view))return;
 document.body.dataset.view=view;
 for(const tab of document.querySelectorAll('.tab')){
  tab.setAttribute('aria-pressed',String(tab.dataset.view===view));
 }
 if(view==='map'||view==='record')requestAnimationFrame(fitAll);
 if(view==='record')requestAnimationFrame(draw);
}

function renderRecent(){
 const list=$('recentTrips');
 list.replaceChildren();
 if(!allTrips.length){
  const item=document.createElement('p');
  item.className='empty';
  item.textContent='No drives yet. Import a CSV from the archive.';
  list.append(item);
  return;
 }
 for(const trip of allTrips.slice(0,3)){
  const button=document.createElement('button');
  button.className='recent-trip';
  const icon=document.querySelector('.tab[data-view="record"] svg').cloneNode(true);
  const content=document.createElement('span');
  const title=document.createElement('strong');
  title.textContent=new Date(trip.started).toLocaleString('en-GB',{
   day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Warsaw'
  });
  const meta=document.createElement('small');
  const duration=trip.ended?fmt(Math.max(0,(Date.parse(trip.ended)-Date.parse(trip.started))/1000)):'';
  meta.textContent=[trip.suspension_mode==='Unspecified'?'Mode unrecorded':trip.suspension_mode,
   routeSections(trip).length+' sections',duration].filter(Boolean).join('  •  ');
  const chevron=document.createElement('span');
  chevron.textContent='›';
  chevron.setAttribute('aria-hidden','true');
  content.append(title,meta);
  button.append(icon,content,chevron);
  button.onclick=()=>{
   $('routeFilter').value=trip.id;
   showView('map');
   drawMap(true);
   $('mapOptions').hidden=false;
   $('layerToggle').setAttribute('aria-expanded','true');
  };
  list.append(button);
 }
}

for(const trigger of document.querySelectorAll('button[data-view]')){
 trigger.addEventListener('click',()=>showView(trigger.dataset.view));
}
$('settingsButton').onclick=()=>$('settingsDialog').showModal();
$('modeInfo').onclick=()=>notify('Choose the suspension mode set in your BMW. ComfortRoute saves this setting with your drive.');
$('layerToggle').onclick=()=>{
 const options=$('mapOptions');
 options.hidden=!options.hidden;
 $('layerToggle').setAttribute('aria-expanded',String(!options.hidden));
};
