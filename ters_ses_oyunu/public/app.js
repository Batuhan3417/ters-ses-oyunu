const socket=io();
const $=id=>document.getElementById(id);
const phaseNames={lobby:'Lobi',record:'Ses kaydı',guess:'Tahminler',reveal:'Sonuçlar',end:'Bitti'};
let selfId='',token='',room='',state=null,recording=null,recorded=null,attempt=null,reverseSrc=null,reveal=null,lastRound=0,publicJudgments=[];
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',4300)}
function emit(event,data){return new Promise(resolve=>socket.emit(event,data,resolve));}
function blobData(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});}
function player(id){return state?.players.find(x=>x.id===id)}
function isHost(){return selfId===state?.hostId}
function isSpeaker(){return selfId===state?.speakerId}
function audioHtml(src){return `<audio controls preload="metadata" src="${src}"></audio>`}
async function record(btn,done,maxMs=15000){
 if(recording){recording.recorder.stop();return;}
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
  const rec=new MediaRecorder(stream,mime?{mimeType:mime}:{}),chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  let stopTimer;rec.onstop=async()=>{clearTimeout(stopTimer);stream.getTracks().forEach(t=>t.stop());recording=null;btn.textContent='🎙 Yeniden kaydet';const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});if(blob.size>5e6){toast('Kayıt büyük. Daha kısa deneyin.');return;}try{await done(await blobData(blob));}catch(e){toast('Kayıt işlenemedi: '+e.message)}};
  rec.start();recording={recorder:rec};btn.textContent='⏹ Kaydı bitir';stopTimer=setTimeout(()=>{if(rec.state==='recording')rec.stop()},maxMs);
 }catch(e){toast('Mikrofon erişimi gerekli: '+e.message)}
}
async function reverseWav(dataUrl){
 const array=await (await fetch(dataUrl)).arrayBuffer();
 const context=new (window.AudioContext||window.webkitAudioContext)();
 try{
  const buffer=await context.decodeAudioData(array.slice(0));const rate=buffer.sampleRate,channels=Math.min(buffer.numberOfChannels,2),n=buffer.length;
  const bytes=44+n*channels*2;const data=new ArrayBuffer(bytes),view=new DataView(data);let i=0;
  const str=s=>{for(const char of s)view.setUint8(i++,char.charCodeAt(0))};const u16=x=>{view.setUint16(i,x,true);i+=2};const u32=x=>{view.setUint32(i,x,true);i+=4};
  str('RIFF');u32(bytes-8);str('WAVEfmt ');u32(16);u16(1);u16(channels);u32(rate);u32(rate*channels*2);u16(channels*2);u16(16);str('data');u32(n*channels*2);
  const arrays=Array.from({length:channels},(_,ch)=>buffer.getChannelData(ch));
  for(let j=0;j<n;j++)for(let ch=0;ch<channels;ch++){const sample=Math.max(-1,Math.min(1,arrays[ch][n-1-j]));view.setInt16(i,sample<0?sample*32768:sample*32767,true);i+=2;}
  const blob=new Blob([data],{type:'audio/wav'});if(blob.size>6e6)throw new Error('Ses çok uzun. Daha kısa ses kaydedin.');return await blobData(blob);
 }finally{await context.close()}
}
$('code').value=new URLSearchParams(location.search).get('oda')||'';
$('name').value=localStorage.getItem('tersName')||'';
$('join').onclick=async()=>{const name=$('name').value.trim(),code=$('code').value.trim();const stored=JSON.parse(localStorage.getItem('tersRoom')||'null');const existing=stored?.code===code.toUpperCase()?stored?.token:null;const r=await emit('join',{name,code,token:existing});if(!r.ok)return toast(r.error);selfId=r.playerId;token=r.token;room=r.code;localStorage.setItem('tersName',name);localStorage.setItem('tersRoom',JSON.stringify({code:room,token}));$('login').hidden=true;$('game').hidden=false;history.replaceState(null,'',`?oda=${room}`)};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+location.pathname+'?oda='+room);toast('Davet bağlantısı kopyalandı.')}catch(e){toast('Bağlantıyı adres çubuğundan kopyalayın.')}};
socket.on('state',s=>{const changed=s.round!==lastRound||s.phase!==state?.phase;if(s.round!==lastRound){recorded=null;attempt=null;reverseSrc=null;reveal=null;publicJudgments=[];lastRound=s.round;}state=s;if(changed||true)render()});
socket.on('reverse-audio',src=>{reverseSrc=src;render()});
socket.on('reveal-data',d=>{reveal=d;render()});
socket.on('judged',j=>{if(!publicJudgments.some(x=>x.playerId===j.playerId))publicJudgments.push(j);if(state?.phase==='reveal'&&isHost())emit('get-reveal',{}).then(r=>{if(r.ok){reveal=r.data;render()}})});
socket.on('replaced',()=>toast('Aynı oyuncuyla başka oturum açıldı.'));
socket.on('disconnect',()=>toast('Sunucu bağlantısı kesildi, yeniden bağlanıyor...'));
socket.on('connect',async()=>{if(!selfId)return;const r=await emit('join',{code:room,name:localStorage.getItem('tersName'),token});if(!r.ok)toast(r.error)});
function render(){if(!state)return;const s=state;$('roomCode').textContent=s.code;$('round').textContent=s.round||'—';$('phaseLabel').textContent=phaseNames[s.phase];$('count').textContent=`(${s.players.length}/10)`;
 $('players').innerHTML=s.players.map(p=>`<div class="player"><span>${escapeHTML(p.name)} ${p.id===s.hostId?'<span class="pill">Kurucu</span>':''} ${p.id===s.speakerId?'<span class="pill">Ses sahibi</span>':''} ${p.ready?'<span class="pill">Hazır</span>':''} ${!p.connected?'⚫':''}</span><b>${p.score}</b></div>`).join('');
 const d=$('dynamic'),h=$('heading'),inst=$('instruction');h.textContent='';inst.textContent='';d.innerHTML='';
 if(s.phase==='lobby'){h.textContent='Oda hazır!';inst.textContent='Davet bağlantısını arkadaşlarına gönder. En az 2 oyuncu ile başlayabilirsiniz.';d.innerHTML=isHost()?'<button id="start">Oyunu başlat</button>':'<p>Kurucunun oyunu başlatması bekleniyor.</p>';if($('start'))$('start').onclick=()=>action('start',{});}
 else if(s.phase==='record'){if(isSpeaker()){h.textContent='Sıra sende! 🎤';inst.textContent='Kısa bir cümle söyle (en fazla 15 saniye). Sistem kaydını tersine çevirip diğer oyunculara iletecek.';d.innerHTML=`<label>Asıl cümle (sonuçta gösterilecek)<input id="originalText" maxlength="160" placeholder="Ör: Bugün hava çok güzel"></label><div class="row"><button id="recordBtn">🎙 Ses kaydet</button><button id="sendOriginal" disabled>Sesi diğer oyunculara gönder</button></div><div id="preview"></div>`;$('recordBtn').onclick=()=>record($('recordBtn'),async data=>{recorded=data;$('preview').innerHTML=audioHtml(data);$('sendOriginal').disabled=false});$('sendOriginal').onclick=async()=>{const text=$('originalText').value.trim();if(!text)return toast('Asıl cümleyi yaz.');try{$('sendOriginal').disabled=true;const rev=await reverseWav(recorded);await action('speaker-submit',{audio:recorded,reverseAudio:rev,text});}catch(e){$('sendOriginal').disabled=false;toast(e.message)}};}else{h.textContent='Ses hazırlanıyor...';inst.textContent=`${player(s.speakerId)?.name||'Oyuncu'} kaydını hazırlıyor.`;}}
 else if(s.phase==='guess'){if(isSpeaker()){h.textContent='Tahminler geliyor';inst.textContent=`Hazır: ${s.submitted}/${s.expected}. Kendi sesini gönderdiğin için bu tur tahmin yapmıyorsun.`;if(isHost()&&s.submitted)d.innerHTML='<button id="skip" class="secondary">Hazır olmayanları beklemeden sonuçlara geç</button>';}else{const me=player(selfId);h.textContent=me?.ready?'Tahminin kaydedildi ✓':'Sesi çöz! 🔁';inst.textContent=me?.ready?`Diğerleri bekleniyor (${s.submitted}/${s.expected}).`:'Önce ters sesi dinle, sonra duyduklarını tersten telaffuz edip kendi denemeni kaydet. Kaydını normal yönde dinleyerek gerçek cümleyi tahmin et.';d.innerHTML=`<h3>1. Ters ses</h3>${reverseSrc?audioHtml(reverseSrc):'<p>Ses yükleniyor...</p>'}`;if(!me?.ready){d.innerHTML+=`<h3>2. Kendi denemen</h3><button id="recordBtn">🎙 Tersten duyduğumu söyle</button><div id="preview"></div><h3>3. Tahminini gönder</h3><label>Tahmin ettiğin cümle<input id="guess" maxlength="160" placeholder="Gerçek söylenen sözü yaz"></label><button id="submitGuess" disabled>✓ Hazırım · Tahmini onayla</button>`;$('recordBtn').onclick=()=>record($('recordBtn'),async data=>{attempt=data;$('preview').innerHTML='<p>Kaydın (düz oynatma):</p>'+audioHtml(data);$('submitGuess').disabled=false});$('submitGuess').onclick=async()=>{if(!attempt)return toast('Önce sesini kaydet.');$('submitGuess').disabled=true;const r=await emit('submit-guess',{audio:attempt,guess:$('guess').value});if(!r.ok){toast(r.error);$('submitGuess').disabled=false}};}}if($('skip'))$('skip').onclick=()=>action('force-reveal',{});}
 else if(s.phase==='reveal'){h.textContent='Tahminleri açma zamanı!';inst.textContent=isHost()?'Kayıtları hazır olma sırasıyla tek tek oynat, tahminleri kontrol et ve doğru/yanlış işaretle.':'Kurucu tahminleri sırayla açıklıyor.';if(!reveal&&isHost()){d.innerHTML='<p>Sonuçlar yükleniyor...</p>';emit('get-reveal',{}).then(r=>{if(r.ok){reveal=r.data;render()}});return;}if(isHost()){d.innerHTML=`<div class="entry"><b>Gerçek cümle:</b> ${escapeHTML(reveal.speakerText)}${audioHtml(reveal.speakerAudio)}</div>`+reveal.entries.map(e=>{const judged=s.revealed.find(x=>x.playerId===e.playerId);return `<div class="entry"><strong>#${e.rank} ${escapeHTML(e.name)}</strong><p>${escapeHTML(e.guess)}</p>${audioHtml(e.audio)}${judged?`<p>${judged.correct?'✅ Doğru':'❌ Yanlış'} · +${judged.awarded} puan</p>`:`<div class="row"><button class="correct" data-id="${e.playerId}">✓ Doğru</button><button class="wrong danger" data-id="${e.playerId}">✕ Yanlış</button></div>`}</div>`}).join('')+`<button id="next" ${s.revealed.length!==reveal.entries.length?'disabled':''}>${s.players.some(p=>p.score>=100)?'Şampiyonu açıkla':'Sonraki tur →'}</button>`;d.querySelectorAll('.correct,.wrong').forEach(b=>b.onclick=async()=>{await action('judge',{playerId:b.dataset.id,correct:b.classList.contains('correct')});});$('next').onclick=()=>action('next-round',{});}else{d.innerHTML='<p>Kurucu şu anda kayıtları değerlendiriyor.</p>'+publicJudgments.map(x=>`<div class="entry"><strong>${escapeHTML(player(x.playerId)?.name)}</strong><p>${escapeHTML(x.guess)}</p>${audioHtml(x.audio)}${x.correct?'✅ Doğru':'❌ Yanlış'} · +${x.awarded}</div>`).join('');}}
 else if(s.phase==='end'){h.textContent='🏆 Oyun bitti!';inst.textContent=`Kazanan: ${player(s.winnerId)?.name||'Oyuncu'}!`;d.innerHTML=`<div class="score">${player(s.winnerId)?.score||100} puan</div><p>Yeni oyun için yeni bir oda oluşturabilirsiniz.</p>`;}
}
async function action(event,data){const r=await emit(event,data);if(!r.ok)toast(r.error);return r;}
