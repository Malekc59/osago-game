// Умный водитель с ОСАГО — 3D-движок v1.1
// Платформы: Яндекс.Игры + донаты + встроенные покупки + реклама

var canvas, ctx;
var W, H;

// === КОНФИГ ===
var SEGMENT_LENGTH = 200;
var RUMBLE_LENGTH = 3;
var ROAD_WIDTH = 2000;
var LANES = 3;
var CAMERA_HEIGHT = 1000;
var CAMERA_DEPTH = 0.84;
var DRAW_DISTANCE = 300;
var FOG_DENSITY = 5;
var MAX_SPEED = 12000;
var ACCEL = MAX_SPEED / 5;
var BREAKING = -MAX_SPEED;
var DECEL = -MAX_SPEED / 5;
var OFF_ROAD_DECEL = -MAX_SPEED / 2;
var OFF_ROAD_LIMIT = MAX_SPEED / 4;

// === ИГРА ===
var game = {
  cityCoef: 1.0, powerCoef: 1.0, currentClass: 3, currentKBM: 1.0,
  crashes: 0, totalCrashes: 0, lap: 1, maxLaps: 10,
  distance: 0, trackLength: 0, speed: 0, playerX: 0,
  isRunning: false, isPaused: false, startPrice: 0,
  bestScore: 0, gamesPlayed: 0, totalEarned: 0,
  landscape: 'forest', ownedCars: ['default'],
  activeCar: 'default', hasVIP: false, shieldActive: false,
  shieldTime: 0
};

var KBM_TABLE = {
  'M': 2.45, 0: 2.3, 1: 1.55, 2: 1.4, 3: 1.0,
  4: 0.95, 5: 0.9, 6: 0.85, 7: 0.8, 8: 0.75,
  9: 0.7, 10: 0.65, 11: 0.6, 12: 0.55, 13: 0.5
};
var KBM_CRASH_TABLE = {
  'M': 'M', 0: 'M', 1: 'M', 2: 'M', 3: 1,
  4: 2, 5: 2, 6: 3, 7: 4, 8: 4,
  9: 5, 10: 5, 11: 6, 12: 6, 13: 7
};

var segments = [];
var keyLeft = false, keyRight = false, keyFaster = false, keySlower = false;
var lastTime = 0;

// === ЦЕНЫ ===
var PRICES = {
  shield: 50,
  secondChance: 30,
  bmw: 30,
  haval: 60,
  toyota: 100,
  vip: 150
};

// === VK BRIDGE ===
var vkBridge = null, isVK = false, vkBridgeReady = false;
function initVK() {
  try {
    var bridge = window.vkBridge || (typeof vkBridge !== 'undefined' ? vkBridge : null) || window.bridge;
    if (bridge) {
      vkBridge = bridge; isVK = true;
      bridge.send('VKWebAppInit').then(function(d) {
        if (d.result) { vkBridgeReady = true;
          bridge.send('VKWebAppResizeWindow', {width:1000,height:2000}).catch(function(){});
          bridge.send('VKWebAppSetViewSettings', {status_bar_style:'light',action_bar_color:'#0a0a12'}).catch(function(){});
        }
      }).catch(function(){});
    }
  } catch(e) {}
}

