(function (global) {
  "use strict";

  function createUI(player, enemies, options) {
    if (!player || typeof player.update !== "function" || typeof player.setPaused !== "function") {
      throw new TypeError("CraftUI.createUI يتطلب لاعباً يدعم الإيقاف والتحديث.");
    }
    if (
      !enemies ||
      typeof enemies.update !== "function" ||
      typeof enemies.getState !== "function" ||
      typeof enemies.setPaused !== "function" ||
      typeof enemies.restart !== "function"
    ) {
      throw new TypeError("CraftUI.createUI يتطلب نظام أعداء يدعم الإيقاف وإعادة اللعب.");
    }

    const settings = Object.assign({
      stylesheetUrl: "style.css",
      storageKey: "craft-island-best-score",
      onStateChange: null
    }, options || {});
    const states = ["start", "playing", "paused", "gameover"];
    let state = "start";
    let score = 0;
    let bestScore = 0;
    let soundEnabled = true;
    let disposed = false;
    let audioContext = null;
    let storageAvailable = true;
    const soundTimers = new Set();

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = settings.stylesheetUrl;
    stylesheet.dataset.craftUi = "";
    document.head.appendChild(stylesheet);

    const root = document.createElement("div");
    root.className = "craft-ui";
    root.dataset.state = state;
    root.innerHTML = `
      <div class="craft-ui-scorebar" aria-label="النتيجة">
        <span>⭐ النتيجة <strong data-current-score>0</strong></span>
        <span>🏆 الأفضل <strong data-best-score>0</strong></span>
      </div>
      <button class="craft-ui-sound" type="button" data-sound aria-pressed="false" aria-label="كتم الصوت">🔊 الصوت</button>
      <section class="craft-ui-screen" data-screen="start" role="dialog" aria-modal="true" aria-labelledby="craft-ui-title">
        <div class="craft-ui-card craft-ui-start-card">
          <div class="craft-ui-eyebrow">عالمك، مغامرتك</div>
          <h1 id="craft-ui-title">جزيرة المكعبات</h1>
          <p class="craft-ui-lead">ابنِ، استكشف، واجمع الكريستالات في جزيرتك الملونة.</p>
          <div class="craft-ui-howto">
            <h2>طريقة اللعب</h2>
            <ul>
              <li><kbd>W A S D</kbd> أو الأسهم للحركة، و<kbd>Space</kbd> للقفز.</li>
              <li>حرّك الماوس للنظر، وانقر لبدء التحكم.</li>
              <li><kbd>Q</kbd> للتبديل بين البناء ومسدس الطاقة.</li>
              <li>في وضع البناء: الأيسر للهدم، والأيمن لوضع المكعب.</li>
              <li>في وضع الطاقة: انقر لإطلاق الكرات الضوئية على السلايم.</li>
              <li>اجمع الكريستالات وتفادَ لمس السلايم لتحافظ على صحتك.</li>
            </ul>
          </div>
          <button class="craft-ui-primary" type="button" data-start>ابدأ المغامرة</button>
        </div>
      </section>
      <section class="craft-ui-screen" data-screen="paused" role="dialog" aria-modal="true" aria-labelledby="craft-ui-pause-title" hidden>
        <div class="craft-ui-card craft-ui-compact-card">
          <div class="craft-ui-illustration" aria-hidden="true">⏸️</div>
          <h2 id="craft-ui-pause-title">اللعبة متوقفة</h2>
          <p>خذ وقتك، جزيرتك بانتظارك.</p>
          <button class="craft-ui-primary" type="button" data-resume>متابعة اللعب</button>
          <button class="craft-ui-secondary" type="button" data-home>العودة للبداية</button>
        </div>
      </section>
      <section class="craft-ui-screen" data-screen="gameover" role="dialog" aria-modal="true" aria-labelledby="craft-ui-end-title" hidden>
        <div class="craft-ui-card craft-ui-compact-card">
          <div class="craft-ui-illustration" aria-hidden="true">🌈</div>
          <h2 id="craft-ui-end-title">انتهت الجولة</h2>
          <p>أحسنت! كل مغامرة تجعل مهاراتك أقوى.</p>
          <div class="craft-ui-results">
            <span>نتيجتك</span><strong data-final-score>0</strong>
            <span>أعلى نتيجة</span><strong data-final-best>0</strong>
          </div>
          <button class="craft-ui-primary" type="button" data-restart>العب من جديد</button>
          <button class="craft-ui-secondary" type="button" data-home>العودة للبداية</button>
        </div>
      </section>
      <div class="craft-ui-sr-only" data-status role="status" aria-live="polite"></div>`;
    document.body.appendChild(root);

    const scoreValue = root.querySelector("[data-current-score]");
    const bestValue = root.querySelector("[data-best-score]");
    const finalScore = root.querySelector("[data-final-score]");
    const finalBest = root.querySelector("[data-final-best]");
    const status = root.querySelector("[data-status]");
    const soundButton = root.querySelector("[data-sound]");
    const screens = new Map(
      Array.from(root.querySelectorAll("[data-screen]")).map(screen => [screen.dataset.screen, screen])
    );

    function readBestScore() {
      try {
        const stored = Number(global.localStorage.getItem(settings.storageKey));
        return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
      } catch (error) {
        storageAvailable = false;
        console.warn("تعذر قراءة أفضل نتيجة المحفوظة:", error);
        return 0;
      }
    }

    function saveBestScore(value) {
      if (!storageAvailable) return;
      try {
        global.localStorage.setItem(settings.storageKey, String(value));
      } catch (error) {
        storageAvailable = false;
        console.warn("تعذر حفظ أفضل نتيجة:", error);
        status.textContent = "تعذر حفظ أفضل نتيجة على هذا الجهاز.";
      }
    }

    bestScore = readBestScore();
    bestValue.textContent = String(bestScore);
    finalBest.textContent = String(bestScore);

    function getAudioContext() {
      if (!soundEnabled) return null;
      if (audioContext) return audioContext;
      const AudioContextConstructor = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextConstructor) {
        soundEnabled = false;
        updateSoundButton();
        status.textContent = "الصوت غير مدعوم في هذا المتصفح.";
        return null;
      }
      audioContext = new AudioContextConstructor();
      return audioContext;
    }

    function tone(frequency, duration, shape, volume) {
      const context = getAudioContext();
      if (!context) return;
      if (context.state === "suspended") {
        context.resume().catch(error => console.warn("تعذر تشغيل الصوت:", error));
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = shape || "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume || 0.09, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    function playSound(name) {
      if (!soundEnabled) return;
      const cues = {
        start: [[440, 0.13], [660, 0.18]],
        pause: [[330, 0.17]],
        resume: [[523, 0.14], [784, 0.16]],
        gameover: [[392, 0.16], [294, 0.24]],
        shot: [[720, 0.07, "triangle", 0.05]],
        "slime-pop": [[580, 0.1, "sine", 0.06], [880, 0.13, "sine", 0.06]],
        crystal: [[880, 0.11], [1175, 0.18]],
        wave: [[440, 0.1], [587, 0.1], [740, 0.16]],
        "player-hit": [[190, 0.18, "triangle", 0.07]]
      };
      const notes = cues[name];
      if (!notes) return;
      notes.forEach((note, index) => {
        const timer = global.setTimeout(() => {
          soundTimers.delete(timer);
          tone(note[0], note[1], note[2], note[3]);
        }, index * 95);
        soundTimers.add(timer);
      });
    }

    function updateSoundButton() {
      soundButton.textContent = soundEnabled ? "🔊 الصوت" : "🔇 مكتوم";
      soundButton.setAttribute("aria-pressed", String(!soundEnabled));
      soundButton.setAttribute("aria-label", soundEnabled ? "كتم الصوت" : "تشغيل الصوت");
    }

    function setState(nextState) {
      if (!states.includes(nextState)) throw new TypeError(`حالة واجهة غير معروفة: ${nextState}`);
      if (state === nextState) return;
      state = nextState;
      root.dataset.state = state;
      for (const [name, screen] of screens) {
        screen.hidden = name !== state || state === "playing";
      }
      const isPlaying = state === "playing";
      player.setPaused(!isPlaying);
      enemies.setPaused(!isPlaying);
      if (typeof settings.onStateChange === "function") settings.onStateChange(state);
    }

    function begin(restarting) {
      if (disposed) return;
      if (restarting) {
        enemies.restart();
        score = 0;
        scoreValue.textContent = "0";
      }
      setState("playing");
      playSound(restarting ? "resume" : "start");
      status.textContent = "بدأت المغامرة.";
      if (typeof player.requestPointerLock === "function") player.requestPointerLock();
    }

    function pause() {
      if (state !== "playing") return false;
      setState("paused");
      if (global.document.pointerLockElement && typeof global.document.exitPointerLock === "function") {
        global.document.exitPointerLock();
      }
      playSound("pause");
      status.textContent = "اللعبة متوقفة مؤقتاً.";
      screens.get("paused").querySelector("[data-resume]").focus();
      return true;
    }

    function finish() {
      if (state === "gameover") return;
      const result = enemies.getState();
      score = Number.isFinite(result.score) ? result.score : Math.max(0, (result.wave - 1) * 100 + result.crystals * 25);
      if (score > bestScore) {
        bestScore = score;
        bestValue.textContent = String(bestScore);
        saveBestScore(bestScore);
      }
      finalScore.textContent = String(score);
      finalBest.textContent = String(bestScore);
      setState("gameover");
      playSound("gameover");
      status.textContent = `انتهت الجولة. نتيجتك ${score}.`;
      screens.get("gameover").querySelector("[data-restart]").focus();
    }

    function goHome() {
      if (state === "gameover") enemies.restart();
      score = 0;
      scoreValue.textContent = "0";
      setState("start");
      status.textContent = "شاشة البداية.";
      screens.get("start").querySelector("[data-start]").focus();
    }

    function handleKeyDown(event) {
      if (event.code !== "Escape" || event.repeat) return;
      if (state === "playing") {
        event.preventDefault();
        event.stopPropagation();
        pause();
      } else if (state === "paused") {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function handlePointerLockChange() {
      if (state === "playing" && !global.document.pointerLockElement) pause();
    }

    function handleGameEvent(event) {
      if (event.detail && Number.isFinite(event.detail.score)) {
        score = event.detail.score;
        scoreValue.textContent = String(score);
      }
      playSound(event.type.slice("craft:".length));
    }

    function update(deltaTime) {
      if (disposed || state !== "playing") return;
      player.update(deltaTime);
      enemies.update(deltaTime);
      const gameState = enemies.getState();
      if (Number.isFinite(gameState.score)) {
        score = gameState.score;
        scoreValue.textContent = String(score);
      }
      if (gameState.gameOver) finish();
    }

    function handleStart() {
      begin(false);
    }

    function handleResume() {
      begin(false);
    }

    function handleRestart() {
      begin(true);
    }

    function handleSoundToggle() {
      soundEnabled = !soundEnabled;
      updateSoundButton();
      if (soundEnabled) playSound("resume");
      else if (audioContext && audioContext.state === "running") {
        audioContext.suspend().catch(error => console.warn("تعذر كتم الصوت:", error));
      }
    }

    const homeButtons = Array.from(root.querySelectorAll("[data-home]"));
    root.querySelector("[data-start]").addEventListener("click", handleStart);
    root.querySelector("[data-resume]").addEventListener("click", handleResume);
    root.querySelector("[data-restart]").addEventListener("click", handleRestart);
    homeButtons.forEach(button => button.addEventListener("click", goHome));
    soundButton.addEventListener("click", handleSoundToggle);
    global.addEventListener("keydown", handleKeyDown, true);
    global.document.addEventListener("pointerlockchange", handlePointerLockChange);
    [
      "shot",
      "slime-pop",
      "crystal",
      "wave",
      "player-hit"
    ].forEach(name => global.addEventListener(`craft:${name}`, handleGameEvent));

    if (typeof enemies.setGameOverScreen === "function") enemies.setGameOverScreen(false);
    player.setPaused(true);
    enemies.setPaused(true);
    updateSoundButton();
    setState("start");

    function dispose() {
      if (disposed) return;
      disposed = true;
      root.querySelector("[data-start]").removeEventListener("click", handleStart);
      root.querySelector("[data-resume]").removeEventListener("click", handleResume);
      root.querySelector("[data-restart]").removeEventListener("click", handleRestart);
      homeButtons.forEach(button => button.removeEventListener("click", goHome));
      soundButton.removeEventListener("click", handleSoundToggle);
      global.removeEventListener("keydown", handleKeyDown, true);
      global.document.removeEventListener("pointerlockchange", handlePointerLockChange);
      ["shot", "slime-pop", "crystal", "wave", "player-hit"]
        .forEach(name => global.removeEventListener(`craft:${name}`, handleGameEvent));
      if (typeof enemies.setGameOverScreen === "function") enemies.setGameOverScreen(true);
      soundTimers.forEach(timer => global.clearTimeout(timer));
      soundTimers.clear();
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(error => console.warn("تعذر إغلاق الصوت:", error));
      }
      root.remove();
      stylesheet.remove();
    }

    return {
      update,
      start: () => begin(false),
      pause,
      resume: () => begin(false),
      restart: () => begin(true),
      getState: () => state,
      getScore: () => score,
      getBestScore: () => bestScore,
      isSoundEnabled: () => soundEnabled,
      playSound,
      dispose
    };
  }

  global.CraftUI = Object.assign(global.CraftUI || {}, { createUI });
})(globalThis);
