// Умный водитель с ОСАГО — 3D-движок v2.5
// — Новая таблица КБМ: класс пересчитывается по окончании заезда (года)
// — Очки = сэкономленные рубли относительно базовой цены (класс 3, КБМ 1.0)
// — SDK без дублирования, LoadingAPI.ready() после полной загрузки
// — devicePixelRatio для чёткой картинки на retina
// — Аудио инициализируется по первому клику
// — gameLoop в try/catch
// — touchcancel / mouseleave / blur для надежного управления
// — Сохранение сессии (незавершенный сезон)

var canvas, ctx, W, H;
var SEGMENT_LENGTH = 200, RUMBLE_LENGTH = 3, ROAD_WIDTH = 2000, LANES = 3;
var CAMERA_HEIGHT = 1000, CAMERA_DEPTH = 0.84, DRAW_DISTANCE = 300, FOG_DENSITY = 5;
var MAX_SPEED = 12000, ACCEL = MAX_SPEED/5, BREAKING = -MAX_SPEED;
var DECEL = -MAX_SPEED/5, OFF_ROAD_DECEL = -MAX_SPEED/2, OFF_ROAD_LIMIT = MAX_SPEED/4;

var game = {
  cityCoef:1.0, powerCoef:1.0, currentClass:3, currentKBM:1.0,
  crashes:0, totalCrashes:0, lap:1, maxLaps:10,
  distance:0, trackLength:0, speed:0, playerX:0,
  isRunning:false, isPaused:false, startPrice:0, seasonBasePrice:0,
  bestScore:0, gamesPlayed:0,
  landscape:'forest', ownedCars:['default'],
  activeCar:'default', activeDashboard:'niva', hasVIP:false, hasShield:false, shieldActive:false, shieldTime:0,
  soundEnabled:true, trackIndex:0
};

// === ТАБЛИЦА КБМ ===
var KBM_TABLE = {1:1.55,2:1.4,3:1.0,4:0.95,5:0.9,6:0.85,7:0.8,8:0.75,9:0.70,10:0.65,11:0.60,12:0.55,13:0.50};

// Переход класса по окончании года (заезда) в зависимости от количества выплат (аварий)
// Индексы: [0 аварий, 1 авария, 2 аварии, 3 аварии, 4+ аварий]
var KBM_TRANSITION = {
   1:  [2,    1,   1,   1,   1],
   2:  [3,    1,   1,   1,   1],
   3:  [4,    1,   1,   1,   1],
   4:  [5,    2,   1,   1,   1],
   5:  [6,    3,   1,   1,   1],
   6:  [7,    4,   2,   1,   1],
   7:  [8,    4,   2,   1,   1],
   8:  [9,    5,   2,   1,   1],
   9:  [10,   5,   2,   1,   1],
  10:  [11,   6,   3,   1,   1],
  11:  [12,   6,   3,   1,   1],
  12:  [13,   6,   3,   1,   1],
  13:  [13,   7,   3,   1,   1]
};

var segments = [];
var keyLeft=false, keyRight=false, keyFaster=false, keySlower=false;
var lastTime = 0, lastCrashSeg = -1;

var ysdk=null, player=null, lb=null, isYaGames=false, yaGamesReady=false;
var payments=null, paymentsReady=false;
var audioCtx=null, sounds={};
var audioInitialized = false;
var crashUndoOverlay=null;

// === ИНИЦИАЛИЗАЦИЯ SDK (без дублирования) ===
function initSdk(){
  if(typeof YaGames !== 'undefined'){
    YaGames.init().then(function(_ysdk){
      ysdk=_ysdk; isYaGames=true;
      return ysdk.getPlayer({scopes:false});
    }).then(function(_player){
      player=_player;
      return ysdk.getLeaderboards();
    }).then(function(_lb){
      lb=_lb; yaGamesReady=true;
      return ysdk.getPayments({signed:true});
    }).then(function(_payments){
      payments=_payments; paymentsReady=true;
      console.log('Payments API ready');
      return loadCloudProgress();
    }).then(function(){
      bootstrap();
      if(ysdk.features && ysdk.features.LoadingAPI){
        ysdk.features.LoadingAPI.ready();
      }
    }).catch(function(err){
      console.warn('YaGames err:',err.message||err); isYaGames=false; bootstrap();
    });
  } else {
    console.log('Локальный режим'); bootstrap();
  }
}

// === ПРОГРЕСС ===
function saveCloudProgress(){
  if(!player||!isYaGames){ saveLocalProgress(); return Promise.resolve(); }
  return player.setData({
    version:'2.5',bestScore:game.bestScore,gamesPlayed:game.gamesPlayed,totalCrashes:game.totalCrashes,
    ownedCars:game.ownedCars,activeCar:game.activeCar,activeDashboard:game.activeDashboard,hasVIP:game.hasVIP,
    currentClass:game.currentClass,currentKBM:game.currentKBM,trackIndex:game.trackIndex,
    cityCoef:game.cityCoef,powerCoef:game.powerCoef
  }).catch(function(){ saveLocalProgress(); });
}
function loadCloudProgress(){
  if(!player||!isYaGames){ loadLocalProgress(); return Promise.resolve(); }
  return player.getData().then(function(d){
    if(d&&Object.keys(d).length>0){
      var savedClass=d.currentClass;
      if(!d.version || savedClass==='M' || savedClass===0 || savedClass===null || savedClass===undefined){
        console.log('Миграция облака: старый прогресс, сброс класса на 3');
        game.currentClass=3; game.currentKBM=1.0;
      }else{
        game.currentClass=savedClass||3; game.currentKBM=d.currentKBM||1.0;
      }
      game.bestScore=d.bestScore||0; game.gamesPlayed=d.gamesPlayed||0; game.totalCrashes=d.totalCrashes||0;
      game.ownedCars=d.ownedCars||['default']; game.activeCar=d.activeCar||'default'; game.activeDashboard=d.activeDashboard||'niva'; game.hasVIP=d.hasVIP||false;
      game.trackIndex=d.trackIndex||0;
      game.cityCoef=d.cityCoef||1.64; game.powerCoef=d.powerCoef||1.1;
      var trackEl=document.getElementById('track');
      if(trackEl) trackEl.value=game.trackIndex;
      game.trackIndex=d.trackIndex||0;
      var trackEl=document.getElementById('track');
      if(trackEl) trackEl.value=game.trackIndex;
    } else loadLocalProgress();
  }).catch(function(){ loadLocalProgress(); });
}
function saveLocalProgress(){
  try{ localStorage.setItem('umny_voditel_progress', JSON.stringify({
    version:'2.5',bestScore:game.bestScore,gamesPlayed:game.gamesPlayed,totalCrashes:game.totalCrashes,
    ownedCars:game.ownedCars,activeCar:game.activeCar,activeDashboard:game.activeDashboard,hasVIP:game.hasVIP,
    currentClass:game.currentClass,currentKBM:game.currentKBM,trackIndex:game.trackIndex,
    cityCoef:game.cityCoef,powerCoef:game.powerCoef
  }));}catch(e){}
}
function loadLocalProgress(){
  try{ var d=JSON.parse(localStorage.getItem('umny_voditel_progress'));
    if(d){
      var savedClass=d.currentClass;
      // Миграция: старая версия без version ИЛИ класс M/0 (убраны из игры) → сброс на 3
      if(!d.version || savedClass==='M' || savedClass===0 || savedClass===null || savedClass===undefined){
        console.log('Миграция: старый прогресс, сброс класса на 3');
        game.currentClass=3; game.currentKBM=1.0;
      }else{
        game.currentClass=savedClass||3; game.currentKBM=d.currentKBM||1.0;
      }
      game.bestScore=d.bestScore||0; game.gamesPlayed=d.gamesPlayed||0; game.totalCrashes=d.totalCrashes||0;
      game.ownedCars=d.ownedCars||['default']; game.activeCar=d.activeCar||'default'; game.activeDashboard=d.activeDashboard||'niva'; game.hasVIP=d.hasVIP||false;
      game.trackIndex=d.trackIndex||0;
      game.cityCoef=d.cityCoef||1.64; game.powerCoef=d.powerCoef||1.1;
      var trackEl=document.getElementById('track');
      if(trackEl) trackEl.value=game.trackIndex;
      game.trackIndex=d.trackIndex||0;
      var trackEl=document.getElementById('track');
      if(trackEl) trackEl.value=game.trackIndex;
    }
  }catch(e){}
}
function saveSessionProgress(){
  try{ localStorage.setItem('umny_voditel_session', JSON.stringify({
    version:'2.5', lap:game.lap, currentClass:game.currentClass, currentKBM:game.currentKBM,
    cityCoef:game.cityCoef, powerCoef:game.powerCoef, seasonBasePrice:game.seasonBasePrice
  }));}catch(e){}
}
function loadSessionProgress(){
  try{ var d=JSON.parse(localStorage.getItem('umny_voditel_session'));
    if(d && d.lap>1 && d.lap<=game.maxLaps){
      var savedClass=d.currentClass;
      // Миграция: старый формат или класс M/0 (убраны из игры) → сброс
      if(!d.version || savedClass==='M' || savedClass===0 || savedClass===null || savedClass===undefined){
        console.log('Миграция сессии: старый формат или класс M/0, начинаем сезон заново');
        clearSessionProgress();
        game.lap=1; game.currentClass=3; game.currentKBM=1.0;
        return false;
      }
      // Проверяем валидность коэффициентов
      var validCities=[1.8,1.7,1.64,1.4,1.16,1.0];
      var validPowers=[0.6,1.0,1.1,1.2,1.4,1.6];
      var cc=parseFloat(d.cityCoef);
      var pc=parseFloat(d.powerCoef);
      if(validCities.indexOf(cc)===-1) cc=1.64;
      if(validPowers.indexOf(pc)===-1) pc=1.1;
      game.lap=d.lap; game.currentClass=savedClass; game.currentKBM=d.currentKBM;
      game.cityCoef=cc; game.powerCoef=pc; game.seasonBasePrice=d.seasonBasePrice||0;
      game.trackIndex=d.trackIndex||0;
      document.getElementById('city').value=cc;
      document.getElementById('power').value=pc;
      var trackEl=document.getElementById('track');
      if(trackEl) trackEl.value=game.trackIndex;
      document.getElementById('power').value=pc;
      updateStats();
      return true;
    }
  }catch(e){}
  return false;
}
function clearSessionProgress(){
  try{ localStorage.removeItem('umny_voditel_session'); }catch(e){}
}

// === РЕКЛАМА ===
function showFullscreenAd(){
  if(!ysdk||!isYaGames) return Promise.resolve(false);
  return ysdk.adv.showFullscreenAdv({callbacks:{onClose:function(){},onError:function(){}}});
}
function showRewardedAd(cb){
  if(!ysdk||!isYaGames){ if(cb)cb(false); return; }
  ysdk.adv.showRewardedVideo({callbacks:{
    onOpen:function(){ if(game.isRunning&&!game.isPaused) game.isPaused=true; },
    onRewarded:function(){ if(cb)cb(true); },
    onClose:function(){ if(game.isPaused){ game.isPaused=false; lastTime=0; requestAnimationFrame(gameLoop);} },
    onError:function(){ if(game.isPaused){ game.isPaused=false; lastTime=0; requestAnimationFrame(gameLoop);} if(cb)cb(false); }
  }});
}