// === УТИЛИТЫ ===
function limit(v, min, max) { return Math.max(min, Math.min(v, max)); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function percentRemaining(n, total) { return (n % total) / total; }
function interpolate(a, b, p) { return a + (b - a) * p; }

// === ДОРОГА ===
function createRoad() {
  segments = [];
  function addSegment(curve, y) {
    var n = segments.length;
    segments.push({
      index: n,
      p1: { world: { z: n * SEGMENT_LENGTH, y: lastY() }, camera: {}, screen: {} },
      p2: { world: { z: (n + 1) * SEGMENT_LENGTH, y: y }, camera: {}, screen: {} },
      curve: curve, sprites: [],
      color: Math.floor(n / RUMBLE_LENGTH) % 2
        ? { road:'#2a2a35', grass:'#1a3a1a', rumble:'#ff3333', lane:'#555' }
        : { road:'#2d2d3a', grass:'#1d3d1d', rumble:'#ffffff', lane:'#555' }
    });
  }
  function lastY() { return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y; }

  // Старт
  for (var n = 0; n < 100; n++) addSegment(0, 0);
  // Лес — длинный участок
  for (n = 0; n < 400; n++) addSegment(Math.sin(n / 30) * 2, Math.sin(n / 20) * 500);
  // Переход
  for (n = 0; n < 80; n++) addSegment(0, lastY());
  // Поле
  for (n = 0; n < 400; n++) addSegment(Math.sin(n / 40) * 3, 0);
  // Переход
  for (n = 0; n < 80; n++) addSegment(0, lastY());
  // Город
  for (n = 0; n < 400; n++) addSegment((n % 80 < 40 ? 2 : -2), 0);
  // Финишная прямая
  for (n = 0; n < 200; n++) addSegment(0, 0);

  game.trackLength = segments.length * SEGMENT_LENGTH;

  // Препятствия — 80 штук, по центру 3 полос
  var laneOffsets = [-0.55, 0, 0.55]; // левая, центр, правая полоса
  var carTypes = ['sedan', 'taxi', 'police', 'truck', 'deer'];
  for (n = 0; n < 80; n++) {
    var idx = randomInt(120, segments.length - 250);
    // Не ставим 2 препятствия на один сегмент
    if (segments[idx].sprites.length > 0) continue;
    segments[idx].sprites.push({
      type: randomChoice(carTypes),
      offset: randomChoice(laneOffsets),
      width: 0.5,
      color: randomChoice(['#cc2222', '#eeeeee', '#2222cc', '#ccaa22', '#888888'])
    });
  }
}

function findSegment(z) {
  return segments[Math.floor(z / SEGMENT_LENGTH) % segments.length];
}

// === ПРОЕКЦИЯ ===
function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
  p.camera.x = (p.world.x || 0) - cameraX;
  p.camera.y = (p.world.y || 0) - cameraY;
  p.camera.z = (p.world.z || 0) - cameraZ;
  p.screen.scale = cameraDepth / p.camera.z;
  p.screen.x = Math.round((width / 2) + (p.screen.scale * p.camera.x * width / 2));
  p.screen.y = Math.round((height / 2) - (p.screen.scale * p.camera.y * height / 2));
  p.screen.w = Math.round((p.screen.scale * roadWidth * width / 2));
}

// === РЕНДЕР ===
function render() {
  ctx.clearRect(0, 0, W, H);

  // Небо
  var skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  if (game.landscape === 'forest') { skyGrad.addColorStop(0, '#0a1628'); skyGrad.addColorStop(1, '#1a3a5a'); }
  else if (game.landscape === 'field') { skyGrad.addColorStop(0, '#1a2040'); skyGrad.addColorStop(1, '#4a6a9a'); }
  else { skyGrad.addColorStop(0, '#0a0a18'); skyGrad.addColorStop(1, '#2a2a4a'); }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H * 0.5);

  renderLandscape();
  if (segments.length === 0) return;

  var baseSegment = findSegment(game.distance);
  var basePercent = percentRemaining(game.distance, SEGMENT_LENGTH);
  var playerSegment = findSegment(game.distance + CAMERA_DEPTH * 1000);
  var playerPercent = percentRemaining(game.distance + CAMERA_DEPTH * 1000, SEGMENT_LENGTH);
  var playerY = interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
  var dx = -(baseSegment.curve * basePercent);
  var x = 0;
  var maxy = H;

  for (var n = 0; n < DRAW_DISTANCE; n++) {
    var segment = segments[(baseSegment.index + n) % segments.length];
    segment.looped = segment.index < baseSegment.index;
    segment.fog = 1 / (Math.pow(Math.E, (n / DRAW_DISTANCE) * (n / DRAW_DISTANCE) * FOG_DENSITY));

    project(segment.p1, (game.playerX * ROAD_WIDTH) - x, playerY + CAMERA_HEIGHT,
      game.distance - (segment.looped ? game.trackLength : 0), CAMERA_DEPTH, W, H, ROAD_WIDTH);
    project(segment.p2, (game.playerX * ROAD_WIDTH) - x - dx, playerY + CAMERA_HEIGHT,
      game.distance - (segment.looped ? game.trackLength : 0), CAMERA_DEPTH, W, H, ROAD_WIDTH);

    x += dx;
    dx += segment.curve;

    if ((segment.p1.camera.z <= CAMERA_DEPTH) || (segment.p2.screen.y >= maxy) || (segment.p2.screen.y >= segment.p1.screen.y)) continue;

    renderSegment(segment);
    maxy = segment.p1.screen.y;
  }

  // Спрайты (рисуем от дальних к ближним)
  for (var n = DRAW_DISTANCE - 1; n > 0; n--) {
    var segment = segments[(baseSegment.index + n) % segments.length];
    if (!segment.p1.screen.scale) continue;
    for (var i = 0; i < segment.sprites.length; i++) {
      renderSprite(segment, segment.sprites[i], segment.p1.screen.scale);
    }
  }

  checkCollisions();
}

