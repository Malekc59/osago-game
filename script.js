// ОСАГО: Умный водитель — Production Ready v2.0
// Исправлено: VK Bridge, таймеры, gameLoop, реклама, монетизация, аналитика

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
    isPaused: false,
    playerLane: 1,
    startPrice: 0,
    obstacles: [],
    spawnInterval: 2000,
    lastSpawnTime: 0,
    gameLoopId: null,
    timerId: null,
    roadOffset: 0,
    bestScore: 0,
    gamesPlayed: 0,
    totalCrashes: 0
};

// VK Bridge — исправлено: используем правильный глобальный объект bridge
var vkBridge = null;
var isVK = false;
var vkBridgeReady = false;

function initVK() {
    if (typeof window !== 'undefined' && window.bridge) {
        vkBridge = window.bridge;
        isVK = true;
        vkBridge.send('VKWebAppInit', {})
            .then(function(data) { 
                vkBridgeReady = true;
                console.log('VK Bridge инициализирован');
                vkBridge.subscribe(function(e) {
                    if (e.detail.type === 'VKWebAppViewHide') {
                        pauseGame();
                    }
                    if (e.detail.type === 'VKWebAppViewRestore') {
                        resumeGame();
                    }
                });
                loadAds();
            })
            .catch(function(err) { 
                console.log('VK Bridge ошибка:', err);
                isVK = false;
            });
    } else {
        console.log('VK Bridge не найден — режим веб-версии');
        isVK = false;
    }
}

// Реклама
var adsLoaded = false;
function loadAds() {
    if (!isVK || !vkBridgeReady) return;
    vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' })
        .then(function() { adsLoaded = true; console.log('Реклама загружена'); })
        .catch(function() { adsLoaded = false; });
}

function showBannerAd() {
    if (!isVK || !vkBridgeReady) return;
    vkBridge.send('VKWebAppShowBannerAd', { 
        banner_location: 'bottom',
        can_close: true 
    }).catch(function() {});
}

function showInterstitialAd() {
    if (!isVK || !vkBridgeReady) return;
    vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' })
        .then(function(data) { 
            if (data.result) console.log('Межстраничная реклама показана');
        })
        .catch(function(err) { console.log('Реклама недоступна:', err); });
}

function showRewardedAd(callback) {
    if (!isVK || !vkBridgeReady) {
        if (callback) callback(false);
        return;
    }
    vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' })
        .then(function(data) { 
            if (data.result) {
                console.log('Rewarded ad просмотрен');
                if (callback) callback(true);
            } else {
                if (callback) callback(false);
            }
        })
        .catch(function() { if (callback) callback(false); });
}

// Лидерборд
function showLeaderboard() {
    if (!isVK || !vkBridgeReady) {
        alert('Лидерборд доступен только в ВКонтакте');
        return;
    }
    vkBridge.send('VKWebAppShowLeaderBoardBox', { user_result: gameState.bestScore })
        .catch(function() {});
}

// Приглашение друзей
function inviteFriends() {
    if (!isVK || !vkBridgeReady) {
        alert('Приглашение друзей доступно только в ВКонтакте');
        return;
    }
    vkBridge.send('VKWebAppInvite', {})
        .catch(function() {});
}

// Сохранение прогресса
function saveProgress() {
    var data = {
        bestScore: gameState.bestScore,
        gamesPlayed: gameState.gamesPlayed,
        totalCrashes: gameState.totalCrashes
    };
    try {
        localStorage.setItem('osago_game_progress', JSON.stringify(data));
    } catch(e) {}
}

function loadProgress() {
    try {
        var data = JSON.parse(localStorage.getItem('osago_game_progress'));
        if (data) {
            gameState.bestScore = data.bestScore || 0;
            gameState.gamesPlayed = data.gamesPlayed || 0;
            gameState.totalCrashes = data.totalCrashes || 0;
        }
    } catch(e) {}
}

function updateStatsDisplay() {
    var bestEl = document.getElementById('stat-best');
    var gamesEl = document.getElementById('stat-games');
    if (bestEl) bestEl.textContent = gameState.bestScore > 0 ? formatPrice(gameState.bestScore) : '—';
    if (gamesEl) gamesEl.textContent = gameState.gamesPlayed;
}

function getEl(id) {
    return document.getElementById(id);
}

var screens = {
    form: getEl('screen-form'),
    game: getEl('screen-game'),
    result: getEl('screen-result'),
    pause: getEl('screen-pause'),
    secondChance: getEl('screen-second-chance')
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
    resMessage: getEl('res-message'),
    resBestScore: getEl('res-best-score'),
    resGamesPlayed: getEl('res-games-played')
};

