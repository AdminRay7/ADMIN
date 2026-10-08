const API = "";       // same origin
let TOKEN = localStorage.getItem("admin_token") || "";
const $ = id => document.getElementById(id);

function toast(m, c=""){const t=$("toast");t.textContent=m;t.className="toast show "+c;clearTimeout(t._t);t._t=setTimeout(()=>t.className="toast "+c,2500)}
function log(m){const el=$("sysLog");if(!el)return;el.innerHTML+=`<div>${new Date().toLocaleTimeString()} ${m}</div>`;el.scrollTop=el.scrollHeight;$("logCount").textContent=el.children.length}

async function api(path, opts={}){
  opts.headers = Object.assign({"Content-Type":"application/json","X-Auth-Token":TOKEN}, opts.headers||{});
  const r = await fetch(API+path, opts);
  return r;
}

/* LOGIN */
async function doLogin(){
  const pw = $("pwInput").value;
  const r = await api("/api/login", {method:"POST", body: JSON.stringify({password: pw})});
  const j = await r.json();
  if(j.ok){ TOKEN = j.token; localStorage.setItem("admin_token", TOKEN); showApp(); }
  else { $("loginErr").textContent = j.error || "failed"; setTimeout(()=>$("loginErr").textContent="",2000); }
}
$("pwInput").addEventListener("keydown", e=>{if(e.key==="Enter")doLogin()});

async function doLogout(){
  await api("/api/logout", {method:"POST"});
  TOKEN=""; localStorage.removeItem("admin_token"); location.reload();
}

function showApp(){
  $("loginGate").style.display = "none";
  $("app").style.display = "block";
  log("Logged in ✓");
  refreshUploads();
}

/* auto-login */
if(TOKEN){ showApp(); }

/* UPLOAD */
async function uploadCapture(type, blob, meta={}){
  const dataUrl = await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(blob)});
  const body = JSON.stringify({type, ts: Date.now(), meta, dataUrl});
  const r = await api("/api/upload", {method:"POST", body});
  const j = await r.json();
  if(j.ok){ log(`Uploaded ${j.filename} (${j.size} B)`); refreshUploads(); }
  else log("Upload failed: "+j.error);
  return j;
}