function renderSegment(segment) {
  var x1 = segment.p1.screen.x, y1 = segment.p1.screen.y, w1 = segment.p1.screen.w;
  var x2 = segment.p2.screen.x, y2 = segment.p2.screen.y, w2 = segment.p2.screen.w;
  var r1 = w1 / Math.max(6, 2 * LANES);
  var r2 = w2 / Math.max(6, 2 * LANES);

  ctx.fillStyle = segment.color.grass;
  ctx.fillRect(0, y2, W, y1 - y2);

  drawPoly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, segment.color.rumble);
  drawPoly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, segment.color.rumble);
  drawPoly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, segment.color.road);

  if (segment.color.lane) {
    var lw1 = w1 * 0.02, lw2 = w2 * 0.02;
    var lx1 = x1 - w1 * 0.33, lx2 = x2 - w2 * 0.33;
    drawPoly(lx1 - lw1, y1, lx1 + lw1, y1, lx2 + lw2, y2, lx2 - lw2, y2, segment.color.lane);
    lx1 = x1 + w1 * 0.33; lx2 = x2 + w2 * 0.33;
    drawPoly(lx1 - lw1, y1, lx1 + lw1, y1, lx2 + lw2, y2, lx2 - lw2, y2, segment.color.lane);
  }
}

function drawPoly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath(); ctx.fill();
}

function renderSprite(segment, sprite, scale) {
  var spriteScale = scale * (W / 600);
  var sw = Math.max(30, 180 * spriteScale);  // ширина машинки
  var sh = Math.max(40, 220 * spriteScale);  // высота машинки

  var sx = segment.p1.screen.x + (sprite.offset * segment.p1.screen.w) - sw / 2;
  var sy = segment.p1.screen.y - sh * 0.85;

  if (sx < -sw || sx > W + sw || sy < -sh || sy > H + sh) return;

  var cx = sx + sw / 2;
  var cy = sy + sh;
  var w = sw;
  var h = sh;

  // Рисуем машинку спереди (вид с фарами)
  drawCarFront(cx, cy, w, h, sprite.type, sprite.color);
}