// === ЛИДЕРБОРД ===
function showLeaderboard(){
  if(!ysdk||!isYaGames){ showToast('Таблицы лидеров только в Яндекс.Играх'); return; }
  ysdk.getLeaderboards().then(function(_lb){
    return _lb.getLeaderboardEntries('bestScore', {quantityTop:10, includeUser:true, quantityAround:3});
  }).then(function(result){
    var entries=result.entries||[];
    var html='<div style="max-height:55vh;overflow-y:auto;">';
    html+='<h3 style="text-align:center;margin-bottom:16px;color:#00f0ff;">🏆 Топ водителей</h3>';
    if(entries.length===0){
      html+='<p style="text-align:center;color:#888;">Пока нет записей. Сыграйте первый сезон!</p>';
    }else{
      entries.forEach(function(e,i){
        var medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+'.';
        var name=(e.player&&e.player.publicName)?e.player.publicName:'Игрок';
        var isMe=false;
        try{ if(player&&e.player&&e.player.getUniqueID&&player.getUniqueID&&e.player.getUniqueID()===player.getUniqueID()) isMe=true; }catch(err){}
        var bg=isMe?'background:rgba(0,240,255,0.08);border-radius:8px;':'';
        html+='<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);'+bg+'">';
        html+='<span style="display:inline-block;width:36px;font-size:1.1rem;">'+medal+'</span>';
        html+='<span style="color:#e0e0e0;">'+escapeHtml(name)+'</span>';
        html+='<span style="float:right;color:#00ff88;font-weight:700;">'+formatPrice(e.score)+'</span>';
        html+='</div>';
      });
    }
    html+='</div>';
    showModal(html);
  }).catch(function(err){ console.warn('Leaderboard error:',err); showToast('Не удалось загрузить таблицу'); });
}
function setLeaderboardScore(s){ if(!ysdk||!isYaGames||!lb) return; lb.setLeaderboardScore('bestScore',s).catch(function(){}); }
function escapeHtml(text){ var d=document.createElement('div'); d.textContent=text; return d.innerHTML; }
function showModal(html){
  var modal=document.createElement('div');
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';
  var box=document.createElement('div');
  box.style.cssText='background:#12121f;border:1px solid rgba(0,240,255,0.2);border-radius:20px;padding:24px;width:100%;max-width:380px;max-height:80vh;overflow-y:auto;';
  box.innerHTML=html;
  var closeBtn=document.createElement('button');
  closeBtn.textContent='Закрыть';
  closeBtn.className='btn-cyber';
  closeBtn.style.cssText='margin-top:16px;width:100%;';
  closeBtn.onclick=function(){ modal.remove(); };
  box.appendChild(closeBtn);
  modal.appendChild(box);
  modal.onclick=function(e){ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
}

// === АУДИО (по первому клику) ===
function ensureAudio(){
  if(audioInitialized) return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    sounds.crash=createNoiseBuffer(0.3,'square',150,50);
    sounds.engine=createEngineBuffer();
    sounds.win=createToneBuffer(0.5,'sine',880,440);
    sounds.click=createToneBuffer(0.1,'sine',1200,800);
    audioInitialized=true;
  }catch(e){}
}
function createNoiseBuffer(dur,type,f1,f2){
  if(!audioCtx) return null; var sr=audioCtx.sampleRate, len=sr*dur;
  var b=audioCtx.createBuffer(1,len,sr), data=b.getChannelData(0);
  for(var i=0;i<len;i++){ var t=i/len, f=f1+(f2-f1)*t;
    data[i]=Math.sin(2*Math.PI*f*t)*(1-t)*0.3;
    if(type==='square') data[i]=data[i]>0?0.3*(1-t):-0.3*(1-t); }
  return b;
}
function createEngineBuffer(){
  if(!audioCtx) return null; var sr=audioCtx.sampleRate, len=sr;
  var b=audioCtx.createBuffer(1,len,sr), data=b.getChannelData(0);
  for(var i=0;i<len;i++){ var t=i/sr; data[i]=(Math.sin(2*Math.PI*60*t)*0.05+Math.random()*0.02)*0.3; }
  return b;
}
function createToneBuffer(dur,type,f1,f2){
  if(!audioCtx) return null; var sr=audioCtx.sampleRate, len=sr*dur;
  var b=audioCtx.createBuffer(1,len,sr), data=b.getChannelData(0);
  for(var i=0;i<len;i++){ var t=i/len, f=f1+(f2-f1)*t; data[i]=Math.sin(2*Math.PI*f*t)*(1-t)*0.2; }
  return b;
}
function playSound(name){ if(!game.soundEnabled||!audioCtx||!sounds[name]) return; try{
  var src=audioCtx.createBufferSource(); src.buffer=sounds[name];
  var g=audioCtx.createGain(); g.gain.value=0.3; src.connect(g); g.connect(audioCtx.destination); src.start();
}catch(e){} }
function vibrate(p){ if(navigator.vibrate) navigator.vibrate(p); }

function limit(v,min,max){ return Math.max(min,Math.min(v,max)); }
function randomInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function randomChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function percentRemaining(n,total){ return (n%total)/total; }
function interpolate(a,b,p){ return a+(b-a)*p; }

// === ТРЕКИ ===
var TRACKS=[
  {
    name:'Лесная трасса',difficulty:'Лёгкий',length:800,
    landscapes:[{start:0,type:'forest'},{start:0.55,type:'field'}],
    curves:function(n,total){ return Math.sin(n/28)*1.6; },
    hills:function(n,total){ return Math.sin(n/18)*400; },
    obstacles:10,
    obstacleTypes:['sedan','taxi','truck','roadwork'],
    sceneryType:'tree', sceneryDensity:1.8, scenerySize:1.0,
    horizonType:'forest',
    skyTop:'#4FC3F7', skyBottom:'#B3E5FC',
    sunColor:'#FFEB3B', sunGlow:'rgba(255,235,59,0.3)',
    grassColor:'#66BB6A', grassDark:'#43A047',
    sceneryPalette:[
      {trunk:'#795548', dark:'#1B5E20', mid:'#2E7D32', light:'#4CAF50', snow:false},
      {trunk:'#6D4C41', dark:'#2E7D32', mid:'#388E3C', light:'#66BB6A', snow:false},
      {trunk:'#5D4037', dark:'#1B5E20', mid:'#2E7D32', light:'#43A047', snow:true}
    ]
  },
  {
    name:'Городское кольцо',difficulty:'Средний',length:1000,
    landscapes:[{start:0,type:'city'}],
    curves:function(n,total){ return (n%55<28?2.8:-2.8); },
    hills:function(n,total){ return Math.sin(n/35)*80; },
    obstacles:15,
    obstacleTypes:['sedan','taxi','police','truck','roadwork'],
    sceneryType:'building', sceneryDensity:1.2, scenerySize:1.1,
    horizonType:'city',
    skyTop:'#42A5F5', skyBottom:'#90CAF9',
    sunColor:'#FFEB3B', sunGlow:'rgba(255,235,59,0.25)',
    grassColor:'#81C784', grassDark:'#66BB6A',
    sceneryPalette:[
      {wall:'#EF5350', side:'#C62828', roof:'#B71C1C', window:'#FFEB3B', darkWindow:'#1A237E'},
      {wall:'#42A5F5', side:'#1565C0', roof:'#0D47A1', window:'#FFEB3B', darkWindow:'#1A237E'},
      {wall:'#FFCA28', side:'#F57F17', roof:'#E65100', window:'#FFEB3B', darkWindow:'#1A237E'},
      {wall:'#AB47BC', side:'#7B1FA2', roof:'#4A148C', window:'#FFEB3B', darkWindow:'#1A237E'},
      {wall:'#26A69A', side:'#00695C', roof:'#004D40', window:'#FFEB3B', darkWindow:'#1A237E'}
    ]
  },
  {
    name:'Горный серпантин',difficulty:'Сложный',length:1200,
    landscapes:[{start:0,type:'field'},{start:0.45,type:'forest'}],
    curves:function(n,total){ return Math.sin(n/9)*4.2; },
    hills:function(n,total){ return Math.sin(n/7)*350; },
    obstacles:20,
    obstacleTypes:['sedan','taxi','truck','roadwork'],
    sceneryType:'mountain', sceneryDensity:2.2, scenerySize:1.3,
    horizonType:'mountain',
    skyTop:'#90CAF9', skyBottom:'#E3F2FD',
    sunColor:'#FFF176', sunGlow:'rgba(255,241,118,0.35)',
    grassColor:'#AED581', grassDark:'#7CB342',
    sceneryPalette:[
      {rock:'#78909C', shadow:'#455A64', light:'#B0BEC5', snow:'#ECEFF1', tree:'#33691E'},
      {rock:'#8D6E63', shadow:'#5D4037', light:'#BCAAA4', snow:'#F5F5F5', tree:'#2E7D32'},
      {rock:'#607D8B', shadow:'#37474F', light:'#90A4AE', snow:'#FFFFFF', tree:'#1B5E20'}
    ]
  }
];

// === ДОРОГА ===
function createRoad(trackIdx){
  var track=TRACKS[trackIdx||0];
  segments=[];
  function addSegment(curve,y){
    var n=segments.length;
    segments.push({
      index:n,
      p1:{world:{z:n*SEGMENT_LENGTH,y:lastY()},camera:{},screen:{}},
      p2:{world:{z:(n+1)*SEGMENT_LENGTH,y:y},camera:{},screen:{}},
      curve:curve, sprites:[],
      color: Math.floor(n/RUMBLE_LENGTH)%2
        ? {road:'#37474F', grass:'#4CAF50', rumble:'#FF5252', lane:'#90A4AE'}
        : {road:'#455A64', grass:'#66BB6A', rumble:'#FFFFFF', lane:'#B0BEC5'}
    });
  }
  function lastY(){ return segments.length===0?0:segments[segments.length-1].p2.world.y; }
  // Стартовая прямая
  for(var n=0;n<80;n++) addSegment(0,0);
  // Основная часть трека
  for(n=0;n<track.length;n++){
    addSegment(track.curves(n,track.length), track.hills(n,track.length));
  }
  // Финишная прямая
  for(n=0;n<150;n++) addSegment(0,lastY());
  game.trackLength = segments.length*SEGMENT_LENGTH;

  var laneOffsets=[-0.55,0,0.55];
  var carColors=['#cc2222','#eeeeee','#2222cc','#ccaa22','#888888'];
  var step=Math.floor((segments.length-250)/track.obstacles);
  for(n=0;n<track.obstacles;n++){
    var idx=120+n*step+randomInt(-15,15);
    idx=limit(idx,100,segments.length-150);
    if(segments[idx].sprites.length>0) continue;
    segments[idx].sprites.push({
      type: randomChoice(track.obstacleTypes),
      offset: randomChoice(laneOffsets),
      color: randomChoice(carColors)
    });
  }
  // Добавляем scenery (ландшафтные объекты)
  var scStep=Math.max(3,Math.floor(8/track.sceneryDensity));
  var palette=track.sceneryPalette;
  for(n=80;n<segments.length-150;n+=scStep){
    var side=(n%2===0)?-1:1;
    var scOffset=side*(1.6+(n%7)*0.12);
    var pal=palette[n%palette.length];
    segments[n].scenery=segments[n].scenery||[];
    var scObj={
      type:track.sceneryType,
      offset:scOffset,
      heightVar:0.8+(n%5)*0.08,
      sizeMult:(track.scenerySize||1.0)*1.3
    };
    if(track.sceneryType==='tree'){
      scObj.trunk=pal.trunk; scObj.dark=pal.dark; scObj.mid=pal.mid; scObj.light=pal.light; scObj.snow=pal.snow;
    }else if(track.sceneryType==='building'){
      scObj.wall=pal.wall; scObj.side=pal.side; scObj.roof=pal.roof; scObj.window=pal.window; scObj.darkWindow=pal.darkWindow;
    }else{
      scObj.rock=pal.rock; scObj.shadow=pal.shadow; scObj.light=pal.light; scObj.snow=pal.snow; scObj.tree=pal.tree;
    }
    segments[n].scenery.push(scObj);
    // Пара — два объекта рядом для плотности
    if(n%3===0 && track.sceneryType!=='mountain'){
      var pal2=palette[(n+1)%palette.length];
      var scObj2={
        type:track.sceneryType,
        offset:scOffset*1.4,
        heightVar:0.6+(n%4)*0.1,
        sizeMult:(track.scenerySize||1.0)*0.9
      };
      if(track.sceneryType==='tree'){
        scObj2.trunk=pal2.trunk; scObj2.dark=pal2.dark; scObj2.mid=pal2.mid; scObj2.light=pal2.light; scObj2.snow=pal2.snow;
      }else if(track.sceneryType==='building'){
        scObj2.wall=pal2.wall; scObj2.side=pal2.side; scObj2.roof=pal2.roof; scObj2.window=pal2.window; scObj2.darkWindow=pal2.darkWindow;
      }
      segments[n].scenery.push(scObj2);
    }
  }
  // Дальний слой scenery (горизонт) для гор и леса
  if(track.sceneryType==='mountain'||track.sceneryType==='tree'){
    var farStep=Math.max(5,Math.floor(15/track.sceneryDensity));
    for(n=60;n<segments.length-100;n+=farStep){
      var side=(n%2===0)?-1:1;
      segments[n].farScenery=segments[n].farScenery||[];
      var farPal=palette[n%palette.length];
      var farObj={
        type:track.sceneryType,
        offset:side*(2.5+(n%3)*0.3),
        heightVar:1.2+(n%3)*0.2,
        sizeMult:1.8,
        far:true
      };
      if(track.sceneryType==='tree'){
        farObj.trunk='#5D4037'; farObj.dark='#1B5E20'; farObj.mid='#2E7D32'; farObj.light='#388E3C'; farObj.snow=false;
      }else{
        farObj.rock='#607D8B'; farObj.shadow='#455A64'; farObj.light='#90A4AE'; farObj.snow='#ECEFF1'; farObj.tree='#33691E';
      }
      segments[n].farScenery.push(farObj);
    }
  }
  for(n=0;n<segments.length;n++) segments[n].originalSprites=segments[n].sprites.slice();
}

