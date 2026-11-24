'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=fs.existsSync(path.join(__dirname,'robot-server.cjs'))?__dirname:path.resolve(__dirname,'..');
const {createRobotServer}=require(path.join(root,'robot-server.cjs'));
const uuid='robot-001';
async function start(opts={}){
  const config={operatorToken:'operator-secret',trackerToken:'tracker-secret',devices:[{id:uuid,polygon_id:'poly-1',marker_id:17,token:'device-secret',minBatteryVoltage:6.6,maxBatteryVoltage:8.5,
    model:{calibrated:true,robot_radius_m:.08,model_tolerance_m:.03,max_step_m:.1}}],...opts};
  const server=createRobotServer(config);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  async function send(action,method='POST',data={},token='operator-secret'){
    const resp=await fetch(base+'/api/robots/'+uuid+'/'+action,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      ...(['POST','PUT','PATCH'].includes(method)?{body:JSON.stringify(data)}:{})});
    return {status:resp.status,body:await resp.json()};
  }
  async function poll(boot='boot-1',error=0){return send('command?boot='+boot+'&ready=1&error='+error+'&battery_v=7.40','GET',undefined,'device-secret');}
  return {server,send,poll,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
test('GET command, per-robot auth, JSON state and reboot lock',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'roi-one-'));
  const s=await start({stateDir:folder,arena:{polygon:[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:0,y:3}]}});
  try{
    assert.equal((await s.send('status','GET',null,'device-secret')).status,401);
    assert.equal((await s.poll()).status,200);
    assert.equal((await s.send('pose','POST',{x:.5,y:.5,heading:0,polygon_id:'poly-1',marker_id:17},'tracker-secret')).status,200);
    assert.equal((await s.send('commands','POST',{commands:[{kind:'forward',unit:'m',value:.1}]})).status,201);
    const p=await s.poll();assert.equal(p.body.command.kind,'forward');
    assert.equal((await s.poll()).body.command.id,p.body.command.id);
    const ack=await s.send('ack','POST',{epoch:p.body.epoch,boot:'boot-1',id:p.body.command.id,status:'done'},'device-secret');
    assert.equal(ack.status,200);
    assert.equal((await s.send('ack','POST',{epoch:p.body.epoch,boot:'boot-1',id:p.body.command.id,status:'done'},'device-secret')).status,200);
    const directory=path.join(folder,'robots',uuid);
    for(const filename of ['commands.json','state.json','telemetry.json'])assert.equal(fs.existsSync(path.join(directory,filename)),true,filename);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'commands.json'),'utf8')).queue.length,0);
  }finally{await s.close();}
  const reboot=await start({stateDir:folder});
  try{
    const status=await reboot.send('status','GET');
    assert.equal(status.body.fault.code,'SERVER_RESTART');
    assert.equal((await reboot.poll()).body.stop,true);
    assert.equal((await reboot.send('commands','POST',{commands:[{kind:'forward',value:.02,unit:'m'}]})).status,409);
  }finally{await reboot.close();fs.rmSync(folder,{recursive:true,force:true});}
});
test('ArUco safety, mathematical mission planner, divergence and manual request',async()=>{
  const arena={polygon:[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:0,y:3}]};
  const s=await start({arena});
  const pose=(x,y,heading=0)=>s.send('pose','POST',{x,y,heading,polygon_id:'poly-1',marker_id:17},'tracker-secret');
  try{
    await s.poll();
    assert.equal((await s.send('mission','POST',{action:'MOVE_TO',target:{x:.7,y:.5}})).status,409);
    assert.equal((await pose(.5,.5)).status,200);
    const startMission=await s.send('mission','POST',{action:'MOVE_TO',target:{x:.7,y:.5}});
    assert.equal(startMission.status,201);
    const command=(await s.poll()).body.command;
    assert.equal(command.kind,'forward');
    assert.ok(command.value<=.1);
    const ack=await s.send('ack','POST',{epoch:(await s.poll()).body.epoch,boot:'boot-1',id:command.id,status:'done'},'device-secret');
    assert.equal(ack.status,200);
    assert.equal((await s.poll()).body.command,null,'next motion waits for measured pose');
    await pose(.5,.5);
    const status=await s.send('status','GET');
    assert.equal(status.body.fault.code,'MODEL_DIVERGENCE','observed pose did not reach expected segment');
    assert.equal((await s.poll()).body.stop,true);
    assert.equal((await s.send('reset','POST',{confirm:false})).status,422,'operator confirmation required');
    assert.equal((await s.send('reset','POST',{confirm:true})).status,200);
  }finally{await s.close();}
});
test('Immediate geofence stop and guarded manual recovery',async()=>{
  const arena={polygon:[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:0,y:3}]};
  const s=await start({arena});
  const pose=(x,y)=>s.send('pose','POST',{x,y,heading:0,polygon_id:'poly-1',marker_id:17},'tracker-secret');
  try{
    await s.poll();await pose(.5,.5);
    await pose(-.11,.5);
    assert.equal((await s.send('status','GET')).body.mode,'MANUAL_REQUIRED');
    assert.equal((await s.poll()).body.stop,true);
    assert.equal((await s.send('reset','POST',{confirm:true})).status,409);
    assert.equal((await s.send('manual','POST',{action:'enable',confirm:false})).status,409);
    const enable=await s.send('manual','POST',{action:'enable',confirm:true});assert.equal(enable.status,200);
    assert.equal((await s.poll()).body.resume,true); // device receives explicit recovery approval
    assert.equal((await s.send('manual','POST',{action:'drive',command:{kind:'backward',value:.02,unit:'m'}})).status,422);
    assert.equal((await s.send('manual','POST',{action:'drive',command:{kind:'forward',value:.02,unit:'m'}})).status,201);
  }finally{await s.close();}
});
test('Device voltage fault, bad markers and invalid movements are rejected',async()=>{
  const s=await start();
  try{
    await s.poll();
    assert.equal((await s.send('pose','POST',{x:1,y:1,heading:0,marker_id:18,polygon_id:'poly-1'},'tracker-secret')).status,409);
    assert.equal((await s.send('commands','POST',{commands:[{kind:'forward',value:100,unit:'m'}]})).status,422);
    assert.equal((await s.send('mission','POST',{action:'DUMP'})).status,422);
    const error=await s.send('telemetry','POST',{boot:'boot-1',battery_v:5.9,error:0},'device-secret');
    assert.equal(error.status,200);assert.equal(error.body.hold,true);
    assert.equal((await s.send('status','GET')).body.fault.code,'BATTERY_LOW');
    assert.equal((await s.poll()).body.stop,true);
  }finally{await s.close();}
});
test('Autonomous travel needs an explicitly calibrated physical model',async()=>{
  const arena={polygon:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]};
  const devices=[{id:uuid,polygon_id:'poly-1',marker_id:17,token:'device-secret',model:{calibrated:false}}];
  const s=await start({arena,devices});
  try{
    await s.poll();
    await s.send('pose','POST',{x:.5,y:.5,heading:0,polygon_id:'poly-1',marker_id:17},'tracker-secret');
    const r=await s.send('mission','POST',{action:'MOVE_TO',target:{x:1,y:.5}});
    assert.equal(r.status,422);assert.equal(r.body.error,'model_not_calibrated');
  }finally{await s.close();}
});
test('Stale ArUco during autonomous movement triggers stop',async()=>{
  const arena={polygon:[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:0,y:3}]};
  let current=10000;
  const s=await start({arena,now:()=>current,poseTimeoutMs:500});
  try{
    await s.poll();
    await s.send('pose','POST',{x:.5,y:.5,heading:0,polygon_id:'poly-1',marker_id:17},'tracker-secret');
    assert.equal((await s.send('mission','POST',{action:'MOVE_TO',target:{x:.9,y:.5}})).status,201);
    current+=600;
    const r=await s.poll();
    assert.equal(r.body.stop,true);
    assert.equal((await s.send('status','GET')).body.fault.code,'POSE_STALE');
  }finally{await s.close();}
});
test('Recovery approval persists through software-error telemetry until healthy device poll',async()=>{
  const arena={polygon:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]};
  const s=await start({arena});
  try{
    await s.poll();
    await s.send('pose','POST',{x:.5,y:.5,heading:0,polygon_id:'poly-1',marker_id:17},'tracker-secret');
    await s.send('stop','POST',{});
    assert.equal((await s.poll()).body.stop,true);
    assert.equal((await s.send('reset','POST',{confirm:true})).status,200);
    assert.equal((await s.send('telemetry','POST',{boot:'boot-1',battery_v:7.3,error:7},'device-secret')).body.hold,false);
    assert.equal((await s.send('command?boot=boot-1&ready=0&error=7&battery_v=7.30','GET',null,'device-secret')).body.resume,true);
    assert.equal((await s.send('command?boot=boot-1&ready=0&error=7&battery_v=7.30','GET',null,'device-secret')).body.resume,true);
    const healthy=await s.send('command?boot=boot-1&ready=1&error=0&battery_v=7.30','GET',null,'device-secret');
    assert.equal(healthy.body.resume,true);
    assert.equal((await s.send('status','GET')).body.recoveryPending,false);
    assert.equal((await s.send('telemetry','POST',{boot:'boot-1',battery_v:5.1,error:5},'device-secret')).body.hold,true);
    assert.equal((await s.send('status','GET')).body.fault.code,'FIRMWARE_5');
  }finally{await s.close();}
});

test('Missing arena coordinates always reject movement, even if model flag is true',async()=>{
  const s=await start();
  try {
    await s.poll();
    const r=await s.send('commands','POST',{commands:[{kind:'forward',unit:'m',value:.02}]});
    assert.equal(r.status,422);
    assert.equal(r.body.detail,'arena_not_calibrated');
  } finally { await s.close(); }
});