function drawCarFront(cx, cy, w, h, type, color) {
  var bw = w * 0.9;  // ширина кузова
  var bh = h * 0.75; // высота кузова
  var bx = cx - bw / 2;
  var by = cy - bh;

  // Тень
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 5, bw * 0.5, h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  if (type === 'truck') {
    // Грузовик — высокий и узкий
    bh = h * 0.85;
    by = cy - bh;
    // Кабина
    ctx.fillStyle = color;
    ctx.fillRect(bx + bw * 0.15, by, bw * 0.7, bh * 0.55);
    // Кузов
    ctx.fillStyle = '#555';
    ctx.fillRect(bx + bw * 0.05, by + bh * 0.5, bw * 0.9, bh * 0.45);
    // Фары
    ctx.fillStyle = '#ffee88';
    ctx.fillRect(bx + bw * 0.2, by + bh * 0.45, bw * 0.12, bh * 0.08);
    ctx.fillRect(bx + bw * 0.68, by + bh * 0.45, bw * 0.12, bh * 0.08);
    // Решётка
    ctx.fillStyle = '#333';
    ctx.fillRect(bx + bw * 0.35, by + bh * 0.5, bw * 0.3, bh * 0.1);
  } else if (type === 'deer') {
    // Олень — упрощённый силуэт
    ctx.fillStyle = '#8B7355';
    // Тело
    ctx.beginPath();
    ctx.ellipse(cx, by + bh * 0.5, bw * 0.25, bh * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    // Голова
    ctx.beginPath();
    ctx.arc(cx, by + bh * 0.25, bw * 0.15, 0, Math.PI * 2);
    ctx.fill();
    // Рога
    ctx.strokeStyle = '#6B5344';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 5, by + bh * 0.15);
    ctx.lineTo(cx - 15, by);
    ctx.moveTo(cx + 5, by + bh * 0.15);
    ctx.lineTo(cx + 15, by);
    ctx.stroke();
    // Глаза
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(cx - 4, by + bh * 0.22, 2, 0, Math.PI * 2);
    ctx.arc(cx + 4, by + bh * 0.22, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Легковая машина — седан, такси, полиция
    // Кузов (трапеция — шире снизу)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.1, by + bh * 0.35);  // левый верх
    ctx.lineTo(bx + bw * 0.9, by + bh * 0.35);  // правый верх
    ctx.lineTo(bx + bw, by + bh);               // правый низ
    ctx.lineTo(bx, by + bh);                    // левый низ
    ctx.closePath();
    ctx.fill();

    // Капот
    ctx.fillStyle = shadeColor(color, -20);
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.15, by + bh * 0.55);
    ctx.lineTo(bx + bw * 0.85, by + bh * 0.55);
    ctx.lineTo(bx + bw * 0.95, by + bh * 0.85);
    ctx.lineTo(bx + bw * 0.05, by + bh * 0.85);
    ctx.closePath();
    ctx.fill();

    // Лобовое стекло
    ctx.fillStyle = '#1a3a5a';
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.2, by + bh * 0.38);
    ctx.lineTo(bx + bw * 0.8, by + bh * 0.38);
    ctx.lineTo(bx + bw * 0.85, by + bh * 0.55);
    ctx.lineTo(bx + bw * 0.15, by + bh * 0.55);
    ctx.closePath();
    ctx.fill();

    // Фары
    ctx.fillStyle = '#fffee0';
    ctx.beginPath();
    ctx.ellipse(bx + bw * 0.22, by + bh * 0.72, bw * 0.1, bh * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(bx + bw * 0.78, by + bh * 0.72, bw * 0.1, bh * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    // Свет от фар
    ctx.fillStyle = 'rgba(255,255,200,0.08)';
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.12, by + bh * 0.75);
    ctx.lineTo(bx + bw * 0.32, by + bh * 0.75);
    ctx.lineTo(bx + bw * 0.5, by + bh * 1.5);
    ctx.lineTo(bx - bw * 0.1, by + bh * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.68, by + bh * 0.75);
    ctx.lineTo(bx + bw * 0.88, by + bh * 0.75);
    ctx.lineTo(bx + bw * 1.1, by + bh * 1.5);
    ctx.lineTo(bx + bw * 0.5, by + bh * 1.5);
    ctx.closePath();
    ctx.fill();

    // Решётка радиатора
    ctx.fillStyle = '#222';
    ctx.fillRect(bx + bw * 0.35, by + bh * 0.82, bw * 0.3, bh * 0.08);

    // Бампер
    ctx.fillStyle = shadeColor(color, -30);
    ctx.fillRect(bx + bw * 0.05, by + bh * 0.88, bw * 0.9, bh * 0.12);

    // Номер
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + bw * 0.38, by + bh * 0.9, bw * 0.24, bh * 0.06);
    ctx.fillStyle = '#000';
    ctx.font = 'bold ' + Math.round(bh * 0.04) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('A 123', cx, by + bh * 0.945);

    if (type === 'police') {
      // Мигалка
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.35, by + bh * 0.32, bw * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0000ff';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.65, by + bh * 0.32, bw * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    if (type === 'taxi') {
      // Шашечки такси
      ctx.fillStyle = '#ffcc00';
      ctx.fillRect(bx + bw * 0.42, by + bh * 0.28, bw * 0.16, bh * 0.06);
    }
  }
}