/* LIST */
async function refreshUploads(){
  const r = await api("/api/list");
  const j = await r.json();
  const grid = $("mediaGrid");
  $("uploadCount").textContent = j.count;
  $("uploadCount2").textContent = j.count + " items";
  if(!j.files.length){ grid.innerHTML = '<div class="empty">No uploads yet.</div>'; return; }
  grid.innerHTML = j.files.map(f=>`
    <div class="media-item" onclick="window.open('${f.url}?token=${TOKEN}','_blank')">
      ${f.name.endsWith(".json")||f.name.endsWith(".txt")
        ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:2rem">📄</div>`
        : f.name.endsWith(".webm")||f.name.endsWith(".mp4")
          ? `<video src="${f.url}?token=${TOKEN}" muted></video>`
          : `<img src="${f.url}?token=${TOKEN}">`}
      <div class="label">${f.name}</div>
    </div>`).join("");
}

/* FEATURES */
const FEATURES = {
  camera: renderCamera, mic: renderMic, video: renderVideo,
  location: renderLocation, battery: renderBattery, device: renderDevice,
  network: renderNetwork, audio: renderAudio, notify: renderNotify, vibrate: renderVibrate
};
$("featureGrid").addEventListener("click", e=>{
  const c = e.target.closest(".feature"); if(!c) return;
  $("activePanel").style.display="block";
  $("panelTitle").textContent = c.querySelector(".name").textContent;
  FEATURES[c.dataset.feature]();
});

/* CAMERA */
function renderCamera(){
  $("panelBody").innerHTML = `
    <video id="camPreview" autoplay playsinline muted></video>
    <div class="btn-row">
      <button class="btn" id="camFront">🤳 Front</button>
      <button class="btn" id="camRear">📷 Rear</button>
      <button class="btn green" id="camSnap" disabled>📸 Capture + Upload</button>
    </div>`;
  let facing = "environment", stream;
  async function start(f){
    facing = f;
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:f}});
    $("camPreview").srcObject = stream;
    $("camSnap").disabled = false;
    $("ledCam").className = "led on"; $("camStatus").textContent = "active";
  }
  $("camFront").onclick = ()=>start("user");
  $("camRear").onclick = ()=>start("environment");
  $("camSnap").onclick = ()=>{
    const v = $("camPreview");
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    c.toBlob(b=>uploadCapture(facing==="user"?"selfie":"camera", b), "image/jpeg", 0.92);
  };
}

/* MIC */
function renderMic(){
  $("panelBody").innerHTML = `
    <div class="btn-row">
      <button class="btn green" id="micStart">🎤 Start</button>
      <button class="btn red" id="micStop" disabled>⏹ Stop</button>
    </div>`;
  let rec, chunks, stream;
  $("micStart").onclick = async ()=>{
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    rec = new MediaRecorder(stream); chunks = [];
    rec.ondataavailable = e=>chunks.push(e.data);
    rec.onstop = async ()=>{
      const blob = new Blob(chunks,{type:"audio/webm"});
      await uploadCapture("audio", blob);
      stream.getTracks().forEach(t=>t.stop());
      $("ledMic").className="led"; $("micStatus").textContent="off";
    };
    rec.start(); $("micStart").disabled=true; $("micStop").disabled=false;
    $("ledMic").className="led on"; $("micStatus").textContent="recording";
  };
  $("micStop").onclick = ()=>{
    rec.stop(); $("micStart").disabled=false; $("micStop").disabled=true;
  };
}

/* VIDEO */
function renderVideo(){
  $("panelBody").innerHTML = `
    <video id="vidPreview" autoplay playsinline muted></video>
    <div class="btn-row">
      <button class="btn" id="vStart">▶ Enable</button>
      <button class="btn green" id="vRec" disabled>⏺ Rec+Upload</button>
      <button class="btn red" id="vStop" disabled>⏹ Stop</button>
    </div>`;
  let stream, rec, chunks;
  $("vStart").onclick = async ()=>{
    stream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    $("vidPreview").srcObject = stream;
    $("vRec").disabled = false;
  };
  $("vRec").onclick = ()=>{
    rec = new MediaRecorder(stream,{mimeType:"video/webm"}); chunks=[];
    rec.ondataavailable = e=>chunks.push(e.data);
    rec.onstop = async ()=>{
      const blob = new Blob(chunks,{type:"video/webm"});
      await uploadCapture("video", blob);
    };
    rec.start(); $("vRec").disabled=true; $("vStop").disabled=false;
  };
  $("vStop").onclick = ()=>{ rec.stop(); $("vRec").disabled=false; $("vStop").disabled=true; };
}

/* LOCATION */
function renderLocation(){
  $("panelBody").innerHTML = `<button class="btn" id="locGo">📍 Get Location + Upload</button><div id="locOut" style="margin-top:12px"></div>`;
  $("locGo").onclick = ()=>{
    navigator.geolocation.getCurrentPosition(async p=>{
      const {latitude:lat,longitude:lng,accuracy} = p.coords;
      $("locOut").innerHTML = `<div class="log">lat: ${lat}\nlng: ${lng}\n±${accuracy}m</div>`;
      const blob = new Blob([JSON.stringify({lat,lng,accuracy,ts:Date.now()},null,2)],{type:"application/json"});
      await uploadCapture("location", blob, {lat,lng,accuracy});
    }, err=>toast("GPS denied","red"), {enableHighAccuracy:true});
  };
}

/* BATTERY */
async function renderBattery(){
  if(!navigator.getBattery){ $("panelBody").innerHTML = "Not supported"; return; }
  const b = await navigator.getBattery();
  $("panelBody").innerHTML = `<div class="log">Level: ${(b.level*100).toFixed(0)}%\nCharging: ${b.charging}</div>`;
}

/* DEVICE */
function renderDevice(){
  const info = {ua: navigator.userAgent, platform: navigator.platform,
    cores: navigator.hardwareConcurrency, screen: screen.width+"x"+screen.height,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone};
  $("panelBody").innerHTML = `<div class="log">${Object.entries(info).map(([k,v])=>`<b>${k}:</b> ${v}`).join("<br>")}</div>
    <button class="btn" id="devUp">💾 Upload to Server</button>`;
  $("devUp").onclick = ()=>{
    const blob = new Blob([JSON.stringify(info,null,2)],{type:"application/json"});
    uploadCapture("device", blob);
  };
}

/* NETWORK */
function renderNetwork(){
  $("panelBody").innerHTML = `<button class="btn" id="nGo">🔍 Test</button><div id="nOut" style="margin-top:12px"></div>`;
  $("nGo").onclick = async ()=>{
    $("nOut").innerHTML = "Testing…";
    let ip="—";
    try{ ip = (await (await fetch("https://api.ipify.org?format=json")).json()).ip; }catch(e){}
    const conn = navigator.connection || {};
    $("nOut").innerHTML = `<div class="log">IP: ${ip}\nDownlink: ${conn.downlink||"—"}\nRTT: ${conn.rtt||"—"}</div>`;
    const blob = new Blob([JSON.stringify({ip, conn},null,2)],{type:"application/json"});
    await uploadCapture("network", blob, {ip});
  };
}

/* AUDIO */
function renderAudio(){
  $("panelBody").innerHTML = `
    <select id="aType"><option value="beep">Beep</option><option value="siren">Siren</option><option value="speech">TTS</option></select>
    <input id="aText" placeholder="text" style="margin-top:8px;width:100%;padding:10px;border-radius:8px;background:var(--panel2);border:1px solid var(--border);color:var(--text)">
    <button class="btn" id="aGo" style="margin-top:12px">🔊 Play</button>`;
  $("aGo").onclick = ()=>{
    const t = $("aType").value;
    if(t==="speech") return speechSynthesis.speak(new SpeechSynthesisUtterance($("aText").value||"Alert"));
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); o.frequency.value = t==="siren"?600:880;
    o.type = t==="siren"?"sawtooth":"sine"; o.connect(ctx.destination); o.start();
    setTimeout(()=>o.stop(), 3000);
  };
}

/* NOTIFY */
function renderNotify(){
  $("panelBody").innerHTML = `
    <input id="nTitle" value="Admin Console" style="width:100%;padding:10px;border-radius:8px;background:var(--panel2);border:1px solid var(--border);color:var(--text);margin-bottom:8px">
    <input id="nBody" value="Hello" style="width:100%;padding:10px;border-radius:8px;background:var(--panel2);border:1px solid var(--border);color:var(--text)">
    <button class="btn" id="nPerm" style="margin-top:12px">🔑 Permission</button>
    <button class="btn green" id="nSend" style="margin-top:8px">🔔 Send</button>`;
  $("nPerm").onclick = async ()=>{ const p = await Notification.requestPermission(); toast("Permission: "+p); };
  $("nSend").onclick = ()=>{ if(Notification.permission==="granted") new Notification($("nTitle").value,{body:$("nBody").value}); };
}

/* VIBRATE */
function renderVibrate(){
  $("panelBody").innerHTML = `<button class="btn" id="vGo">📳 Vibrate</button>`;
  $("vGo").onclick = ()=>{ if(navigator.vibrate) navigator.vibrate([200,100,200]); else toast("Unsupported","red"); };
}

/* PWA install */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e=>{e.preventDefault();deferredPrompt=e});
function handleInstall(){
  if(deferredPrompt){ deferredPrompt.prompt(); deferredPrompt=null; }
  else toast("Use browser menu → Add to Home Screen");
}
function dismissInstallBar(){ $("installBar").style.display="none"; }