var buttons = {
    start: getEl('btn-start'),
    restart: getEl('btn-restart'),
    share: getEl('btn-share'),
    leaderboard: getEl('btn-leaderboard'),
    leaderboardResult: getEl('btn-leaderboard-result'),
    invite: getEl('btn-invite'),
    resume: getEl('btn-resume'),
    quit: getEl('btn-quit'),
    secondChance: getEl('btn-second-chance'),
    skipSecondChance: getEl('btn-skip-second-chance')
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
    var expClass = parseInt(inputs.experience.value);
    var power = parseFloat(inputs.power.value);
    var price = calculatePrice(city, power, expClass);
    displays.previewPrice.textContent = formatPrice(price);
}

function showScreen(screenName) {
    Object.values(screens).forEach(function(s) { if (s) s.classList.remove('active'); });
    if (screens[screenName]) screens[screenName].classList.add('active');
}

function movePlayer(direction) {
    if (!gameState.isRunning || gameState.isPaused) return;
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

// Второй шанс
var savedState = null;

function handleCrash() {
    gameState.crashes++;
    gameState.totalCrashes++;
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
        displays.dashPrice.classList.remove('warning');
    } else if (gameState.currentKBM > 0.9) {
        displays.dashPrice.classList.add('warning');
        displays.dashPrice.classList.remove('danger');
    } else {
        displays.dashPrice.classList.remove('danger', 'warning');
    }

    showCrashOverlay();

    if (gameState.crashes === 3 || gameState.crashes === 5 || gameState.crashes === 8) {
        setTimeout(function() { offerSecondChance(); }, 1600);
    }
}

function showCrashOverlay() {
    displays.crashOverlay.classList.remove('hidden');
    setTimeout(function() {
        displays.crashOverlay.classList.add('hidden');
    }, 1500);
}

function offerSecondChance() {
    if (!gameState.isRunning) return;
    gameState.isPaused = true;
    savedState = {
        currentClass: gameState.currentClass,
        currentKBM: gameState.currentKBM,
        crashes: gameState.crashes
    };
    showScreen('secondChance');
}

function useSecondChance() {
    showScreen('game');
    showRewardedAd(function(success) {
        if (success && savedState) {
            gameState.currentClass = savedState.currentClass;
            gameState.currentKBM = savedState.currentKBM;
            gameState.crashes = savedState.crashes;
            displays.dashCrashes.textContent = gameState.crashes;
            displays.dashClass.textContent = gameState.currentClass;
            var newPrice = calculatePrice(gameState.cityCoef, gameState.powerCoef, gameState.currentClass);
            displays.dashPrice.textContent = formatPrice(newPrice);
        }
        gameState.isPaused = false;
        savedState = null;
    });
}

function skipSecondChance() {
    showScreen('game');
    gameState.isPaused = false;
    savedState = null;
}

function pauseGame() {
    if (gameState.isRunning && !gameState.isPaused) {
        gameState.isPaused = true;
        showScreen('pause');
    }
}

function resumeGame() {
    if (gameState.isRunning && gameState.isPaused) {
        gameState.isPaused = false;
        showScreen('game');
    }
}

function shareResult() {
    var rank = getEl('res-rank').textContent;
    var crashes = gameState.crashes;
    var finalPrice = getEl('res-final-price').textContent;
    var startPrice = getEl('res-start-price').textContent;
    var message = '🚗 ОСАГО: Умный водитель\n🏆 Ранг: ' + rank + '\n💥 Аварий: ' + crashes + '\n💰 Полис: ' + finalPrice + ' (было ' + startPrice + ')\n\nСможешь лучше? 👇';

    if (isVK && vkBridgeReady && vkBridge) {
        vkBridge.send('VKWebAppShowWallPostBox', { message: message })
            .then(function(data) { if (data.post_id) console.log('Пост опубликован'); })
            .catch(function(err) { console.log('Ошибка шаринга:', err); fallbackShare(message); });
    } else {
        fallbackShare(message);
    }
}