// Затемнение / осветление цвета
function shadeColor(color, percent) {
  var num = parseInt(color.replace("#",""), 16);
  var amt = Math.round(2.55 * percent);
  var R = (num >> 16) + amt;
  var G = (num >> 8 & 0x00FF) + amt;
  var B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
}

function renderLandscape() {
  var hy = H * 0.45;
  ctx.fillStyle = game.landscape === 'city' ? '#1a1a2e' : (game.landscape === 'field' ? '#2a4a2a' : '#1a3a1a');
  if (game.landscape === 'city') {
    for (var i = 0; i < W; i += 60) { var h = 30 + Math.sin(i * 0.05) * 20; ctx.fillRect(i, hy - h, 50, h); }
  } else if (game.landscape === 'forest') {
    for (var i = 0; i < W; i += 40) { var h = 25 + Math.sin(i * 0.08) * 15; ctx.beginPath(); ctx.moveTo(i, hy); ctx.lineTo(i + 20, hy - h); ctx.lineTo(i + 40, hy); ctx.fill(); }
  } else {
    ctx.beginPath(); ctx.moveTo(0, hy);
    for (var i = 0; i <= W; i += 20) ctx.lineTo(i, hy - Math.sin(i * 0.02) * 15 - 5);
    ctx.lineTo(W, H * 0.5); ctx.lineTo(0, H * 0.5); ctx.fill();
  }
}

// === СТОЛКНОВЕНИЯ ===
var lastCrashSeg = -1;
function checkCollisions() {
  // Безаварийный режим
  if (game.shieldActive) {
    game.shieldTime -= 1/60;
    if (game.shieldTime <= 0) game.shieldActive = false;
  }

  var playerSegment = findSegment(game.distance + CAMERA_DEPTH * 1000);
  if (playerSegment.index === lastCrashSeg) return;

  for (var i = 0; i < playerSegment.sprites.length; i++) {
    var sprite = playerSegment.sprites[i];
    if (game.playerX > sprite.offset - 0.3 && game.playerX < sprite.offset + 0.3) {
      if (game.speed > MAX_SPEED * 0.3) {
        if (game.shieldActive) {
          // Щит активен — аварии нет, препятствие исчезает
          playerSegment.sprites.splice(i, 1);
          showToast('🛡️ Щит защитил!');
        } else {
          handleCrash();
          lastCrashSeg = playerSegment.index;
          game.speed = MAX_SPEED * 0.3;
        }
        break;
      }
    }
  }
}

function handleCrash() {
  game.crashes++;
  game.totalCrashes++;
  var newClass = KBM_CRASH_TABLE[game.currentClass];
  game.currentClass = newClass;
  game.currentKBM = KBM_TABLE[newClass];
  var newPrice = calculatePrice(game.cityCoef, game.powerCoef, game.currentClass);

  var elC = document.getElementById('hud-crashes');
  var elCl = document.getElementById('hud-class');
  var elP = document.getElementById('hud-price');
  if (elC) elC.textContent = game.crashes;
  if (elCl) elCl.textContent = game.currentClass;
  if (elP) {
    elP.textContent = formatPrice(newPrice);
    if (game.currentKBM > 1.0) { elP.classList.add('danger'); elP.classList.remove('warning'); }
    else if (game.currentKBM > 0.9) { elP.classList.add('warning'); elP.classList.remove('danger'); }
    else { elP.classList.remove('danger', 'warning'); }
  }

  var overlay = document.getElementById('crash-overlay');
  if (overlay) { overlay.classList.add('active'); setTimeout(function() { overlay.classList.remove('active'); }, 800); }
}

