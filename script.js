```javascript
// ОСАГО: Умный водитель

var BASE_RATE = 3000;
var GAME_DURATION = 60;
var LANES = 3;

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

var OBSTACLES = ['🚗', '🚕', '🚓', '🚛', '🦌', '🚧', '🕳️'];

var gameState = {
    cityCoef: 1.0,
    powerCoef: 1.0,
    currentClass: 3,
    currentKBM: 1.0,
    crashes: 0,
    timeLeft: GAME_DURATION,
    isRunning: false,
    playerLane: 1,
    startPrice: 0,
    obstacles: [],
    spawnInterval: 2000,
    lastSpawnTime: 0,
    gameLoopId: null,
    timerId: null,
    roadOffset: 0
};

// VK Bridge
var vkBridge = null;
var isVK = false;

function initVK() {
    if (typeof window !== 'undefined' && window.vkBridge) {
        vkBridge = window.vkBridge;
        isVK = true;
        vkBridge.send('VKWebAppInit', {})
            .then(function() { console.log('VK инициализирован'); })
            .catch(function(err) { console.log('VK ошибка:', err); });
    }
}

function getEl(id) {
    return document.getElementById(id);
}

var screens = {
    form: getEl('screen-form'),
    game: getEl('screen-game'),
    result: getEl('screen-result')
};

var inputs = {
    city: getEl('city'),
    experience: getEl('experience'),
    power: getEl('power')
};

var displays = {
    previewPrice: getEl('preview-price'),
    dashPrice: getEl('dash-price'),
    dashCrashes: getEl('dash-crashes'),
    dashClass: getEl('dash-class'),
    dashTime: getEl('dash-time'),
    playerCar: getEl('player-car'),
    gameArea: getEl('game-area'),
    crashOverlay: getEl('crash-overlay'),
    resStartPrice: getEl('res-start-price'),
    resCrashes: getEl('res-crashes'),
    resFinalClass: getEl('res-final-class'),
    resFinalPrice: getEl('res-final-price'),
    resRank: getEl('res-rank'),
    resMessage: getEl('res-message')
};

var buttons = {
    start: getEl('btn-start'),
    restart: getEl('btn-restart'),
    share: getEl('btn-share')
};

var touchZones = {
    left: getEl('touch-left'),
    right: getEl('touch-right')
};

function getLaneCenterPercent(laneIndex) {
    return 12.5 + (laneIndex * 25) + 12.5;
}

function calculatePrice(cityCoef, powerCoef, kbmClass) {
    var kbm = KBM_TABLE[kbmClass];
    if (!kbm) return 0;
    return Math.round(BASE_RATE * cityCoef * powerCoef * kbm);
}

function formatPrice(price) {
    return price.toLocaleString('ru-RU') + ' ₽';
}

function updatePreviewPrice() {
    var city = parseFloat(inputs.city.value);
    var expClass = inputs.experience.value;
    var power = parseFloat(inputs.power.value);
    var price = calculatePrice(city, power, expClass);
    displays.previewPrice.textContent = formatPrice(price);
}

function showScreen(screenName) {
    Object.values(screens).forEach(function(s) { s.classList.remove('active'); });
    screens[screenName].classList.add('active');
}

function movePlayer(direction) {
    if (!gameState.isRunning) return;
    if (direction === 'left' && gameState.playerLane > 0) {
        gameState.playerLane--;
    } else if (direction === 'right' && gameState.playerLane < LANES - 1) {
        gameState.playerLane++;
    }
    updatePlayerPosition();
}

function updatePlayerPosition() {
    var centerPercent = getLaneCenterPercent(gameState.playerLane);
    displays.playerCar.style.left = centerPercent + '%';
    displays.playerCar.style.transform = 'translateX(-50%)';
}

function spawnObstacle() {
    var lane = Math.floor(Math.random() * LANES);
    var emoji = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
    var obstacleEl = document.createElement('div');
    obstacleEl.className = 'obstacle';
    obstacleEl.textContent = emoji;
    var centerPercent = getLaneCenterPercent(lane);
    obstacleEl.style.left = centerPercent + '%';
    obstacleEl.style.top = '-50px';
    obstacleEl.style.transform = 'translateX(-50%)';
    displays.gameArea.appendChild(obstacleEl);
    gameState.obstacles.push({
        lane: lane,
        y: -50,
        element: obstacleEl,
        passed: false
    });
}

function updateObstacles(deltaTime) {
    var speed = getCurrentSpeed();
    for (var i = gameState.obstacles.length - 1; i >= 0; i--) {
        var obs = gameState.obstacles[i];
        obs.y += speed * (deltaTime / 1000);
        obs.element.style.top = obs.y + 'px';
        if (!obs.passed && checkCollision(obs)) {
            handleCrash();
            obs.passed = true;
        }
        var gameHeight = displays.gameArea.clientHeight;
        if (obs.y > gameHeight + 50) {
            obs.element.remove();
            gameState.obstacles.splice(i, 1);
        }
    }
}

function getCurrentSpeed() {
    var progress = 1 - (gameState.timeLeft / GAME_DURATION);
    return 200 + (progress * 300);
}

function checkCollision(obstacle) {
    var carRect = displays.playerCar.getBoundingClientRect();
    var obsRect = obstacle.element.getBoundingClientRect();
    var overlapX = Math.max(0, Math.min(carRect.right, obsRect.right) - Math.max(carRect.left, obsRect.left));
    var overlapY = Math.max(0, Math.min(carRect.bottom, obsRect.bottom) - Math.max(carRect.top, obsRect.top));
    return overlapX > 10 && overlapY > 10;
}

function handleCrash() {
    gameState.crashes++;
    var newClass = KBM_CRASH_TABLE[gameState.currentClass];
    gameState.currentClass = newClass;
    gameState.currentKBM = KBM_TABLE[newClass];
    var newPrice = calculatePrice(gameState.cityCoef, gameState.powerCoef, gameState.currentClass);
    displays.dashCrashes.textContent = gameState.crashes;
    displays.dashClass.textContent = gameState.currentClass;
    displays.dashPrice.textContent = formatPrice(newPrice);
    displays.dashPrice.classList.add('price-bump');
    setTimeout(function() { displays.dashPrice.classList.remove('price-bump'); }, 400);
    if (gameState.currentKBM > 1.0) {
        displays.dashPrice.classList.add('danger');
    } else if (gameState.currentKBM > 0.9) {
        displays.dashPrice.classList.add('warning');
    }
    showCrashOverlay();
}

function showCrashOverlay() {
    displays.crashOverlay.classList.remove('hidden');
    setTimeout(function() {
        displays.crashOverlay.classList.add('hidden');
    }, 1500);
}

function shareResult() {
    var rank = getEl('res-rank').textContent;
    var crashes = gameState.crashes;
    var finalPrice = getEl('res-final-price').textContent;
    var startPrice = getEl('res-start-price').textContent;
    var message = '🚗 ОСАГО: Умный водитель\n🏆 Ранг: ' + rank + '\n💥 Аварий: ' + crashes + '\n💰 Полис: ' + finalPrice + ' (было ' + startPrice + ')\n\nСможешь лучше? 👇';
    
    if (isVK && vkBridge) {
        vkBridge.send('VKWebAppShare', { message: message })
            .then(function(data) { if (data.result) console.log('Успешно!'); })
            .catch(function(err) { console.log('Ошибка:', err); fallbackShare(message); });
    } else {
        fallbackShare(message);
    }
}

function fallbackShare(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
            alert('📋 Результат скопирован!');
        });
    } else {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('📋 Результат скопирован!');
    }
}

var lastFrameTime = 0;

function gameLoop(timestamp) {
    if (!gameState.isRunning) return;
    if (!lastFrameTime) lastFrameTime = timestamp;
    var deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    if (timestamp - gameState.lastSpawnTime > gameState.spawnInterval) {
        spawnObstacle();
        gameState.lastSpawnTime = timestamp;
        var progress = 1 - (gameState.timeLeft / GAME_DURATION);
        gameState.spawnInterval = Math.max(600, 2000 - (progress * 1400));
    }
    updateObstacles(deltaTime);
    gameState.gameLoopId = requestAnimationFrame(gameLoop);
}

function startTimer() {
    gameState.timerId = setInterval(function() {
        gameState.timeLeft--;
        displays.dashTime.textContent = gameState.timeLeft;
        if (gameState.timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

function startGame() {
    gameState.cityCoef = parseFloat(inputs.city.value);
    gameState.powerCoef = parseFloat(inputs.power.value);
    gameState.currentClass = inputs.experience.value;
    gameState.currentKBM = KBM_TABLE[gameState.currentClass];
    gameState.crashes = 0;
    gameState.timeLeft = GAME_DURATION;
    gameState.playerLane = 1;
    gameState.obstacles = [];
    gameState.spawnInterval = 2000;
    gameState.lastSpawnTime = 0;
    gameState.isRunning = true;
    gameState.startPrice = calculatePrice(gameState.cityCoef, gameState.powerCoef, gameState.currentClass);
    displays.dashPrice.textContent = formatPrice(gameState.startPrice);
    displays.dashCrashes.textContent = '0';
    displays.dashClass.textContent = gameState.currentClass;
    displays.dashTime.textContent = GAME_DURATION;
    displays.dashPrice.classList.remove('danger', 'warning');
    document.querySelectorAll('.obstacle').forEach(function(el) { el.remove(); });
    updatePlayerPosition();
    showScreen('game');
    lastFrameTime = 0;
    gameState.gameLoopId = requestAnimationFrame(gameLoop);
    startTimer();
}

function endGame() {
    gameState.isRunning = false;
    if (gameState.gameLoopId) cancelAnimationFrame(gameState.gameLoopId);
    if (gameState.timerId) clearInterval(gameState.timerId);
    document.querySelectorAll('.obstacle').forEach(function(el) { el.remove(); });
    var finalPrice = calculatePrice(gameState.cityCoef, gameState.powerCoef, gameState.currentClass);
    var rank = getRank(gameState.crashes);
    var message = getResultMessage(gameState.crashes, finalPrice, gameState.startPrice);
    displays.resStartPrice.textContent = formatPrice(gameState.startPrice);
    displays.resCrashes.textContent = gameState.crashes;
    displays.resFinalClass.textContent = gameState.currentClass + ' (КБМ: ' + gameState.currentKBM + ')';
    displays.resFinalPrice.textContent = formatPrice(finalPrice);
    displays.resRank.textContent = rank;
    displays.resMessage.textContent = message;
    showScreen('result');
}

function getRank(crashes) {
    if (crashes === 0) return '⭐ ЛЕГЕНДА';
    if (crashes === 1) return '🥇 МАСТЕР';
    if (crashes <= 3) return '🥈 ОПЫТНЫЙ';
    if (crashes <= 5) return '🥉 НОВИЧОК';
    return '💥 НУЖНЫ КУРСЫ ВОЖДЕНИЯ';
}

function getResultMessage(crashes, finalPrice, startPrice) {
    var diff = finalPrice - startPrice;
    if (crashes === 0) return 'Идеальное вождение! Твой КБМ остался без изменений. Полис дешевле некуда!';
    if (diff < 1000) return 'Неплохо, но есть куда стремиться. Всего ' + crashes + ' авария — полис подорожал несильно.';
    if (diff < 3000) return 'Осторожнее на дороге! ' + crashes + ' аварий заметно ударили по карману. Полис подорожал на ' + formatPrice(diff) + '.';
    return 'Катастрофа! ' + crashes + ' аварий — полис подорожал на ' + formatPrice(diff) + '. В следующий раз внимательнее!';
}

// События
inputs.city.addEventListener('change', updatePreviewPrice);
inputs.experience.addEventListener('change', updatePreviewPrice);
inputs.power.addEventListener('change', updatePreviewPrice);

buttons.start.addEventListener('click', startGame);
buttons.restart.addEventListener('click', function() {
    showScreen('form');
    updatePreviewPrice();
});

if (buttons.share) {
    buttons.share.addEventListener('click', shareResult);
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        movePlayer('left');
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        movePlayer('right');
    }
});

touchZones.left.addEventListener('touchstart', function(e) {
    e.preventDefault();
    movePlayer('left');
});

touchZones.right.addEventListener('touchstart', function(e) {
    e.preventDefault();
    movePlayer('right');
});

touchZones.left.addEventListener('click', function(e) {
    e.preventDefault();
    movePlayer('left');
});

touchZones.right.addEventListener('click', function(e) {
    e.preventDefault();
    movePlayer('right');
});

updatePreviewPrice();
initVK();
```