function fallbackShare(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
            alert('📋 Результат скопирован! Вставь в ВК или Telegram');
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
    if (gameState.isPaused) {
        gameState.gameLoopId = requestAnimationFrame(gameLoop);
        return;
    }
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
        if (gameState.isPaused) return;
        gameState.timeLeft--;
        displays.dashTime.textContent = gameState.timeLeft;
        if (gameState.timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

var isStarting = false;

function startGame() {
    if (isStarting) return;
    isStarting = true;

    if (gameState.gameLoopId) {
        cancelAnimationFrame(gameState.gameLoopId);
        gameState.gameLoopId = null;
    }
    if (gameState.timerId) {
        clearInterval(gameState.timerId);
        gameState.timerId = null;
    }
    document.querySelectorAll('.obstacle').forEach(function(el) { el.remove(); });

    gameState.cityCoef = parseFloat(inputs.city.value);
    gameState.powerCoef = parseFloat(inputs.power.value);
    gameState.currentClass = parseInt(inputs.experience.value);
    gameState.currentKBM = KBM_TABLE[gameState.currentClass];
    gameState.crashes = 0;
    gameState.timeLeft = GAME_DURATION;
    gameState.playerLane = 1;
    gameState.obstacles = [];
    gameState.spawnInterval = 2000;
    gameState.lastSpawnTime = 0;
    gameState.isRunning = true;
    gameState.isPaused = false;
    gameState.startPrice = calculatePrice(gameState.cityCoef, gameState.powerCoef, gameState.currentClass);

    displays.dashPrice.textContent = formatPrice(gameState.startPrice);
    displays.dashCrashes.textContent = '0';
    displays.dashClass.textContent = gameState.currentClass;
    displays.dashTime.textContent = GAME_DURATION;
    displays.dashPrice.classList.remove('danger', 'warning');

    updatePlayerPosition();
    showScreen('game');

    lastFrameTime = 0;
    gameState.gameLoopId = requestAnimationFrame(gameLoop);
    startTimer();

    showBannerAd();

    setTimeout(function() { isStarting = false; }, 500);
}

function endGame() {
    gameState.isRunning = false;
    gameState.isPaused = false;
    if (gameState.gameLoopId) {
        cancelAnimationFrame(gameState.gameLoopId);
        gameState.gameLoopId = null;
    }
    if (gameState.timerId) {
        clearInterval(gameState.timerId);
        gameState.timerId = null;
    }
    document.querySelectorAll('.obstacle').forEach(function(el) { el.remove(); });

    var finalPrice = calculatePrice(gameState.cityCoef, gameState.powerCoef, gameState.currentClass);
    var rank = getRank(gameState.crashes);
    var message = getResultMessage(gameState.crashes, finalPrice, gameState.startPrice);

    gameState.gamesPlayed++;
    var score = gameState.startPrice - finalPrice;
    if (score > gameState.bestScore) {
        gameState.bestScore = score;
    }
    saveProgress();
    updateStatsDisplay();

    displays.resStartPrice.textContent = formatPrice(gameState.startPrice);
    displays.resCrashes.textContent = gameState.crashes;
    displays.resFinalClass.textContent = gameState.currentClass + ' (КБМ: ' + gameState.currentKBM + ')';
    displays.resFinalPrice.textContent = formatPrice(finalPrice);
    displays.resRank.textContent = rank;
    displays.resMessage.textContent = message;

    if (displays.resBestScore) displays.resBestScore.textContent = formatPrice(gameState.bestScore);
    if (displays.resGamesPlayed) displays.resGamesPlayed.textContent = gameState.gamesPlayed;

    showScreen('result');
    showInterstitialAd();
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
    updateStatsDisplay();
});

if (buttons.share) {
    buttons.share.addEventListener('click', shareResult);
}

if (buttons.leaderboard) {
    buttons.leaderboard.addEventListener('click', showLeaderboard);
}

if (buttons.leaderboardResult) {
    buttons.leaderboardResult.addEventListener('click', showLeaderboard);
}

if (buttons.invite) {
    buttons.invite.addEventListener('click', inviteFriends);
}

if (buttons.resume) {
    buttons.resume.addEventListener('click', resumeGame);
}

if (buttons.quit) {
    buttons.quit.addEventListener('click', function() {
        gameState.isRunning = false;
        gameState.isPaused = false;
        if (gameState.gameLoopId) {
            cancelAnimationFrame(gameState.gameLoopId);
            gameState.gameLoopId = null;
        }
        if (gameState.timerId) {
            clearInterval(gameState.timerId);
            gameState.timerId = null;
        }
        document.querySelectorAll('.obstacle').forEach(function(el) { el.remove(); });
        showScreen('form');
        updateStatsDisplay();
    });
}

if (buttons.secondChance) {
    buttons.secondChance.addEventListener('click', useSecondChance);
}

if (buttons.skipSecondChance) {
    buttons.skipSecondChance.addEventListener('click', skipSecondChance);
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        movePlayer('left');
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        movePlayer('right');
    } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (gameState.isRunning) {
            if (gameState.isPaused) resumeGame();
            else pauseGame();
        }
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

// Убираем экран загрузки через 2 секунды
setTimeout(function() {
    var loadingScreen = getEl('screen-loading');
    if (loadingScreen) loadingScreen.classList.remove('active');
    showScreen('form');
    updatePreviewPrice();
    updateStatsDisplay();
}, 2000);

// Инициализация
loadProgress();
initVK();