// === ОБНОВЛЕНИЕ ===
function update(dt) {
  if (!game.isRunning || game.isPaused) return;

  var playerSegment = findSegment(game.distance + CAMERA_DEPTH * 1000);
  var speedPercent = game.speed / MAX_SPEED;
  var dx = dt * 2 * speedPercent;

  if (keyLeft) { game.playerX -= dx; rotateWheel(-25); }
  else if (keyRight) { game.playerX += dx; rotateWheel(25); }
  else { rotateWheel(0); }

  if (keyFaster) game.speed += ACCEL * dt;
  else if (keySlower) game.speed += BREAKING * dt;
  else game.speed += DECEL * dt;

  if ((game.playerX < -1 || game.playerX > 1) && game.speed > OFF_ROAD_LIMIT) game.speed += OFF_ROAD_DECEL * dt;
  game.playerX = limit(game.playerX, -2, 2);
  game.speed = limit(game.speed, 0, MAX_SPEED);
  game.distance += (game.speed * dt);

  var progress = game.distance / game.trackLength;
  if (progress < 0.25) game.landscape = 'forest';
  else if (progress < 0.5) game.landscape = 'field';
  else if (progress < 0.75) game.landscape = 'city';
  else game.landscape = 'forest';

  var elDist = document.getElementById('hud-dist');
  if (elDist) elDist.textContent = Math.max(0, Math.round((game.trackLength - game.distance) / 100)) + 'м';

  if (game.distance >= game.trackLength) endLap();
}

function rotateWheel(deg) {
  var wheel = document.getElementById('wheel-group');
  if (wheel) wheel.setAttribute('transform', 'translate(100,100) rotate(' + deg + ')');
}

// === ИГРОВОЙ ЦИКЛ ===
function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  var dt = Math.min(1, (timestamp - lastTime) / 1000);
  lastTime = timestamp;
  update(dt);
  render();
  if (game.isRunning) requestAnimationFrame(gameLoop);
}

// === ЦЕНЫ ===
var BASE_RATE = 3000;
function calculatePrice(cityCoef, powerCoef, kbmClass) {
  var kbm = KBM_TABLE[kbmClass];
  return kbm ? Math.round(BASE_RATE * cityCoef * powerCoef * kbm) : 0;
}
function formatPrice(price) { return price.toLocaleString('ru-RU') + ' ₽'; }

// === ЭКРАНЫ ===
function showScreen(name) {
  var screens = ['screen-loading','screen-form','screen-game','screen-pause','screen-result','screen-shop'];
  screens.forEach(function(s) { var el = document.getElementById(s); if (el) el.classList.remove('active'); });
  var target = document.getElementById('screen-' + name);
  if (target) target.classList.add('active');
}

// === СТАРТ ===
var isStarting = false;
function startGame() {
  if (isStarting) return;
  isStarting = true;

  game.cityCoef = parseFloat(document.getElementById('city').value);
  game.powerCoef = parseFloat(document.getElementById('power').value);
  if (game.lap === 1) {
    game.currentClass = 3;
    game.currentKBM = 1.0;
    game.crashes = 0;
  }
  game.distance = 0;
  game.speed = 0;
  game.playerX = 0;
  game.isRunning = true;
  game.isPaused = false;
  game.startPrice = calculatePrice(game.cityCoef, game.powerCoef, game.currentClass);
  game.landscape = 'forest';
  game.shieldActive = false;
  game.shieldTime = 0;
  lastCrashSeg = -1;
  lastTime = 0;

  document.getElementById('hud-price').textContent = formatPrice(game.startPrice);
  document.getElementById('hud-crashes').textContent = game.crashes;
  document.getElementById('hud-class').textContent = game.currentClass;
  document.getElementById('hud-lap').textContent = game.lap + '/' + game.maxLaps;
  document.getElementById('hud-dist').textContent = Math.round(game.trackLength / 100) + 'м';
  rotateWheel(0);
  showScreen('game');
  resizeCanvas();
  requestAnimationFrame(gameLoop);
  setTimeout(function() { isStarting = false; }, 500);
}