function findSegment(z){ return segments[Math.floor(z/SEGMENT_LENGTH)%segments.length]; }

function project(p,cameraX,cameraY,cameraZ,cameraDepth,width,height,roadWidth){
  p.camera.x=(p.world.x||0)-cameraX;
  p.camera.y=(p.world.y||0)-cameraY;
  p.camera.z=(p.world.z||0)-cameraZ;
  p.screen.scale=cameraDepth/p.camera.z;
  p.screen.x=Math.round((width/2)+(p.screen.scale*p.camera.x*width/2));
  p.screen.y=Math.round((height/2)-(p.screen.scale*p.camera.y*height/2));
  p.screen.w=Math.round((p.screen.scale*roadWidth*width/2));
}

function render(){
  ctx.clearRect(0,0,W,H);
  var track=TRACKS[game.trackIndex||0];
  var skyTop=track?track.skyTop:'#0a1628';
  var skyBottom=track?track.skyBottom:'#1a3a5a';
  var skyGrad=ctx.createLinearGradient(0,0,0,H*0.5);
  skyGrad.addColorStop(0,skyTop);
  skyGrad.addColorStop(1,skyBottom);
  ctx.fillStyle=skyGrad; ctx.fillRect(0,0,W,H*0.5);
  renderLandscape();
  if(segments.length===0) return;

  var baseSegment=findSegment(game.distance);
  var basePercent=percentRemaining(game.distance,SEGMENT_LENGTH);
  var playerSegment=findSegment(game.distance+CAMERA_DEPTH*1000);
  var playerPercent=percentRemaining(game.distance+CAMERA_DEPTH*1000,SEGMENT_LENGTH);
  var playerY=interpolate(playerSegment.p1.world.y,playerSegment.p2.world.y,playerPercent);
  var dx=-(baseSegment.curve*basePercent), x=0, maxy=H;

  for(var n=0;n<DRAW_DISTANCE;n++){
    var seg=segments[(baseSegment.index+n)%segments.length];
    seg.looped=seg.index<baseSegment.index;
    seg.fog=1/(Math.pow(Math.E,(n/DRAW_DISTANCE)*(n/DRAW_DISTANCE)*FOG_DENSITY));
    project(seg.p1,(game.playerX*ROAD_WIDTH)-x,playerY+CAMERA_HEIGHT,
      game.distance-(seg.looped?game.trackLength:0),CAMERA_DEPTH,W,H,ROAD_WIDTH);
    project(seg.p2,(game.playerX*ROAD_WIDTH)-x-dx,playerY+CAMERA_HEIGHT,
      game.distance-(seg.looped?game.trackLength:0),CAMERA_DEPTH,W,H,ROAD_WIDTH);
    x+=dx; dx+=seg.curve;
    if(seg.p1.camera.z<=CAMERA_DEPTH||seg.p2.screen.y>=maxy||seg.p2.screen.y>=seg.p1.screen.y) continue;
    renderSegment(seg); maxy=seg.p1.screen.y;
  }

  for(n=DRAW_DISTANCE-1;n>0;n--){
    var seg=segments[(baseSegment.index+n)%segments.length];
    if(!seg.p1.screen.scale||seg.p1.screen.scale<=0) continue;
    // Дальний слой (параллакс — движется медленнее)
    if(seg.farScenery){ for(var j=0;j<seg.farScenery.length;j++) renderScenery(seg,seg.farScenery[j]); }
    // Ближний слой
    if(seg.scenery){ for(var j=0;j<seg.scenery.length;j++) renderScenery(seg,seg.scenery[j]); }
    for(var i=0;i<seg.sprites.length;i++) renderSprite(seg,seg.sprites[i]);
  }
  checkCollisions();
}

function renderSegment(seg){
  var x1=seg.p1.screen.x,y1=seg.p1.screen.y,w1=seg.p1.screen.w;
  var x2=seg.p2.screen.x,y2=seg.p2.screen.y,w2=seg.p2.screen.w;
  var r1=w1/Math.max(6,2*LANES), r2=w2/Math.max(6,2*LANES);
  ctx.fillStyle=seg.color.grass; ctx.fillRect(0,y2,W,y1-y2);
  drawPoly(x1-w1-r1,y1,x1-w1,y1,x2-w2,y2,x2-w2-r2,y2,seg.color.rumble);
  drawPoly(x1+w1+r1,y1,x1+w1,y1,x2+w2,y2,x2+w2+r2,y2,seg.color.rumble);
  drawPoly(x1-w1,y1,x1+w1,y1,x2+w2,y2,x2-w2,y2,seg.color.road);
  if(seg.color.lane){
    var lw1=w1*0.02,lw2=w2*0.02;
    var lx1=x1-w1*0.33,lx2=x2-w2*0.33;
    drawPoly(lx1-lw1,y1,lx1+lw1,y1,lx2+lw2,y2,lx2-lw2,y2,seg.color.lane);
    lx1=x1+w1*0.33; lx2=x2+w2*0.33;
    drawPoly(lx1-lw1,y1,lx1+lw1,y1,lx2+lw2,y2,lx2-lw2,y2,seg.color.lane);
  }
}
function drawPoly(x1,y1,x2,y2,x3,y3,x4,y4,color){
  ctx.fillStyle=color; ctx.beginPath();
  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.lineTo(x4,y4);
  ctx.closePath(); ctx.fill();
}

function renderSprite(seg, sprite){
  var sw = seg.p1.screen.w * 0.30;
  if(sw < 2) return;
  var sh = sw * 1.15;
  var sx = seg.p1.screen.x + (sprite.offset * seg.p1.screen.w) - sw/2;
  var sy = seg.p1.screen.y - sh * 0.88;
  if(sx < -sw || sx > W+sw || sy < -sh || sy > H+sh) return;
  if(sprite.type === 'roadwork') drawRoadWorkSign(sx, sy, sw, sh);
  else drawCarRear(sx, sy, sw, sh, sprite.type, sprite.color);
}