function endLap() {
  game.isRunning = false;
  var finalPrice = calculatePrice(game.cityCoef, game.powerCoef, game.currentClass);
  var diff = finalPrice - game.startPrice;

  var rank;
  if (game.crashes === 0) rank = '⭐ ЛЕГЕНДА';
  else if (game.crashes === 1) rank = '🥇 МАСТЕР';
  else if (game.crashes <= 3) rank = '🥈 ОПЫТНЫЙ';
  else if (game.crashes <= 5) rank = '🥉 НОВИЧОК';
  else rank = '💥 НУЖНЫ КУРСЫ';

  var msg;
  if (game.crashes === 0) msg = 'Идеально! Ни одной аварии. КБМ не пострадал!';
  else if (diff < 1000) msg = 'Неплохо! ' + game.crashes + ' авария — полис подорожал несильно.';
  else if (diff < 3000) msg = 'Осторожнее! ' + game.crashes + ' аварий — полис подорожал на ' + formatPrice(diff) + '.';
  else msg = 'Катастрофа! ' + game.crashes + ' аварий. Полис подорожал на ' + formatPrice(diff) + '.';

  game.gamesPlayed++;
  var score = game.startPrice - finalPrice;
  if (score > game.bestScore) game.bestScore = score;
  saveProgress();

  document.getElementById('res-start').textContent = formatPrice(game.startPrice);
  document.getElementById('res-crashes').textContent = game.crashes;
  document.getElementById('res-class').textContent = game.currentClass + ' (КБМ: ' + game.currentKBM + ')';
  document.getElementById('res-price').textContent = formatPrice(finalPrice);
  document.getElementById('res-rank').textContent = rank;
  document.getElementById('res-msg').textContent = msg;
  document.getElementById('res-best').textContent = formatPrice(game.bestScore);
  document.getElementById('res-total').textContent = game.gamesPlayed;
  document.getElementById('res-kbm').textContent = game.currentClass;

  showScreen('result');
}

function nextLap() {
  if (game.lap < game.maxLaps) {
    game.lap++;
    startGame();
  } else {
    game.lap = 1;
    game.currentClass = 3;
    game.currentKBM = 1.0;
    showScreen('form');
    updateStats();
  }
}

// === СОХРАНЕНИЕ ===
function saveProgress() {
  try {
    localStorage.setItem('umny_voditel_progress', JSON.stringify({
      bestScore: game.bestScore, gamesPlayed: game.gamesPlayed,
      totalCrashes: game.totalCrashes, ownedCars: game.ownedCars,
      activeCar: game.activeCar, hasVIP: game.hasVIP
    }));
  } catch(e) {}
}
function loadProgress() {
  try {
    var d = JSON.parse(localStorage.getItem('umny_voditel_progress'));
    if (d) {
      game.bestScore = d.bestScore || 0;
      game.gamesPlayed = d.gamesPlayed || 0;
      game.totalCrashes = d.totalCrashes || 0;
      game.ownedCars = d.ownedCars || ['default'];
      game.activeCar = d.activeCar || 'default';
      game.hasVIP = d.hasVIP || false;
    }
  } catch(e) {}
}

function updateStats() {
  var best = document.getElementById('stat-best');
  var games = document.getElementById('stat-games');
  var kbm = document.getElementById('stat-kbm');
  if (best) best.textContent = game.bestScore > 0 ? formatPrice(game.bestScore) : '—';
  if (games) games.textContent = game.gamesPlayed;
  if (kbm) kbm.textContent = game.currentClass;
  var city = parseFloat(document.getElementById('city').value);
  var power = parseFloat(document.getElementById('power').value);
  var price = calculatePrice(city, power, game.currentClass);
  var preview = document.getElementById('preview-price');
  if (preview) preview.textContent = formatPrice(price);
}

// === УПРАВЛЕНИЕ ===
document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowLeft') { e.preventDefault(); keyLeft = true; }
  else if (e.key === 'ArrowRight') { e.preventDefault(); keyRight = true; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); keyFaster = true; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); keySlower = true; }
  else if (e.key === 'Escape' || e.key === 'p') {
    if (game.isRunning) {
      if (game.isPaused) { game.isPaused = false; showScreen('game'); lastTime = 0; requestAnimationFrame(gameLoop); }
      else { game.isPaused = true; showScreen('pause'); }
    }
  }
});
document.addEventListener('keyup', function(e) {
  if (e.key === 'ArrowLeft') keyLeft = false;
  else if (e.key === 'ArrowRight') keyRight = false;
  else if (e.key === 'ArrowUp') keyFaster = false;
  else if (e.key === 'ArrowDown') keySlower = false;
});

document.getElementById('touch-left').addEventListener('touchstart', function(e) { e.preventDefault(); keyLeft = true; });
document.getElementById('touch-left').addEventListener('touchend', function(e) { e.preventDefault(); keyLeft = false; });
document.getElementById('touch-right').addEventListener('touchstart', function(e) { e.preventDefault(); keyRight = true; });
document.getElementById('touch-right').addEventListener('touchend', function(e) { e.preventDefault(); keyRight = false; });

// === КНОПКИ ===
document.getElementById('city').addEventListener('change', updateStats);
document.getElementById('power').addEventListener('change', updateStats);
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-next').addEventListener('click', nextLap);
document.getElementById('btn-menu').addEventListener('click', function() { showScreen('form'); updateStats(); });
document.getElementById('btn-shop').addEventListener('click', function() { showScreen('shop'); });
document.getElementById('btn-shop-back').addEventListener('click', function() { showScreen('form'); });
document.getElementById('btn-resume').addEventListener('click', function() { game.isPaused = false; showScreen('game'); lastTime = 0; requestAnimationFrame(gameLoop); });
document.getElementById('btn-quit').addEventListener('click', function() { game.isRunning = false; showScreen('form'); updateStats(); });

document.getElementById('btn-leaderboard').addEventListener('click', function() {
  if (vkBridgeReady) { vkBridge.send('VKWebAppShowLeaderBoardBox', {user_result: game.bestScore}).catch(function(){}); }
  else { showToast('🏆 Только в VK'); }
});
document.getElementById('btn-invite').addEventListener('click', function() {
  if (vkBridgeReady) { vkBridge.send('VKWebAppInvite', {}).catch(function(){}); }
  else { showToast('👥 Только в VK'); }
});
document.getElementById('btn-donate').addEventListener('click', function() {
  window.open('https://www.donationalerts.com/r/umnyvoditel', '_blank');
});
document.getElementById('btn-share').addEventListener('click', function() {
  var text = '🚗 Умный водитель с ОСАГО 3D\n🏆 Ранг: ' + document.getElementById('res-rank').textContent + '\n💰 Полис: ' + document.getElementById('res-price').textContent + '\n\nСможешь лучше?';
  if (vkBridgeReady) { vkBridge.send('VKWebAppShowWallPostBox', {message: text}).catch(function(){}); }
  else { navigator.clipboard.writeText(text).then(function() { showToast('📋 Скопировано!'); }).catch(function(){}); }
});

// === CANVAS ===
function resizeCanvas() {
  canvas = document.getElementById('game-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  W = canvas.width; H = canvas.height;
  ctx = canvas.getContext('2d');
}
window.addEventListener('resize', resizeCanvas);

// === TOAST ===
function showToast(msg) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.9);color:#fff;padding:12px 24px;border-radius:20px;font-size:0.9rem;z-index:9999;animation:toastIn 0.3s ease;';
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 2500);
}

// === ИНИЦИАЛИЗАЦИЯ ===
function bootstrap() {
  loadProgress();
  initVK();
  createRoad();
  resizeCanvas();
  updateStats();
  document.getElementById('screen-loading').classList.remove('active');
  showScreen('form');
  console.log('✅ Умный водитель с ОСАГО загружен. Сегментов: ' + segments.length);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { setTimeout(bootstrap, 100); });
} else {
  setTimeout(bootstrap, 100);
}