function drawRoadWorkSign(x, y, w, h){
  var cx = x + w/2, cy = y + h;
  var size = Math.min(w, h) * 0.9;
  var tx = cx, ty = cy - size * 0.55;
  var r = size * 0.42;
  ctx.fillStyle = '#555';
  ctx.fillRect(cx - 4, cy - size*0.12, 8, size*0.12);
  ctx.fillStyle = '#777';
  ctx.fillRect(cx - 2, cy - size*0.12, 4, size*0.12);
  ctx.fillStyle = '#cc0000';
  ctx.beginPath();
  ctx.moveTo(tx, ty - r);
  ctx.lineTo(tx + r*0.866, ty + r*0.5);
  ctx.lineTo(tx - r*0.866, ty + r*0.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffaa00';
  ctx.beginPath();
  ctx.moveTo(tx, ty - r*0.82);
  ctx.lineTo(tx + r*0.71, ty + r*0.41);
  ctx.lineTo(tx - r*0.71, ty + r*0.41);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111';
  var wx = tx - r*0.02, wy = ty + r*0.08;
  ctx.beginPath(); ctx.arc(wx - r*0.06, wy - r*0.22, r*0.09, 0, Math.PI*2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(wx - r*0.14, wy - r*0.12);
  ctx.lineTo(wx + r*0.04, wy - r*0.14);
  ctx.lineTo(wx + r*0.10, wy + r*0.12);
  ctx.lineTo(wx - r*0.08, wy + r*0.14);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(wx - r*0.12, wy + r*0.10, r*0.05, r*0.18);
  ctx.fillRect(wx + r*0.02, wy + r*0.10, r*0.05, r*0.18);
  ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, r*0.06);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(wx - r*0.02, wy - r*0.08); ctx.lineTo(wx + r*0.16, wy + r*0.04); ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(wx + r*0.14, wy + r*0.02);
  ctx.lineTo(wx + r*0.22, wy + r*0.12);
  ctx.lineTo(wx + r*0.18, wy + r*0.15);
  ctx.lineTo(wx + r*0.10, wy + r*0.05);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.ellipse(wx + r*0.20, wy + r*0.14, r*0.10, r*0.06, 0, 0, Math.PI*2);
  ctx.fill();
}

function drawCarRear(x, y, w, h, type, color){
  var cx = x + w/2, cy = y + h;
  if(type === 'truck'){
    var bw = w*0.92, bh = h*0.88, bx = cx - bw/2, by = cy - bh;
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(bx + bw*0.18, by + bh*0.88, bw*0.11, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + bw*0.82, by + bh*0.88, bw*0.11, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(bx + bw*0.18, by + bh*0.88, bw*0.055, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + bw*0.82, by + bh*0.88, bw*0.055, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bx, by + bh*0.75, bw, bh*0.14);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bx + bw*0.02, by + bh*0.32);
    ctx.lineTo(bx + bw*0.98, by + bh*0.32);
    ctx.quadraticCurveTo(bx + bw, by + bh*0.38, bx + bw, by + bh*0.45);
    ctx.lineTo(bx + bw, by + bh*0.75);
    ctx.lineTo(bx, by + bh*0.75);
    ctx.lineTo(bx, by + bh*0.45);
    ctx.quadraticCurveTo(bx, by + bh*0.38, bx + bw*0.02, by + bh*0.32);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shadeColor(color, -12);
    ctx.fillRect(bx + bw*0.04, by + bh*0.04, bw*0.92, bh*0.30);
    ctx.fillStyle = '#1a3a5a';
    ctx.beginPath();
    ctx.moveTo(bx + bw*0.10, by + bh*0.07);
    ctx.lineTo(bx + bw*0.90, by + bh*0.07);
    ctx.lineTo(bx + bw*0.87, by + bh*0.28);
    ctx.lineTo(bx + bw*0.13, by + bh*0.28);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#cc0000';
    ctx.beginPath(); ctx.ellipse(bx + bw*0.18, by + bh*0.65, bw*0.10, bh*0.055, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + bw*0.82, by + bh*0.65, bw*0.10, bh*0.055, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ff5555';
    ctx.beginPath(); ctx.ellipse(bx + bw*0.16, by + bh*0.63, bw*0.04, bh*0.02, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + bw*0.80, by + bh*0.63, bw*0.04, bh*0.02, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + bw*0.34, by + bh*0.76, bw*0.32, bh*0.07);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + bw*0.34, by + bh*0.76, bw*0.32, bh*0.07);
    ctx.fillStyle = '#000'; ctx.font = 'bold ' + Math.round(bh*0.035) + 'px Arial';
    ctx.textAlign = 'center'; ctx.fillText('A 123', cx, by + bh*0.82);
    return;
  }
  var bw = w*0.88, bh = h*0.88, bx = cx - bw/2, by = cy - bh;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - bh*0.02, bw*0.52, bh*0.08, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(bx + bw*0.16, by + bh*0.88, bw*0.12, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx + bw*0.84, by + bh*0.88, bw*0.12, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(bx + bw*0.16, by + bh*0.88, bw*0.06, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx + bw*0.84, by + bh*0.88, bw*0.06, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#888';
  ctx.beginPath(); ctx.arc(bx + bw*0.16, by + bh*0.88, bw*0.025, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx + bw*0.84, by + bh*0.88, bw*0.025, 0, Math.PI*2); ctx.fill();
  var grad = ctx.createLinearGradient(bx, by, bx + bw, by);
  grad.addColorStop(0, shadeColor(color, -8));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, shadeColor(color, -12));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(bx + bw*0.06, by + bh*0.36);
  ctx.lineTo(bx + bw*0.94, by + bh*0.36);
  ctx.quadraticCurveTo(bx + bw*0.98, by + bh*0.42, bx + bw, by + bh*0.52);
  ctx.lineTo(bx + bw, by + bh*0.80);
  ctx.quadraticCurveTo(bx + bw*0.96, by + bh*0.88, bx + bw*0.88, by + bh*0.88);
  ctx.lineTo(bx + bw*0.12, by + bh*0.88);
  ctx.quadraticCurveTo(bx + bw*0.04, by + bh*0.88, bx, by + bh*0.80);
  ctx.lineTo(bx, by + bh*0.52);
  ctx.quadraticCurveTo(bx + bw*0.02, by + bh*0.42, bx + bw*0.06, by + bh*0.36);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#1a3a5a';
  ctx.beginPath();
  ctx.moveTo(bx + bw*0.18, by + bh*0.38);
  ctx.lineTo(bx + bw*0.82, by + bh*0.38);
  ctx.lineTo(bx + bw*0.78, by + bh*0.54);
  ctx.lineTo(bx + bw*0.22, by + bh*0.54);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(120,200,255,0.20)';
  ctx.beginPath();
  ctx.moveTo(bx + bw*0.20, by + bh*0.40);
  ctx.lineTo(bx + bw*0.45, by + bh*0.40);
  ctx.lineTo(bx + bw*0.42, by + bh*0.50);
  ctx.lineTo(bx + bw*0.20, by + bh*0.50);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shadeColor(color, -35);
  ctx.fillRect(bx + bw*0.10, by + bh*0.32, bw*0.80, bh*0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(bx + bw*0.10, by + bh*0.32, bw*0.80, bh*0.02);
  ctx.fillStyle = '#b30000';
  ctx.beginPath(); ctx.ellipse(bx + bw*0.18, by + bh*0.66, bw*0.11, bh*0.065, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + bw*0.82, by + bh*0.66, bw*0.11, bh*0.065, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ff3333';
  ctx.beginPath(); ctx.ellipse(bx + bw*0.16, by + bh*0.64, bw*0.05, bh*0.025, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + bw*0.80, by + bh*0.64, bw*0.05, bh*0.025, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = shadeColor(color, -25);
  ctx.fillRect(bx + bw*0.04, by + bh*0.76, bw*0.92, bh*0.10);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx + bw*0.04, by + bh*0.76, bw*0.92, bh*0.02);
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx + bw*0.30, by + bh*0.80, bw*0.40, bh*0.06);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.strokeRect(bx + bw*0.30, by + bh*0.80, bw*0.40, bh*0.06);
  ctx.fillStyle = '#000';
  ctx.font = 'bold ' + Math.round(bh*0.032) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('A 123', cx, by + bh*0.845);
  ctx.fillStyle = '#444';
  ctx.fillRect(bx + bw*0.40, by + bh*0.88, bw*0.20, bh*0.04);
  ctx.fillStyle = '#222';
  ctx.fillRect(bx + bw*0.42, by + bh*0.86, bw*0.16, bh*0.02);
  if(type === 'police'){
    ctx.fillStyle = '#222';
    ctx.fillRect(bx + bw*0.36, by + bh*0.26, bw*0.28, bh*0.07);
    ctx.fillStyle = '#ff0000';
    ctx.beginPath(); ctx.arc(bx + bw*0.42, by + bh*0.27, bw*0.05, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#0000ff';
    ctx.beginPath(); ctx.arc(bx + bw*0.58, by + bh*0.27, bw*0.05, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + bw*0.22, by + bh*0.56, bw*0.56, bh*0.06);
    ctx.fillStyle = '#0000aa';
    ctx.font = 'bold ' + Math.round(bh*0.028) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ПОЛИЦИЯ', cx, by + bh*0.605);
  }
  if(type === 'taxi'){
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(bx + bw*0.22, by + bh*0.32, bw*0.56, bh*0.06);
    for(var i=0;i<3;i++){
      ctx.fillStyle = (i%2===0)?'#fff':'#000';
      ctx.fillRect(bx + bw*(0.25+i*0.16), by + bh*0.58, bw*0.08, bh*0.04);
    }
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath(); ctx.arc(cx, by + bh*0.30, bw*0.04, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold ' + Math.round(bh*0.02) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', cx, by + bh*0.305);
  }
}

function shadeColor(color, percent){
  var num = parseInt(color.replace("#",""),16);
  var amt = Math.round(2.55*percent);
  var R=(num>>16)+amt, G=(num>>8&0x00FF)+amt, B=(num&0x0000FF)+amt;
  return "#"+(0x1000000+(R<255?R<1?0:R:255)*0x10000+(G<255?G<1?0:G:255)*0x100+(B<255?B<1?0:B:255)).toString(16).slice(1);
}

function renderScenery(seg,sc){
  if(!seg.p1.screen.scale||seg.p1.screen.scale<=0) return;
  var scale=seg.p1.screen.scale;
  var sx=seg.p1.screen.x+(sc.offset*ROAD_WIDTH*W/2*scale);
  var sy=seg.p1.screen.y;
  var farMult=sc.far?1.8:1.0;
  var w=320*scale*sc.sizeMult*farMult, h=400*scale*sc.sizeMult*sc.heightVar*farMult;
  var pal=sc;

  if(sc.type==='tree'){
    // === МУЛЬТЯШНАЯ ЕЛЬ (как на референсах) ===
    var tw=w*0.12, th=h*0.32;
    // Ствол
    ctx.fillStyle=pal.trunk||'#795548';
    ctx.fillRect(sx-tw*0.5,sy-th*0.05,tw,th);
    // Тень
    ctx.fillStyle='rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(sx,sy+h*0.04,w*0.22,h*0.035,0,0,Math.PI*2); ctx.fill();
    // 3 яруса кроны с зигзаг-контурами
    var tiers=[
      {y:sy-h*0.12, w:w*0.85, h:h*0.42, c:pal.mid||'#2E7D32'},
      {y:sy-h*0.42, w:w*0.62, h:h*0.38, c:pal.dark||'#1B5E20'},
      {y:sy-h*0.70, w:w*0.38, h:h*0.32, c:pal.light||'#4CAF50'}
    ];
    tiers.forEach(function(t,idx){
      ctx.fillStyle=t.c;
      ctx.beginPath();
      ctx.moveTo(sx,t.y-t.h);
      // Левая сторона зигзагом
      ctx.lineTo(sx-t.w*0.35,t.y-t.h*0.35);
      ctx.lineTo(sx-t.w*0.5,t.y);
      // Правая сторона зигзагом
      ctx.lineTo(sx+t.w*0.5,t.y);
      ctx.lineTo(sx+t.w*0.35,t.y-t.h*0.35);
      ctx.closePath();
      ctx.fill();
      // Тёмный контур
      ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=1.2*scale;
      ctx.stroke();
    });
    // Снежная шапка
    if(pal.snow){
      ctx.fillStyle='rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(sx-w*0.12,sy-h*0.82);
      ctx.lineTo(sx,sy-h*1.02);
      ctx.lineTo(sx+w*0.12,sy-h*0.82);
      ctx.lineTo(sx,sy-h*0.75);
      ctx.fill();
    }

  }else if(sc.type==='building'){
    // === МУЛЬТЯШНЫЙ ДОМ (как на референсах) ===
    var bw=w*0.8, bh=h*0.88;
    // Тень
    ctx.fillStyle='rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(sx,sy+h*0.02,bw*0.5,h*0.035,0,0,Math.PI*2); ctx.fill();
    // Фасад — яркий плоский цвет
    ctx.fillStyle=pal.wall||'#EF5350';
    ctx.fillRect(sx-bw*0.5,sy-bh*0.82,bw,bh*0.88);
    // Боковая грань (3D)
    ctx.fillStyle=pal.side||'#C62828';
    ctx.fillRect(sx+bw*0.48,sy-bh*0.82,bw*0.06,bh*0.88);
    // Плоская крыша
    ctx.fillStyle=pal.roof||'#B71C1C';
    ctx.fillRect(sx-bw*0.52,sy-bh*0.86,bw*1.06,bh*0.06);
    // Карниз
    ctx.fillStyle='rgba(0,0,0,0.12)';
    ctx.fillRect(sx-bw*0.5,sy-bh*0.84,bw,bh*0.02);
    // Окна 2×3 — яркие, с рамками
    var winW=bw*0.1, winH=bh*0.09, gapX=bw*0.16, gapY=bh*0.13;
    var startX=sx-bw*0.24, startY=sy-bh*0.7;
    for(var row=0;row<3;row++){
      for(var col=0;col<2;col++){
        var wx=startX+col*gapX, wy=startY+row*gapY;
        var lit=((seg.index+row*2+col)%5<2);
        // Белая рамка
        ctx.fillStyle='#FFF';
        ctx.fillRect(wx-1.5,wy-1.5,winW+3,winH+3);
        // Стекло
        ctx.fillStyle=lit?(pal.window||'#FFEB3B'):(pal.darkWindow||'#1A237E');
        ctx.fillRect(wx,wy,winW,winH);
        // Блик
        if(lit){
          ctx.fillStyle='rgba(255,255,255,0.5)';
          ctx.fillRect(wx+winW*0.08,wy+winH*0.08,winW*0.35,winH*0.3);
        }
      }
    }
    // Дверь
    ctx.fillStyle='#5D4037';
    ctx.fillRect(sx-bw*0.07,sy-bh*0.2,bw*0.14,bh*0.2);
    // Ручка
    ctx.fillStyle='#FFD54F';
    ctx.beginPath(); ctx.arc(sx+bw*0.02,sy-bh*0.1,bw*0.012,0,Math.PI*2); ctx.fill();
    // Фонарь (как на референсе)
    ctx.fillStyle='#90A4AE';
    ctx.fillRect(sx+bw*0.55,sy-bh*0.55,bw*0.04,bh*0.55);
    ctx.fillStyle='#CFD8DC';
    ctx.beginPath(); ctx.ellipse(sx+bw*0.57,sy-bh*0.55,bw*0.06,bh*0.04,0,0,Math.PI*2); ctx.fill();

  }else if(sc.type==='mountain'){
    // === МУЛЬТЯШНАЯ ГОРА ===
    // Дальняя скала
    ctx.fillStyle=pal.shadow||'#455A64';
    ctx.beginPath();
    ctx.moveTo(sx-w*0.85,sy);
    ctx.lineTo(sx-w*0.25,sy-h*0.5);
    ctx.lineTo(sx+w*0.15,sy-h*0.35);
    ctx.lineTo(sx+w*0.65,sy);
    ctx.fill();
    // Основная скала
    ctx.fillStyle=pal.rock||'#78909C';
    ctx.beginPath();
    ctx.moveTo(sx-w*0.7,sy);
    ctx.lineTo(sx-w*0.05,sy-h);
    ctx.lineTo(sx+w*0.35,sy-h*0.58);
    ctx.lineTo(sx+w*0.55,sy);
    ctx.fill();
    // Светлый склон
    ctx.fillStyle=pal.light||'#B0BEC5';
    ctx.beginPath();
    ctx.moveTo(sx-w*0.05,sy-h);
    ctx.lineTo(sx+w*0.12,sy-h*0.75);
    ctx.lineTo(sx+w*0.35,sy-h*0.58);
    ctx.lineTo(sx+w*0.05,sy-h*0.48);
    ctx.fill();
    // Снежная шапка
    ctx.fillStyle=pal.snow||'#ECEFF1';
    ctx.beginPath();
    ctx.moveTo(sx-w*0.22,sy-h*0.65);
    ctx.lineTo(sx-w*0.05,sy-h);
    ctx.lineTo(sx+w*0.08,sy-h*0.82);
    ctx.lineTo(sx+w*0.15,sy-h*0.62);
    ctx.fill();
    // Тень
    ctx.fillStyle='rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(sx,sy+h*0.015,w*0.45,h*0.03,0,0,Math.PI*2); ctx.fill();
    // Ели у подножия
    ctx.fillStyle=pal.tree||'#33691E';
    for(var ti=0;ti<4;ti++){
      var tx=sx-w*0.45+ti*w*0.3;
      ctx.beginPath(); ctx.moveTo(tx,sy); ctx.lineTo(tx-w*0.05,sy-h*0.1); ctx.lineTo(tx+w*0.05,sy-h*0.1); ctx.fill();
    }
  }
}

function renderLandscape(){
  var track=TRACKS[game.trackIndex||0];
  var hy=H*0.48;
  var ht=track?track.horizonType:'forest';

  // === СОЛНЦЕ ===
  var sunX=W*0.75, sunY=H*0.12;
  ctx.fillStyle=track?track.sunGlow:'rgba(255,235,59,0.3)';
  ctx.beginPath(); ctx.arc(sunX,sunY,50,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=track?track.sunColor:'#FFEB3B';
  ctx.beginPath(); ctx.arc(sunX,sunY,28,0,Math.PI*2); ctx.fill();
  // Лучи
  ctx.strokeStyle='rgba(255,235,59,0.15)'; ctx.lineWidth=2;
  for(var r=0;r<8;r++){
    var ang=r*Math.PI/4;
    ctx.beginPath(); ctx.moveTo(sunX+Math.cos(ang)*35,sunY+Math.sin(ang)*35);
    ctx.lineTo(sunX+Math.cos(ang)*55,sunY+Math.sin(ang)*55); ctx.stroke();
  }

  // === ОБЛАКА ===
  var cloudOffset=(game.distance*0.003)%W;
  var clouds=[{x:0.15,y:0.08,w:80,h:25},{x:0.35,y:0.12,w:60,h:20},{x:0.55,y:0.06,w:90,h:30},{x:0.78,y:0.14,w:50,h:18},{x:0.92,y:0.09,w:70,h:22}];
  clouds.forEach(function(c){
    var cx=((c.x*W)-cloudOffset+W)%W;
    ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.ellipse(cx,c.y*H,c.w,c.h,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx+c.w*0.4,c.y*H-c.h*0.3,c.w*0.6,c.h*0.7,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx-c.w*0.3,c.y*H+c.h*0.1,c.w*0.5,c.h*0.6,0,0,Math.PI*2); ctx.fill();
  });

  if(ht==='city'){
    // === ГОРОДСКОЙ СИЛУЭТ ===
    // Дальние небоскрёбы (приглушённые)
    ctx.fillStyle='#90A4AE';
    var farB=[40,70,55,85,45,60,75,50,65,80,55,70];
    var bx=-30;
    for(var i=0;i<farB.length;i++){
      var bw=farB[i], bh=20+Math.sin(i*1.3)*18+Math.cos(i*2.1)*12;
      ctx.fillRect(bx,hy-bh,bw,bh);
      bx+=bw-8; if(bx>W+50) break;
    }
    // Ближние здания
    ctx.fillStyle='#78909C';
    var nearB=[55,80,45,95,60,70,85,50,75,65,90,55];
    bx=-20;
    for(var i=0;i<nearB.length;i++){
      var bw=nearB[i], bh=35+Math.sin(i*1.7)*28+Math.cos(i*2.3)*15;
      ctx.fillRect(bx,hy-bh,bw,bh);
      // Окна
      ctx.fillStyle='rgba(255,248,225,0.25)';
      for(var wy=hy-bh+6;wy<hy-4;wy+=10){
        for(var wx=bx+5;wx<bx+bw-5;wx+=12){
          if((i*7+wy+wx)%4===0) ctx.fillRect(wx,wy,5,5);
        }
      }
      ctx.fillStyle='#78909C';
      bx+=bw-10; if(bx>W+50) break;
    }
    // Тёмная полоса у основания
    ctx.fillStyle='#546E7A'; ctx.fillRect(0,hy-3,W,6);
  }else if(ht==='mountain'){
    // === ГОРНЫЙ ХРЕБЕТ ===
    // Дальние горы (светлее)
    ctx.fillStyle='#B0BEC5';
    ctx.beginPath(); ctx.moveTo(0,hy);
    for(var i=0;i<=W;i+=25){
      var mh=40+Math.sin(i*0.012)*50+Math.cos(i*0.007)*35;
      ctx.lineTo(i,hy-mh);
    }
    ctx.lineTo(W,hy); ctx.fill();
    // Средние горы
    ctx.fillStyle='#90A4AE';
    ctx.beginPath(); ctx.moveTo(-20,hy);
    for(var i=-20;i<=W+20;i+=30){
      var mh=55+Math.sin(i*0.015+1)*60+Math.cos(i*0.009+0.5)*40;
      ctx.lineTo(i,hy-mh);
    }
    ctx.lineTo(W+20,hy); ctx.fill();
    // Ближние горы (тёмнее)
    ctx.fillStyle='#78909C';
    ctx.beginPath(); ctx.moveTo(-30,hy);
    for(var i=-30;i<=W+30;i+=35){
      var mh=45+Math.sin(i*0.018+2)*45+Math.cos(i*0.011+1.2)*30;
      ctx.lineTo(i,hy-mh);
    }
    ctx.lineTo(W+30,hy); ctx.fill();
    // Снежные шапки на ближних
    ctx.fillStyle='#ECEFF1';
    for(var i=-30;i<=W+30;i+=70){
      var mh=45+Math.sin(i*0.018+2)*45+Math.cos(i*0.011+1.2)*30;
      if(mh>55){
        ctx.beginPath();
        ctx.moveTo(i-20,hy-mh+18);
        ctx.lineTo(i,hy-mh);
        ctx.lineTo(i+20,hy-mh+18);
        ctx.fill();
      }
    }
  }else{
    // === ЛЕСНЫЕ ХОЛМЫ ===
    // Дальние холмы
    ctx.fillStyle='#81C784';
    ctx.beginPath(); ctx.moveTo(0,hy);
    for(var i=0;i<=W;i+=20){
      var hh=15+Math.sin(i*0.02)*12+Math.cos(i*0.013)*8;
      ctx.lineTo(i,hy-hh);
    }
    ctx.lineTo(W,hy); ctx.fill();
    // Средние холмы
    ctx.fillStyle='#66BB6A';
    ctx.beginPath(); ctx.moveTo(-10,hy);
    for(var i=-10;i<=W+10;i+=25){
      var hh=22+Math.sin(i*0.025+1)*15+Math.cos(i*0.018+0.7)*10;
      ctx.lineTo(i,hy-hh);
    }
    ctx.lineTo(W+10,hy); ctx.fill();
    // Лес на холмах (силуэт)
    ctx.fillStyle='#2E7D32';
    for(var i=-30;i<W+30;i+=45){
      var th=18+Math.sin(i*0.08)*8;
      ctx.beginPath(); ctx.moveTo(i,hy); ctx.lineTo(i+22,hy-th); ctx.lineTo(i+45,hy); ctx.fill();
      ctx.fillStyle='#1B5E20';
      ctx.beginPath(); ctx.moveTo(i+10,hy); ctx.lineTo(i+22,hy-th*0.7); ctx.lineTo(i+35,hy); ctx.fill();
      ctx.fillStyle='#2E7D32';
    }
  }

  // === ПЕРЕДНИЙ ПЛАН: кусты и цветы у обочины ===
  var bushOffset=(game.distance*0.5)%60;
  for(var side=-1;side<=1;side+=2){
    for(var i=-60;i<W+60;i+=60){
      var bx=i-bushOffset;
      var by=hy+5;
      // Куст
      ctx.fillStyle=track?track.grassDark:'#43A047';
      ctx.beginPath(); ctx.ellipse(bx+side*30,by,18,10,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=track?track.grassColor:'#66BB6A';
      ctx.beginPath(); ctx.ellipse(bx+side*28,by-3,14,8,0,0,Math.PI*2); ctx.fill();
      // Цветы
      if((i+side*100)%180===0){
        ctx.fillStyle='#FFEB3B';
        ctx.beginPath(); ctx.arc(bx+side*32,by-5,4,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#FFF';
        ctx.beginPath(); ctx.arc(bx+side*32,by-5,2,0,Math.PI*2); ctx.fill();
      }else if((i+side*100)%180===90){
        ctx.fillStyle='#E91E63';
        ctx.beginPath(); ctx.arc(bx+side*32,by-5,4,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#FFF';
        ctx.beginPath(); ctx.arc(bx+side*32,by-5,2,0,Math.PI*2); ctx.fill();
      }
    }
  }
}

function checkCollisions(){
  if(game.shieldActive){ game.shieldTime-=1/60; if(game.shieldTime<=0) game.shieldActive=false; }
  var playerSeg=findSegment(game.distance+CAMERA_DEPTH*1000);
  if(playerSeg.index===lastCrashSeg) return;
  for(var i=0;i<playerSeg.sprites.length;i++){
    var sp=playerSeg.sprites[i];
    if(game.playerX>sp.offset-0.3 && game.playerX<sp.offset+0.3){
      if(game.speed>MAX_SPEED*0.3){
        if(game.shieldActive){ showToast('Щит защитил!'); }
        else{ handleCrash(); lastCrashSeg=playerSeg.index; game.speed=MAX_SPEED*0.3; }
        break;
      }
    }
  }
}

// === НОВАЯ ЛОГИКА: авария НЕ меняет класс сразу ===
function handleCrash(){
  game.crashes++; game.totalCrashes++;
  var elC=document.getElementById('hud-crashes');
  if(elC) elC.textContent=game.crashes;
  var overlay=document.getElementById('crash-overlay');
  if(overlay){ overlay.classList.add('active'); setTimeout(function(){ overlay.classList.remove('active'); },800); }
  playSound('crash'); vibrate([50,100,50]);
  // Предложить отменить аварию за рекламу (через 600мс, чтобы эффект аварии прошёл)
  setTimeout(function(){ showCrashUndo(); },600);
}

function update(dt){
  if(!game.isRunning||game.isPaused) return;
  var speedPercent=game.speed/MAX_SPEED;
  var dx=dt*2*speedPercent;
  if(keyLeft){ game.playerX-=dx; }
  else if(keyRight){ game.playerX+=dx; }
  if(Math.abs(game.speed - (window._lastSpeed||-1)) > 50){
    window._lastSpeed = game.speed; renderSpeedometer();
  }
  if(keyFaster) game.speed+=ACCEL*dt;
  else if(keySlower) game.speed+=BREAKING*dt;
  else game.speed+=DECEL*dt;
  if((game.playerX<-1||game.playerX>1)&&game.speed>OFF_ROAD_LIMIT) game.speed+=OFF_ROAD_DECEL*dt;
  game.playerX=limit(game.playerX,-2,2);
  game.speed=limit(game.speed,0,MAX_SPEED);
  game.distance+=(game.speed*dt);
  var track=TRACKS[game.trackIndex||0];
  var progress=game.distance/game.trackLength;
  for(var i=track.landscapes.length-1;i>=0;i--){
    if(progress>=track.landscapes[i].start){ game.landscape=track.landscapes[i].type; break; }
  }
  var elDist=document.getElementById('hud-dist');
  if(elDist) elDist.textContent=Math.max(0,Math.round((game.trackLength-game.distance)/100))+'м';
  if(game.distance>=game.trackLength) endLap();
}
function renderSpeedometer(){
  if(game.activeDashboard==='bmw') renderSpeedometerBMW();
  else if(game.activeDashboard==='haval') renderSpeedometerHaval();
  else if(game.activeDashboard==='toyota') renderSpeedometerToyota();
  else renderSpeedometerNiva();
}
function renderSpeedometerNiva(){
  var c=document.getElementById('speedo-canvas');
  var wrap=document.getElementById('dashboard-wrap');
  if(!c||!wrap) return;
  var Ws=c.width=wrap.offsetWidth;
  var Hs=c.height=wrap.offsetHeight;
  var s=c.getContext('2d');
  s.clearRect(0,0,Ws,Hs);
  var cx=Ws*0.50, cy=Hs*0.32, r=Math.min(Ws,Hs)*0.16;
  var speedKmh=Math.round((game.speed/MAX_SPEED)*200);
  s.beginPath(); s.arc(cx,cy,r,Math.PI*0.75,Math.PI*2.25); s.strokeStyle='rgba(0,0,0,0.6)'; s.lineWidth=r*0.15; s.stroke();
  s.beginPath(); s.arc(cx,cy,r*0.92,Math.PI*0.75,Math.PI*2.25); s.strokeStyle='#1a1a2e'; s.lineWidth=r*0.08; s.stroke();
  for(var i=0;i<=20;i++){
    var ang=Math.PI*0.75+(Math.PI*1.5)*(i/20);
    var len=(i%5===0)?r*0.18:r*0.1;
    var x1=cx+Math.cos(ang)*(r*0.78), y1=cy+Math.sin(ang)*(r*0.78);
    var x2=cx+Math.cos(ang)*(r*0.78-len), y2=cy+Math.sin(ang)*(r*0.78-len);
    s.beginPath(); s.moveTo(x1,y1); s.lineTo(x2,y2); s.strokeStyle=(i%5===0)?'#ff3333':'#888'; s.lineWidth=(i%5===0)?2:1; s.stroke();
  }
  s.fillStyle='#fff'; s.font='bold '+(r*0.18)+'px Arial'; s.textAlign='center'; s.textBaseline='middle';
  for(var i=0;i<=4;i++){
    var ang=Math.PI*0.75+(Math.PI*1.5)*(i/4);
    var val=i*50;
    var tx=cx+Math.cos(ang)*(r*0.55), ty=cy+Math.sin(ang)*(r*0.55);
    s.fillText(val,tx,ty);
  }
  var needleAng=Math.PI*0.75+(Math.PI*1.5)*Math.min(1,game.speed/MAX_SPEED);
  var nx=cx+Math.cos(needleAng)*(r*0.65);
  var ny=cy+Math.sin(needleAng)*(r*0.65);
  s.beginPath(); s.moveTo(cx,cy); s.lineTo(nx,ny); s.strokeStyle='#ff3333'; s.lineWidth=3; s.lineCap='round'; s.stroke();
  s.beginPath(); s.arc(cx,cy,r*0.08,0,Math.PI*2); s.fillStyle='#ff3333'; s.fill();
  s.beginPath(); s.arc(cx,cy,r*0.04,0,Math.PI*2); s.fillStyle='#fff'; s.fill();
  s.fillStyle='#00f0ff'; s.font='bold '+(r*0.22)+'px Arial';
  s.fillText(speedKmh,cx,cy+r*0.35);
  s.fillStyle='#888'; s.font=(r*0.1)+'px Arial';
  s.fillText('км/ч',cx,cy+r*0.52);
}
function renderSpeedometerBMW(){
  var c=document.getElementById('speedo-canvas-bmw');
  var wrap=document.getElementById('dashboard-wrap-bmw');
  if(!c||!wrap) return;
  var Ws=c.width=wrap.offsetWidth;
  var Hs=c.height=wrap.offsetHeight;
  var s=c.getContext('2d');
  s.clearRect(0,0,Ws,Hs);
  var speedKmh=Math.round((game.speed/MAX_SPEED)*240);
  // Цифровой дисплей BMW — большая цифра по центру приборки
  var cx=Ws*0.50, cy=Hs*0.28;
  // Фон циферблата
  s.beginPath(); s.arc(cx,cy,Math.min(Ws,Hs)*0.13,0,Math.PI*2); s.fillStyle='rgba(0,0,0,0.7)'; s.fill();
  s.beginPath(); s.arc(cx,cy,Math.min(Ws,Hs)*0.11,0,Math.PI*2); s.strokeStyle='#333'; s.lineWidth=2; s.stroke();
  // Большая цифра скорости
  s.fillStyle='#00f0ff'; s.font='bold '+(Math.min(Ws,Hs)*0.12)+'px Arial'; s.textAlign='center'; s.textBaseline='middle';
  s.fillText(speedKmh,cx,cy);
  // Подпись
  s.fillStyle='#888'; s.font=(Math.min(Ws,Hs)*0.05)+'px Arial';
  s.fillText('км/ч',cx,cy+Math.min(Ws,Hs)*0.10);
  // Полоска тахометра сверху
  var barW=Ws*0.25, barH=Hs*0.025;
  s.fillStyle='rgba(255,255,255,0.1)'; s.fillRect(cx-barW/2,cy-Math.min(Ws,Hs)*0.18,barW,barH);
  var progress=Math.min(1,game.speed/MAX_SPEED);
  s.fillStyle='#00f0ff'; s.fillRect(cx-barW/2,cy-Math.min(Ws,Hs)*0.18,barW*progress,barH);
}
function renderSpeedometerHaval(){
  var c=document.getElementById('speedo-canvas-haval');
  var wrap=document.getElementById('dashboard-wrap-haval');
  if(!c||!wrap) return;
  var Ws=c.width=wrap.offsetWidth;
  var Hs=c.height=wrap.offsetHeight;
  var s=c.getContext('2d');
  s.clearRect(0,0,Ws,Hs);
  var speedKmh=Math.round((game.speed/MAX_SPEED)*220);
  // Haval: спидометр правее центра (как в реальной Jolion)
  var cx=Ws*0.62, cy=Hs*0.30;
  var r=Math.min(Ws,Hs)*0.14;
  // Фон циферблата
  s.beginPath(); s.arc(cx,cy,r,0,Math.PI*2); s.fillStyle='rgba(0,0,0,0.75)'; s.fill();
  s.beginPath(); s.arc(cx,cy,r*0.90,0,Math.PI*2); s.strokeStyle='#444'; s.lineWidth=2; s.stroke();
  // Шкала
  for(var i=0;i<=22;i++){
    var ang=(Math.PI*0.8)+(Math.PI*1.4)*(i/22);
    var len=(i%2===0)?r*0.12:r*0.06;
    var x1=cx+Math.cos(ang)*(r*0.78), y1=cy+Math.sin(ang)*(r*0.78);
    var x2=cx+Math.cos(ang)*(r*0.78-len), y2=cy+Math.sin(ang)*(r*0.78-len);
    s.beginPath(); s.moveTo(x1,y1); s.lineTo(x2,y2); s.strokeStyle=(i%2===0)?'#ff3333':'#666'; s.lineWidth=(i%2===0)?2:1; s.stroke();
  }
  // Цифры
  s.fillStyle='#fff'; s.font='bold '+(r*0.16)+'px Arial'; s.textAlign='center'; s.textBaseline='middle';
  for(var i=0;i<=4;i++){
    var ang=(Math.PI*0.8)+(Math.PI*1.4)*(i/4);
    var val=i*60;
    var tx=cx+Math.cos(ang)*(r*0.55), ty=cy+Math.sin(ang)*(r*0.55);
    s.fillText(val,tx,ty);
  }
  // Стрелка
  var needleAng=(Math.PI*0.8)+(Math.PI*1.4)*Math.min(1,game.speed/MAX_SPEED);
  var nx=cx+Math.cos(needleAng)*(r*0.65);
  var ny=cy+Math.sin(needleAng)*(r*0.65);
  s.beginPath(); s.moveTo(cx,cy); s.lineTo(nx,ny); s.strokeStyle='#ff3333'; s.lineWidth=3; s.lineCap='round'; s.stroke();
  s.beginPath(); s.arc(cx,cy,r*0.07,0,Math.PI*2); s.fillStyle='#ff3333'; s.fill();
  // Цифровой дисплей
  s.fillStyle='#00f0ff'; s.font='bold '+(r*0.22)+'px Arial';
  s.fillText(speedKmh,cx,cy+r*0.38);
  s.fillStyle='#888'; s.font=(r*0.09)+'px Arial';
  s.fillText('км/ч',cx,cy+r*0.55);
}

function renderSpeedometerToyota(){
  var c=document.getElementById('speedo-canvas-toyota');
  var wrap=document.getElementById('dashboard-wrap-toyota');
  if(!c||!wrap) return;
  var Ws=c.width=wrap.offsetWidth;
  var Hs=c.height=wrap.offsetHeight;
  var s=c.getContext('2d');
  s.clearRect(0,0,Ws,Hs);
  var speedKmh=Math.round((game.speed/MAX_SPEED)*220);
  // Toyota: классический круглый спидометр по центру
  var cx=Ws*0.50, cy=Hs*0.28;
  var r=Math.min(Ws,Hs)*0.13;
  // Фон
  s.beginPath(); s.arc(cx,cy,r,Math.PI*0.75,Math.PI*2.25); s.strokeStyle='rgba(0,0,0,0.6)'; s.lineWidth=r*0.15; s.stroke();
  s.beginPath(); s.arc(cx,cy,r*0.92,Math.PI*0.75,Math.PI*2.25); s.strokeStyle='#1a1a2e'; s.lineWidth=r*0.08; s.stroke();
  // Шкала
  for(var i=0;i<=20;i++){
    var ang=Math.PI*0.75+(Math.PI*1.5)*(i/20);
    var len=(i%5===0)?r*0.18:r*0.1;
    var x1=cx+Math.cos(ang)*(r*0.78), y1=cy+Math.sin(ang)*(r*0.78);
    var x2=cx+Math.cos(ang)*(r*0.78-len), y2=cy+Math.sin(ang)*(r*0.78-len);
    s.beginPath(); s.moveTo(x1,y1); s.lineTo(x2,y2); s.strokeStyle=(i%5===0)?'#ff3333':'#888'; s.lineWidth=(i%5===0)?2:1; s.stroke();
  }
  // Цифры
  s.fillStyle='#fff'; s.font='bold '+(r*0.18)+'px Arial'; s.textAlign='center'; s.textBaseline='middle';
  for(var i=0;i<=4;i++){
    var ang=Math.PI*0.75+(Math.PI*1.5)*(i/4);
    var val=i*60;
    var tx=cx+Math.cos(ang)*(r*0.55), ty=cy+Math.sin(ang)*(r*0.55);
    s.fillText(val,tx,ty);
  }
  // Стрелка
  var needleAng=Math.PI*0.75+(Math.PI*1.5)*Math.min(1,game.speed/MAX_SPEED);
  var nx=cx+Math.cos(needleAng)*(r*0.65);
  var ny=cy+Math.sin(needleAng)*(r*0.65);
  s.beginPath(); s.moveTo(cx,cy); s.lineTo(nx,ny); s.strokeStyle='#ff3333'; s.lineWidth=3; s.lineCap='round'; s.stroke();
  s.beginPath(); s.arc(cx,cy,r*0.08,0,Math.PI*2); s.fillStyle='#ff3333'; s.fill();
  s.beginPath(); s.arc(cx,cy,r*0.04,0,Math.PI*2); s.fillStyle='#fff'; s.fill();
  // Цифровой дисплей
  s.fillStyle='#00f0ff'; s.font='bold '+(r*0.22)+'px Arial';
  s.fillText(speedKmh,cx,cy+r*0.35);
  s.fillStyle='#888'; s.font=(r*0.1)+'px Arial';
  s.fillText('км/ч',cx,cy+r*0.52);
}

// === gameLoop с защитой от падения ===
function gameLoop(timestamp){
  try{
    if(!lastTime) lastTime=timestamp;
    var dt=Math.min(1,(timestamp-lastTime)/1000);
    lastTime=timestamp; update(dt); render();
    if(game.isRunning) requestAnimationFrame(gameLoop);
  }catch(e){
    console.error('Game loop error:',e);
    game.isRunning=false;
    showToast('Ошибка игры. Перезагрузите страницу.');
  }
}

var BASE_RATE=3000;
function calculatePrice(cityCoef,powerCoef,kbmClass){
  var kbm=KBM_TABLE[kbmClass];
  return kbm?Math.round(BASE_RATE*cityCoef*powerCoef*kbm):0;
}
function formatPrice(price){ return price.toLocaleString('ru-RU')+' ₽'; }

function toggleSound(){
  game.soundEnabled=!game.soundEnabled;
  var btn=document.getElementById('btn-sound');
  if(btn) btn.textContent=game.soundEnabled?'🔊':'🔇';
  try{ localStorage.setItem('umny_voditel_sound', game.soundEnabled?'1':'0'); }catch(e){}
}
function loadSoundSetting(){
  try{ var v=localStorage.getItem('umny_voditel_sound'); if(v!==null) game.soundEnabled=(v==='1'); }catch(e){}
}

function showCrashUndo(){
  if(crashUndoOverlay) return; // уже показан
  if(!ysdk||!isYaGames){ showToast('Отмена аварии: только в Яндекс.Играх'); return; }
  crashUndoOverlay=document.createElement('div');
  crashUndoOverlay.id='crash-undo-overlay';
  crashUndoOverlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.3s ease;';
  var box=document.createElement('div');
  box.style.cssText='background:#12121f;border:2px solid #ff3333;border-radius:24px;padding:28px 24px;text-align:center;max-width:320px;width:100%;';
  box.innerHTML='<div style="font-size:3rem;margin-bottom:8px;">💥</div>'+
    '<h3 style="color:#ff3333;margin-bottom:6px;font-size:1.2rem;">Авария!</h3>'+
    '<p style="color:#8888a0;font-size:0.85rem;margin-bottom:18px;">Класс не пострадал до конца заезда, но авария учтена.</p>'+
    '<button id="btn-undo-ad" class="btn-cyber" style="margin-bottom:10px;background:linear-gradient(135deg,#ffaa00,#ff6600);color:#000;">📺 Отменить аварию за рекламу</button>'+
    '<button id="btn-undo-skip" class="btn-cyber btn-sec" style="margin-top:0;font-size:0.85rem;padding:12px;">Продолжить</button>';
  crashUndoOverlay.appendChild(box);
  document.body.appendChild(crashUndoOverlay);
  document.getElementById('btn-undo-ad').addEventListener('click',onUndoAd);
  document.getElementById('btn-undo-skip').addEventListener('click',hideCrashUndo);
}
function hideCrashUndo(){
  if(!crashUndoOverlay) return;
  crashUndoOverlay.style.animation='fadeOut 0.3s ease forwards';
  setTimeout(function(){ if(crashUndoOverlay){ crashUndoOverlay.remove(); crashUndoOverlay=null; } },300);
}
function onUndoAd(){
  var btn=document.getElementById('btn-undo-ad');
  if(btn) btn.textContent='Загрузка...';
  showRewardedAd(function(rewarded){
    if(rewarded){
      game.crashes=Math.max(0,game.crashes-1);
      game.totalCrashes=Math.max(0,game.totalCrashes-1);
      var elC=document.getElementById('hud-crashes');
      if(elC) elC.textContent=game.crashes;
      showToast('Авария отменена! Класс не пострадает.');
    }else{
      showToast('Реклама не просмотрена');
    }
    hideCrashUndo();
  });
}

function getProducts(){
  if(!payments||!paymentsReady) return Promise.resolve([]);
  return payments.getCatalog().catch(function(err){ console.warn('getCatalog error:',err); return []; });
}
function buyProduct(productId, onSuccess){
  if(!payments||!paymentsReady){
    showToast('Покупки временно недоступны');
    return;
  }
  showToast('Обработка покупки...');
  payments.purchase({id:productId}).then(function(purchase){
    console.log('Purchase success:',purchase.productID);
    showToast('✅ Покупка успешна!');
    if(onSuccess) onSuccess(purchase);
    saveCloudProgress();
  }).catch(function(err){
    console.warn('Purchase error:',err);
    var msg='❌ Покупка отменена';
    if(err&&err.code==='CLIENT_HAS_NO_PAYMENT_METHOD') msg='❌ Нет способа оплаты';
    else if(err&&err.code==='PURCHASE_CANCELLED') msg='❌ Покупка отменена';
    showToast(msg);
  });
}
function consumePurchase(purchase){
  if(!payments) return Promise.resolve();
  return payments.consumePurchase(purchase.purchaseToken).catch(function(e){ console.warn('Consume error:',e); });
}


// === ЛАЙТБОКС ДЛЯ ФОТО МАШИН ===
var lightboxImages = [];
var lightboxIndex = 0;

function openLightbox(images, index){
  lightboxImages = images;
  lightboxIndex = index;
  var overlay = document.getElementById('lightbox');
  var img = document.getElementById('lightbox-img');
  var counter = document.getElementById('lightbox-counter');
  if(!overlay || !img) return;
  img.src = images[index];
  counter.textContent = (index + 1) + ' / ' + images.length;
  overlay.classList.add('active');
}
function closeLightbox(){
  var overlay = document.getElementById('lightbox');
  if(overlay) overlay.classList.remove('active');
  lightboxImages = [];
  lightboxIndex = 0;
}
function lightboxPrev(){
  if(lightboxImages.length === 0) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
  document.getElementById('lightbox-img').src = lightboxImages[lightboxIndex];
  document.getElementById('lightbox-counter').textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length;
}
function lightboxNext(){
  if(lightboxImages.length === 0) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
  document.getElementById('lightbox-img').src = lightboxImages[lightboxIndex];
  document.getElementById('lightbox-counter').textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length;
}
// Закрытие по клику на фон
var lightboxOverlay = document.getElementById('lightbox');
if(lightboxOverlay){
  lightboxOverlay.addEventListener('click', function(e){
    if(e.target === lightboxOverlay) closeLightbox();
  });
}
// Клавиши
var lightboxKeys = function(e){
  var overlay = document.getElementById('lightbox');
  if(!overlay || !overlay.classList.contains('active')) return;
  if(e.key === 'Escape') closeLightbox();
  else if(e.key === 'ArrowLeft') lightboxPrev();
  else if(e.key === 'ArrowRight') lightboxNext();
};

function showScreen(name){
  var screens=['screen-loading','screen-form','screen-game','screen-pause','screen-result','screen-shop','screen-tutorial'];
  screens.forEach(function(s){ var el=document.getElementById(s); if(el) el.classList.remove('active'); });
  var t=document.getElementById('screen-'+name);
  if(t) t.classList.add('active');
  if(name==='menu'){
    var cityEl=document.getElementById('city');
    var powerEl=document.getElementById('power');
    var trackEl=document.getElementById('track');
    if(cityEl) cityEl.value=game.cityCoef||1.64;
    if(powerEl) powerEl.value=game.powerCoef||1.1;
    if(trackEl) trackEl.value=game.trackIndex||0;
    updateStats();
    document.getElementById('hud').style.display='none';
    document.getElementById('dashboard-wrap').style.display='none';
    document.getElementById('dashboard-wrap-bmw').style.display='none';
    document.getElementById('dashboard-wrap-haval').style.display='none';
    document.getElementById('dashboard-wrap-toyota').style.display='none';
  }
}

var isStarting=false;
function shouldShowTutorial(){
  if(game.gamesPlayed>0) return false;
  try{ if(localStorage.getItem('umny_voditel_tutorial_shown')==='1') return false; }catch(e){}
  return true;
}
function markTutorialShown(){
  try{ localStorage.setItem('umny_voditel_tutorial_shown','1'); }catch(e){}
}
function startGame(){
  if(isStarting) return; isStarting=true;
  game.cityCoef=parseFloat(document.getElementById('city').value);
  game.powerCoef=parseFloat(document.getElementById('power').value);
  game.trackIndex=parseInt(document.getElementById('track').value)||0;
  if(game.lap===1){
    game.currentClass=3; game.currentKBM=1.0;
    game.seasonBasePrice=calculatePrice(game.cityCoef,game.powerCoef,3);
  }
  game.crashes=0;  // каждый заезд — новый год, аварии считаем с нуля
  game.distance=0; game.speed=0; game.playerX=0;
  game.isRunning=true; game.isPaused=false;
  game.startPrice=calculatePrice(game.cityCoef,game.powerCoef,game.currentClass);
  game.landscape='forest'; game.shieldActive=game.hasShield; game.shieldTime=game.hasShield?30:0; game.hasShield=false;
  // Панель приборов
  var nivaWrap=document.getElementById('dashboard-wrap');
  var bmwWrap=document.getElementById('dashboard-wrap-bmw');
  var havalWrap=document.getElementById('dashboard-wrap-haval');
  var toyotaWrap=document.getElementById('dashboard-wrap-toyota');
  if(nivaWrap) nivaWrap.style.display=(game.activeDashboard==='niva'?'block':'none');
  if(bmwWrap) bmwWrap.style.display=(game.activeDashboard==='bmw'?'block':'none');
  if(havalWrap) havalWrap.style.display=(game.activeDashboard==='haval'?'block':'none');
  if(toyotaWrap) toyotaWrap.style.display=(game.activeDashboard==='toyota'?'block':'none');
  lastCrashSeg=-1; lastTime=0;
  createRoad(game.trackIndex);
  for(var n=0;n<segments.length;n++){
    if(segments[n].originalSprites) segments[n].sprites=segments[n].originalSprites.slice();
  }
  document.getElementById('hud-price').textContent=formatPrice(game.startPrice);
  document.getElementById('hud-crashes').textContent=game.crashes;
  document.getElementById('hud-class').textContent=game.currentClass;
  document.getElementById('hud-lap').textContent=game.lap+'/'+game.maxLaps;
  document.getElementById('hud-dist').textContent=Math.round(game.trackLength/100)+'м';
  renderSpeedometer(); showScreen('game'); resizeCanvas();
  if(ysdk&&isYaGames&&ysdk.features&&ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start();
  requestAnimationFrame(gameLoop);
  setTimeout(function(){ isStarting=false; },500);
}

// === НОВАЯ ЛОГИКА: пересчёт класса по окончании заезда ===
function endLap(){
  game.isRunning=false;
  if(ysdk&&isYaGames&&ysdk.features&&ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.stop();

  var crashCount=Math.min(game.crashes,4);
  var oldClass=game.currentClass;
  var newClass=KBM_TRANSITION[oldClass][crashCount];
  game.currentClass=newClass;
  game.currentKBM=KBM_TABLE[newClass];

  var finalPrice=calculatePrice(game.cityCoef,game.powerCoef,game.currentClass);
  var rawEconomy=game.seasonBasePrice-finalPrice;
  var seasonScore=Math.max(0,rawEconomy);

  var improved=newClass>oldClass;
  var worsened=newClass<oldClass;

  var msg='';
  if(game.crashes===0){
    if(newClass===13){
      msg='⭐ Идеально! Максимальный класс 13. КБМ минимальный — 0,50!';
    }else{
      msg='⭐ Молодец, безаварийный год! Перешёл в класс '+newClass+'. Скидка растёт!';
    }
  }else{
    if(worsened){
      msg='💥 '+game.crashes+' аварий, класс за аварии снизился с '+oldClass+' до '+newClass+'. Полис подорожал.';
    }else if(improved){
      msg='✅ '+game.crashes+' аварий, но класс всё равно вырос с '+oldClass+' до '+newClass+'.';
    }else{
      msg='⚠️ '+game.crashes+' аварий, класс остался максимальным ('+newClass+').';
    }
  }

  var rank=game.crashes===0?'⭐ ЛЕГЕНДА':game.crashes===1?'🥇 МАСТЕР':game.crashes<=3?'🥈 ОПЫТНЫЙ':game.crashes<=5?'🥉 НОВИЧОК':'💥 НУЖНЫ КУРСЫ';

  document.getElementById('res-start').textContent=formatPrice(game.seasonBasePrice);
  document.getElementById('res-crashes').textContent=game.crashes;
  document.getElementById('res-class').textContent=game.currentClass+' (КБМ: '+game.currentKBM+')';
  document.getElementById('res-price').textContent=formatPrice(finalPrice);
  document.getElementById('res-rank').textContent=rank;
  document.getElementById('res-msg').textContent=msg;
  document.getElementById('res-best').textContent=formatPrice(game.bestScore);
  document.getElementById('res-total').textContent=game.gamesPlayed;
  document.getElementById('res-kbm').textContent=game.currentClass;

  var economyEl=document.getElementById('res-economy');
  if(!economyEl){
    var card=document.querySelector('#screen-result .result-card');
    if(card){
      var row=document.createElement('div');
      row.className='result-row hl';
      row.innerHTML='<span>💰 Экономия за сезон:</span><span id="res-economy">'+formatPrice(seasonScore)+'</span>';
      card.appendChild(row);
    }
  }else{
    economyEl.textContent=formatPrice(seasonScore);
    if(rawEconomy<0){
      economyEl.style.color='#ff3333';
    }else{
      economyEl.style.color='#00ff88';
    }
  }

  var btnNext=document.getElementById('btn-next');
  if(game.lap>=game.maxLaps){
    game.gamesPlayed++;
    if(seasonScore>game.bestScore){ game.bestScore=seasonScore; setLeaderboardScore(seasonScore); }
    saveCloudProgress();
    clearSessionProgress();
    if(btnNext) btnNext.textContent='🏁 Новый сезон';
  }else{
    saveSessionProgress();
    if(btnNext) btnNext.textContent='🚀 Следующий заезд ('+(game.lap+1)+'/10)';
  }

  showScreen('result');
  setTimeout(function(){ showFullscreenAd(); },1500);
}

function nextLap(){
  if(game.lap<game.maxLaps){ game.lap++; startGame(); }
  else{
    game.lap=1; game.currentClass=3; game.currentKBM=1.0; game.seasonBasePrice=0;
    clearSessionProgress();
    showScreen('form'); updateStats();
  }
}
function updateStats(){
  var best=document.getElementById('stat-best');
  var games=document.getElementById('stat-games');
  var kbm=document.getElementById('stat-kbm');
  if(best) best.textContent=game.bestScore>0?formatPrice(game.bestScore):'—';
  if(games) games.textContent=game.gamesPlayed;
  if(kbm) kbm.textContent=game.currentClass;
  var cityEl=document.getElementById('city');
  var powerEl=document.getElementById('power');
  var trackEl=document.getElementById('track');
  var city=cityEl?parseFloat(cityEl.value):1.64;
  var power=powerEl?parseFloat(powerEl.value):1.1;
  var trackIdx=trackEl?parseInt(trackEl.value)||0:0;
  if(isNaN(city)) city=1.64;
  if(isNaN(power)) power=1.1;
  var price=calculatePrice(city,power,game.currentClass);
  var preview=document.getElementById('preview-price');
  if(preview) preview.textContent=isNaN(price)?'—':formatPrice(price);
  // Инфо о треке
  var track=TRACKS[trackIdx];
  var trackInfo=document.getElementById('track-info');
  if(trackInfo) trackInfo.innerHTML='<span>🏁 '+track.name+'</span><span>'+track.difficulty+' · '+(Math.round((track.length+230)*SEGMENT_LENGTH/100))+'м</span>';
}

// === УПРАВЛЕНИЕ ===
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowLeft'){ e.preventDefault(); keyLeft=true; }
  else if(e.key==='ArrowRight'){ e.preventDefault(); keyRight=true; }
  else if(e.key==='ArrowUp'){ e.preventDefault(); keyFaster=true; }
  else if(e.key==='ArrowDown'){ e.preventDefault(); keySlower=true; }
  else if(e.key==='Escape'||e.key==='p'){
    if(game.isRunning){
      if(game.isPaused){ game.isPaused=false; showScreen('game'); lastTime=0; requestAnimationFrame(gameLoop); }
      else{ game.isPaused=true; showScreen('pause'); }
    }
  }
});
document.addEventListener('keyup',function(e){
  if(e.key==='ArrowLeft') keyLeft=false;
  else if(e.key==='ArrowRight') keyRight=false;
  else if(e.key==='ArrowUp') keyFaster=false;
  else if(e.key==='ArrowDown') keySlower=false;
});

var touchLeft=document.getElementById('touch-left');
var touchRight=document.getElementById('touch-right');
if(touchLeft){
  touchLeft.addEventListener('touchstart',function(e){ e.preventDefault(); keyLeft=true; });
  touchLeft.addEventListener('touchend',function(e){ e.preventDefault(); keyLeft=false; });
  touchLeft.addEventListener('touchcancel',function(e){ e.preventDefault(); keyLeft=false; });
}
if(touchRight){
  touchRight.addEventListener('touchstart',function(e){ e.preventDefault(); keyRight=true; });
  touchRight.addEventListener('touchend',function(e){ e.preventDefault(); keyRight=false; });
  touchRight.addEventListener('touchcancel',function(e){ e.preventDefault(); keyRight=false; });
}

var btnTutorialStart=document.getElementById('btn-tutorial-start');
var btnTutorialSkip=document.getElementById('btn-tutorial-skip');
if(btnTutorialStart) btnTutorialStart.addEventListener('click',function(){ playSound('click'); markTutorialShown(); startGame(); });
if(btnTutorialSkip) btnTutorialSkip.addEventListener('click',function(){ playSound('click'); markTutorialShown(); startGame(); });

// Обработчики клика на фото машин (лайтбокс)
document.querySelectorAll('.car-card').forEach(function(card){
  var imgs = card.querySelectorAll('.car-photo img');
  if(imgs.length === 0) return;
  var srcs = [];
  imgs.forEach(function(img){ srcs.push(img.src); });
  imgs.forEach(function(img, idx){
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', function(e){
      e.stopPropagation();
      openLightbox(srcs, idx);
    });
  });
});

// Обработчики покупок в магазине
document.querySelectorAll('.btn-buy').forEach(function(btn){
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    playSound('click');
    var pid=btn.getAttribute('data-product');
    if(!pid) return;
    var onSuccess=function(){
      if(pid==='shield_30sec'){ game.hasShield=true; showToast('Щит активирован на следующий заезд!'); }
      else if(pid==='undo_crash'){ showToast('Второй шанс куплен! Используется автоматически.'); }
      else if(pid.indexOf('car_')===0){ var carName=pid.replace('car_',''); if(game.ownedCars.indexOf(carName)===-1) game.ownedCars.push(carName); if(carName==='bmw'){ game.activeDashboard='bmw'; game.activeCar='bmw'; } else if(carName==='haval'){ game.activeDashboard='haval'; game.activeCar='haval'; } else if(carName==='sequoia'){ game.activeDashboard='toyota'; game.activeCar='sequoia'; } showToast('Тачка добавлена в гараж!'); }
      else if(pid==='vip_month'){ game.hasVIP=true; showToast('VIP активирован!'); }
    };
    buyProduct(pid,onSuccess);
  });
});

var btnGas=document.getElementById('btn-gas');
var btnBrake=document.getElementById('btn-brake');
function setGas(v){ keyFaster=v; }
function setBrake(v){ keySlower=v; }
if(btnGas){
  btnGas.addEventListener('touchstart',function(e){ e.preventDefault(); e.stopPropagation(); setGas(true); });
  btnGas.addEventListener('touchend',function(e){ e.preventDefault(); e.stopPropagation(); setGas(false); });
  btnGas.addEventListener('touchcancel',function(e){ e.preventDefault(); e.stopPropagation(); setGas(false); });
  btnGas.addEventListener('mousedown',function(e){ e.preventDefault(); setGas(true); });
  btnGas.addEventListener('mouseup',function(e){ e.preventDefault(); setGas(false); });
  btnGas.addEventListener('mouseleave',function(e){ e.preventDefault(); setGas(false); });
}
if(btnBrake){
  btnBrake.addEventListener('touchstart',function(e){ e.preventDefault(); e.stopPropagation(); setBrake(true); });
  btnBrake.addEventListener('touchend',function(e){ e.preventDefault(); e.stopPropagation(); setBrake(false); });
  btnBrake.addEventListener('touchcancel',function(e){ e.preventDefault(); e.stopPropagation(); setBrake(false); });
  btnBrake.addEventListener('mousedown',function(e){ e.preventDefault(); setBrake(true); });
  btnBrake.addEventListener('mouseup',function(e){ e.preventDefault(); setBrake(false); });
  btnBrake.addEventListener('mouseleave',function(e){ e.preventDefault(); setBrake(false); });
}

var cityEl=document.getElementById('city');
var powerEl=document.getElementById('power');
var btnStart=document.getElementById('btn-start');
var btnNext=document.getElementById('btn-next');
var btnMenu=document.getElementById('btn-menu');
var btnShop=document.getElementById('btn-shop');
var btnShopBack=document.getElementById('btn-shop-back');
var btnResume=document.getElementById('btn-resume');
var btnQuit=document.getElementById('btn-quit');
var btnLeaderboard=document.getElementById('btn-leaderboard');
var btnInvite=document.getElementById('btn-invite');
var btnDonate=document.getElementById('btn-donate');
var btnShare=document.getElementById('btn-share');

if(cityEl) cityEl.addEventListener('change',updateStats);
if(powerEl) powerEl.addEventListener('change',updateStats);
var trackEl=document.getElementById('track');
if(trackEl) trackEl.addEventListener('change',updateStats);
if(btnStart) btnStart.addEventListener('click',function(){ ensureAudio(); playSound('click'); if(shouldShowTutorial()){ showScreen('tutorial'); }else{ startGame(); } });
if(btnNext) btnNext.addEventListener('click',function(){ playSound('click'); nextLap(); });
if(btnMenu) btnMenu.addEventListener('click',function(){ playSound('click'); showScreen('form'); updateStats(); });
if(btnShop) btnShop.addEventListener('click',function(){ playSound('click'); showScreen('shop'); });
if(btnShopBack) btnShopBack.addEventListener('click',function(){ playSound('click'); showScreen('form'); });
if(btnResume) btnResume.addEventListener('click',function(){ playSound('click'); game.isPaused=false; showScreen('game'); lastTime=performance.now(); requestAnimationFrame(gameLoop); });
if(btnQuit) btnQuit.addEventListener('click',function(){ playSound('click'); game.isRunning=false; showScreen('form'); updateStats(); });

if(btnLeaderboard) btnLeaderboard.addEventListener('click',function(){ playSound('click'); showLeaderboard(); });
if(btnInvite) btnInvite.addEventListener('click',function(){
  playSound('click');
  if(ysdk&&isYaGames){ ysdk.shortcut.showPrompt().then(function(r){ if(r.outcome==='accepted') showToast('Ярлык добавлен'); }).catch(function(){ showToast('Поделитесь игрой!'); }); }
  else showToast('Поделитесь игрой с друзьями!');
});
if(btnDonate) btnDonate.addEventListener('click',function(){ playSound('click'); showScreen('shop'); });
if(btnShare) btnShare.addEventListener('click',function(){
  playSound('click');
  var rankEl=document.getElementById('res-rank'), priceEl=document.getElementById('res-price');
  var text='Умный водитель с ОСАГО 3D\n🏆 Ранг: '+(rankEl?rankEl.textContent:'')+'\n💰 Полис: '+(priceEl?priceEl.textContent:'')+'\n\nСможешь лучше?';
  if(ysdk&&isYaGames){ ysdk.share({message:text}).catch(function(){ fallbackShare(text); }); }
  else fallbackShare(text);
});
function fallbackShare(text){
  if(navigator.clipboard){ navigator.clipboard.writeText(text).then(function(){ showToast('Скопировано!'); }).catch(function(){}); }
  else showToast('Поделитесь результатом!');
}

// === CANVAS с devicePixelRatio ===
function resizeCanvas(){
  canvas=document.getElementById('game-canvas');
  if(!canvas) return;
  var dpr=window.devicePixelRatio||1;
  var w=window.innerWidth;
  var h=window.innerHeight;
  canvas.width=w*dpr;
  canvas.height=h*dpr;
  canvas.style.width=w+'px';
  canvas.style.height=h+'px';
  W=w; H=h;
  ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize',resizeCanvas);

function showToast(msg){
  var t=document.createElement('div'); t.textContent=msg;
  t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.9);color:#fff;padding:12px 24px;border-radius:20px;font-size:0.9rem;z-index:9999;animation:toastIn 0.3s ease;';
  document.body.appendChild(t); setTimeout(function(){ t.remove(); },2500);
}

function bootstrap(){
  loadLocalProgress(); loadSoundSetting();
  createRoad(0); resizeCanvas(); updateStats();
  if(loadSessionProgress()){
    showToast('Сезон продолжается! Заезд '+game.lap+'/10, класс '+game.currentClass);
  }
  var loading=document.getElementById('screen-loading');
  if(loading) loading.classList.remove('active');
  showScreen('form');
  console.log('Умный водитель с ОСАГО v2.5 загружен. Сегментов: '+segments.length);
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){ setTimeout(initSdk,50); });
} else { setTimeout(initSdk,50); }

// Пауза при сворачивании и потере фокуса
document.addEventListener('visibilitychange',function(){
  if(document.hidden&&game.isRunning&&!game.isPaused){ game.isPaused=true; showScreen('pause'); }
});
window.addEventListener('blur',function(){
  if(game.isRunning&&!game.isPaused){ game.isPaused=true; showScreen('pause'); }
});

// Лайтбокс клавиши
document.addEventListener('keydown',lightboxKeys);
