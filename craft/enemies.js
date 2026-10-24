(function (global) {
  "use strict";

  function createEnemies(scene, camera, pointerLockElement, world, player, options) {
    if (!global.THREE) throw new Error("حمّل Three.js قبل ملف enemies.js.");
    if (!scene || !scene.isScene) throw new TypeError("createEnemies يتطلب THREE.Scene.");
    if (!camera || !camera.isCamera) throw new TypeError("createEnemies يتطلب كاميرا Three.js.");
    if (!pointerLockElement || typeof pointerLockElement.addEventListener !== "function") {
      throw new TypeError("createEnemies يتطلب عنصر عرض اللعبة.");
    }
    if (!world || typeof world.getHeightAt !== "function") {
      throw new TypeError("createEnemies يتطلب كائناً من CraftWorld.createWorld.");
    }
    if (!player || typeof player.getPosition !== "function" || typeof player.setInteractionMode !== "function") {
      throw new TypeError("createEnemies يتطلب لاعباً يدعم تبديل وضع التفاعل.");
    }

    const THREE = global.THREE;
    const settings = Object.assign({
      maxHealth: 100,
      magazineSize: 12,
      fireCooldown: 0.28,
      reloadDuration: 1.15,
      playerHitDamage: 18,
      playerHitCooldown: 1.2,
      spawnDistanceMin: 9,
      spawnDistanceMax: 14,
      seed: 8317,
      onHealthChange: null,
      onAmmoChange: null,
      onWaveChange: null,
      onCrystalCollected: null,
      onModeChange: null,
      onGameOver: null
    }, options || {});

    const root = new THREE.Group();
    root.name = "voxel-enemies";
    const slimeGroup = new THREE.Group();
    slimeGroup.name = "friendly-slimes";
    const projectileGroup = new THREE.Group();
    projectileGroup.name = "energy-projectiles";
    const effectGroup = new THREE.Group();
    effectGroup.name = "slime-sparkles";
    root.add(slimeGroup, projectileGroup, effectGroup);
    scene.add(root);

    const bodyGeometry = new THREE.BoxGeometry(0.9, 0.78, 0.82);
    const eyeGeometry = new THREE.SphereGeometry(0.13, 12, 10);
    const pupilGeometry = new THREE.SphereGeometry(0.06, 10, 8);
    const projectileGeometry = new THREE.SphereGeometry(0.13, 12, 10);
    const glowGeometry = new THREE.SphereGeometry(0.24, 10, 8);
    const crystalGeometry = new THREE.OctahedronGeometry(0.22, 0);
    const particleGeometry = new THREE.SphereGeometry(0.055, 6, 5);
    const gunBodyGeometry = new THREE.BoxGeometry(0.25, 0.16, 0.44);
    const gunGripGeometry = new THREE.BoxGeometry(0.13, 0.22, 0.16);
    const gunBarrelGeometry = new THREE.CylinderGeometry(0.055, 0.075, 0.3, 10);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: "#fffdf6" });
    const pupilMaterial = new THREE.MeshBasicMaterial({ color: "#273447" });
    const smileMaterial = new THREE.LineBasicMaterial({ color: "#273447" });
    const gunMaterial = new THREE.MeshStandardMaterial({
      color: "#273b48",
      metalness: 0.62,
      roughness: 0.3,
      emissive: "#087f9e",
      emissiveIntensity: 0.28
    });
    const gunGlowMaterial = new THREE.MeshBasicMaterial({
      color: "#83f3ff",
      blending: THREE.AdditiveBlending
    });
    const projectileMaterial = new THREE.MeshBasicMaterial({
      color: "#b9f6ff",
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    });
    const projectileGlowMaterial = new THREE.MeshBasicMaterial({
      color: "#58d9ff",
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.26,
      depthWrite: false
    });
    const slimeColors = ["#73dfba", "#a992f5", "#ffad85", "#72c9ee", "#f08ec2", "#d7db71"];
    const crystalColors = ["#69efff", "#c4a1ff", "#ffe078", "#83f2b4"];
    const slimes = [];
    const projectiles = [];
    const particles = [];
    const crystals = [];
    let randomState = settings.seed >>> 0 || 8317;
    let health = settings.maxHealth;
    let ammo = settings.magazineSize;
    let wave = 0;
    let crystalCount = 0;
    let score = 0;
    let interactionMode = "build";
    let paused = false;
    let fireCooldown = 0;
    let reloadTimer = 0;
    let hitCooldown = 0;
    let nextWaveTimer = 0;
    let gameOver = false;
    let disposed = false;
    let announcementTimer = 0;
    let gunPulse = 0;
    let showGameOverScreen = true;

    const energyGun = new THREE.Group();
    energyGun.name = "energy-pistol";
    energyGun.position.set(0.38, -0.32, -0.72);
    energyGun.rotation.set(-0.04, 0.08, -0.025);
    const gunBody = new THREE.Mesh(gunBodyGeometry, gunMaterial);
    const gunGrip = new THREE.Mesh(gunGripGeometry, gunMaterial);
    gunGrip.position.set(0, -0.15, 0.1);
    gunGrip.rotation.x = -0.18;
    const gunBarrel = new THREE.Mesh(gunBarrelGeometry, gunMaterial);
    gunBarrel.rotation.x = -Math.PI / 2;
    gunBarrel.position.set(0, 0.015, -0.3);
    const muzzleGlow = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), gunGlowMaterial);
    muzzleGlow.position.set(0, 0.015, -0.47);
    energyGun.add(gunBody, gunGrip, gunBarrel, muzzleGlow);
    energyGun.visible = false;
    camera.add(energyGun);

    const uiStyle = document.createElement("style");
    uiStyle.dataset.craftEnemies = "";
    uiStyle.textContent = `
      .craft-enemies-hud {
        position: fixed;
        z-index: 9997;
        top: max(14px, env(safe-area-inset-top));
        right: max(14px, env(safe-area-inset-right));
        display: grid;
        width: min(260px, calc(100vw - 28px));
        gap: 9px;
        padding: 12px 14px;
        color: #f7fbf4;
        background: rgba(23, 38, 43, .78);
        border: 1px solid rgba(255, 255, 255, .24);
        border-radius: 15px;
        box-shadow: 0 8px 24px rgba(13, 27, 32, .23);
        backdrop-filter: blur(9px);
        -webkit-backdrop-filter: blur(9px);
        direction: rtl;
        font: 13px/1.4 Tahoma, Arial, sans-serif;
        pointer-events: none;
      }
      .craft-enemies-hud-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .craft-enemies-health-track {
        height: 10px;
        margin-top: 5px;
        overflow: hidden;
        background: rgba(255, 255, 255, .2);
        border-radius: 99px;
      }
      .craft-enemies-health-fill {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, #49dc93, #9be27a);
        border-radius: inherit;
        transition: width .18s ease, background .18s ease;
      }
      .craft-enemies-mode {
        color: #ffe38a;
        font-weight: 700;
      }
      .craft-enemies-toast {
        position: fixed;
        z-index: 9997;
        top: 22%;
        left: 50%;
        padding: 10px 18px;
        color: #fff;
        background: rgba(30, 44, 49, .78);
        border: 1px solid rgba(255, 255, 255, .28);
        border-radius: 999px;
        opacity: 0;
        transform: translate(-50%, -8px);
        transition: opacity .2s ease, transform .2s ease;
        pointer-events: none;
        font: 700 17px Tahoma, Arial, sans-serif;
        white-space: nowrap;
      }
      .craft-enemies-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      .craft-enemies-gameover {
        position: fixed;
        z-index: 10001;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(15, 27, 32, .58);
        direction: rtl;
        font-family: Tahoma, Arial, sans-serif;
      }
      .craft-enemies-gameover[hidden] { display: none; }
      .craft-enemies-gameover-card {
        width: min(360px, 100%);
        padding: 24px;
        color: #27383a;
        background: #fffdf4;
        border-radius: 22px;
        box-shadow: 0 18px 55px rgba(0, 0, 0, .3);
        text-align: center;
      }
      .craft-enemies-gameover-card h2 { margin: 0 0 8px; }
      .craft-enemies-gameover-card p { margin: 0 0 18px; color: #59676a; }
      .craft-enemies-restart {
        padding: 11px 20px;
        color: #173b34;
        background: #aaf0cb;
        border: 0;
        border-radius: 12px;
        cursor: pointer;
        font: 700 14px Tahoma, Arial, sans-serif;
      }
      @media (max-width: 420px) {
        .craft-enemies-hud { top: max(8px, env(safe-area-inset-top)); right: 8px; width: min(230px, calc(100vw - 16px)); padding: 9px 11px; }
      }
    `;
    document.head.appendChild(uiStyle);

    const hud = document.createElement("section");
    hud.className = "craft-enemies-hud";
    hud.setAttribute("aria-label", "حالة اللعب");
    hud.innerHTML = `
      <div>
        <div class="craft-enemies-hud-row"><span>💚 الصحة</span><span data-health-text></span></div>
        <div class="craft-enemies-health-track" role="meter" aria-label="صحة اللاعب" aria-valuemin="0" aria-valuemax="${settings.maxHealth}">
          <div class="craft-enemies-health-fill" data-health-fill></div>
        </div>
      </div>
      <div class="craft-enemies-hud-row"><span data-wave>🌊 الموجة 1</span><span data-ammo>🔆 ${ammo}/${settings.magazineSize}</span></div>
      <div class="craft-enemies-hud-row"><span>💎 كريستالات</span><span data-crystals>0</span></div>
      <div class="craft-enemies-hud-row"><span class="craft-enemies-mode" data-mode>🧱 وضع البناء</span><span>Q للتبديل</span></div>`;
    document.body.appendChild(hud);

    const healthText = hud.querySelector("[data-health-text]");
    const healthFill = hud.querySelector("[data-health-fill]");
    const healthMeter = hud.querySelector('[role="meter"]');
    const waveText = hud.querySelector("[data-wave]");
    const ammoText = hud.querySelector("[data-ammo]");
    const crystalText = hud.querySelector("[data-crystals]");
    const modeText = hud.querySelector("[data-mode]");
    const toast = document.createElement("div");
    toast.className = "craft-enemies-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);

    const gameOverPanel = document.createElement("div");
    gameOverPanel.className = "craft-enemies-gameover";
    gameOverPanel.hidden = true;
    gameOverPanel.innerHTML = `<div class="craft-enemies-gameover-card"><h2>استراحة قصيرة 🌿</h2><p>انتهت طاقة اللاعب. خذ نفساً ثم جرّب من جديد!</p><button class="craft-enemies-restart" type="button">العب من جديد</button></div>`;
    document.body.appendChild(gameOverPanel);
    const restartButton = gameOverPanel.querySelector("button");

    function random() {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    function announce(name, detail) {
      global.dispatchEvent(new CustomEvent(`craft:${name}`, { detail }));
    }

    function updateHealthUI() {
      const ratio = Math.max(0, health / settings.maxHealth);
      healthText.textContent = `${Math.ceil(health)} / ${settings.maxHealth}`;
      healthFill.style.width = `${ratio * 100}%`;
      healthFill.style.background = ratio <= 0.28
        ? "linear-gradient(90deg, #f17476, #ffb06e)"
        : ratio <= 0.55
          ? "linear-gradient(90deg, #f3b24e, #f6d86a)"
          : "linear-gradient(90deg, #49dc93, #9be27a)";
      healthMeter.setAttribute("aria-valuenow", String(Math.ceil(health)));
      if (typeof settings.onHealthChange === "function") settings.onHealthChange(health, settings.maxHealth);
    }

    function updateAmmoUI() {
      ammoText.textContent = reloadTimer > 0
        ? "⏳ إعادة الشحن"
        : `🔆 ${ammo}/${settings.magazineSize}`;
      if (typeof settings.onAmmoChange === "function") {
        settings.onAmmoChange({ ammo, capacity: settings.magazineSize, reloading: reloadTimer > 0 });
      }
    }

    function setMode(mode) {
      interactionMode = mode;
      player.setInteractionMode(mode);
      energyGun.visible = mode === "energy";
      modeText.textContent = mode === "energy" ? "🔆 مسدس الطاقة" : "🧱 وضع البناء";
      modeText.style.color = mode === "energy" ? "#a7edff" : "#ffe38a";
      if (typeof settings.onModeChange === "function") settings.onModeChange(mode);
    }

    function showToast(message, seconds) {
      toast.textContent = message;
      toast.classList.add("is-visible");
      announcementTimer = seconds || 1.8;
    }

    function makeSmile() {
      const points = [
        new THREE.Vector3(-0.095, -0.09, 0.405),
        new THREE.Vector3(-0.055, -0.125, 0.424),
        new THREE.Vector3(0, -0.14, 0.43),
        new THREE.Vector3(0.055, -0.125, 0.424),
        new THREE.Vector3(0.095, -0.09, 0.405)
      ];
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), smileMaterial);
    }

    function createSlime(index) {
      const color = slimeColors[(wave + index + Math.floor(random() * slimeColors.length)) % slimeColors.length];
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.34,
        metalness: 0,
        emissive: color,
        emissiveIntensity: 0.14
      });
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, material);
      body.castShadow = true;
      body.receiveShadow = true;
      body.position.y = 0.39;
      body.scale.set(1, 0.9, 1);
      group.add(body);

      for (const eyeX of [-0.2, 0.2]) {
        const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        eye.position.set(eyeX, 0.52, 0.375);
        group.add(eye);
        const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
        pupil.position.set(eyeX, 0.51, 0.49);
        group.add(pupil);
      }
      group.add(makeSmile());
      slimeGroup.add(group);

      const spawn = findSpawnPoint();
      group.position.set(spawn.x, spawn.y, spawn.z);
      return {
        group,
        body,
        material,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        verticalVelocity: 0,
        hopTimer: random() * 0.8,
        radius: 0.62,
        phase: random() * Math.PI * 2,
        color
      };
    }

    function findSpawnPoint() {
      const playerPosition = player.getPosition(new THREE.Vector3());
      for (let attempt = 0; attempt < 45; attempt++) {
        const angle = random() * Math.PI * 2;
        const distance = settings.spawnDistanceMin + random() * (settings.spawnDistanceMax - settings.spawnDistanceMin);
        const x = Math.round(playerPosition.x + Math.cos(angle) * distance);
        const z = Math.round(playerPosition.z + Math.sin(angle) * distance);
        const height = world.getHeightAt(x, z);
        if (height !== null) return { x, y: height, z };
      }
      const x = Math.max(-14, Math.min(13, Math.round(playerPosition.x + settings.spawnDistanceMin)));
      const z = Math.max(-14, Math.min(13, Math.round(playerPosition.z)));
      return { x, y: world.getHeightAt(x, z) || world.seaLevel || 1.35, z };
    }

    function spawnWave() {
      if (gameOver || disposed) return;
      wave += 1;
      const count = Math.min(2 + wave, 10);
      for (let index = 0; index < count; index++) slimes.push(createSlime(index));
      ammo = settings.magazineSize;
      reloadTimer = 0;
      nextWaveTimer = 0;
      updateAmmoUI();
      waveText.textContent = `🌊 الموجة ${wave} · ${count} سلايم`;
      showToast(`الموجة ${wave} بدأت!`, 2);
      announce("wave", { wave, count });
      if (typeof settings.onWaveChange === "function") settings.onWaveChange(wave, count);
    }

    function removeSlime(slime) {
      slimeGroup.remove(slime.group);
      slime.group.traverse(object => {
        if (object.isLine && object.geometry) object.geometry.dispose();
      });
      slime.material.dispose();
      const index = slimes.indexOf(slime);
      if (index >= 0) slimes.splice(index, 1);
    }

    function createCrystal(x, y, z) {
      const color = crystalColors[Math.floor(random() * crystalColors.length)];
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.8,
        roughness: 0.22,
        metalness: 0.12
      });
      const mesh = new THREE.Mesh(crystalGeometry, material);
      mesh.position.set(x, y + 0.35, z);
      mesh.castShadow = true;
      effectGroup.add(mesh);
      crystals.push({ mesh, material, x, y: y + 0.35, z, phase: random() * Math.PI * 2 });
    }

    function burstSlime(slime) {
      const palette = [slime.color, "#fff0a7", "#d8faff", "#ffffff"];
      for (let index = 0; index < 16; index++) {
        const material = new THREE.MeshBasicMaterial({
          color: palette[Math.floor(random() * palette.length)],
          transparent: true,
          opacity: 0.95
        });
        const mesh = new THREE.Mesh(particleGeometry, material);
        mesh.position.set(slime.x, slime.y + 0.45, slime.z);
        effectGroup.add(mesh);
        particles.push({
          mesh,
          material,
          velocity: new THREE.Vector3((random() - 0.5) * 4, 1.2 + random() * 3, (random() - 0.5) * 4),
          life: 0.65 + random() * 0.45,
          maxLife: 1.1
        });
      }
      createCrystal(slime.x, slime.y, slime.z);
      score += 100;
      announce("slime-pop", { score });
      removeSlime(slime);
    }

    function shoot() {
      if (disposed || gameOver || interactionMode !== "energy" || reloadTimer > 0 || fireCooldown > 0) return false;
      if (ammo <= 0) {
        reloadTimer = settings.reloadDuration;
        updateAmmoUI();
        return false;
      }

      ammo -= 1;
      fireCooldown = settings.fireCooldown;
      updateAmmoUI();
      announce("shot", { ammo });
      camera.updateMatrixWorld(true);
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction).normalize();
      const origin = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 0.65);
      const ball = new THREE.Group();
      const core = new THREE.Mesh(projectileGeometry, projectileMaterial);
      const glow = new THREE.Mesh(glowGeometry, projectileGlowMaterial);
      ball.add(glow, core);
      ball.position.copy(origin);
      projectileGroup.add(ball);
      projectiles.push({ mesh: ball, position: origin, velocity: direction.multiplyScalar(22), life: 2.2 });
      gunPulse = 0.12;
      if (ammo === 0) reloadTimer = settings.reloadDuration;
      updateAmmoUI();
      return true;
    }

    function handlePointerDown(event) {
      if (interactionMode !== "energy" || event.button !== 0) return;
      if (document.pointerLockElement !== pointerLockElement) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      shoot();
    }

    function handleContextMenu(event) {
      if (interactionMode === "energy") event.preventDefault();
    }

    function toggleMode() {
      if (gameOver || disposed) return interactionMode;
      setMode(interactionMode === "build" ? "energy" : "build");
      return interactionMode;
    }

    function handleKeyDown(event) {
      if (event.code !== "KeyQ" || event.repeat) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable='true']")) return;
      event.preventDefault();
      toggleMode();
    }

    function handleKeyUp(event) {
      if (event.code === "KeyQ") event.preventDefault();
    }

    function damagePlayer() {
      if (hitCooldown > 0 || gameOver) return;
      hitCooldown = settings.playerHitCooldown;
      health = Math.max(0, health - settings.playerHitDamage);
      updateHealthUI();
      announce("player-hit", { health });
      showToast("لمسة سلايم! خذ مسافة 🌟", 1.1);
      if (health === 0) endGame();
    }

    function endGame() {
      if (gameOver) return;
      gameOver = true;
      gameOverPanel.hidden = !showGameOverScreen;
      announce("game-over", { wave, crystals: crystalCount, score });
      if (document.pointerLockElement === pointerLockElement && typeof document.exitPointerLock === "function") {
        document.exitPointerLock();
      }
      if (typeof settings.onGameOver === "function") settings.onGameOver({ wave, crystals: crystalCount });
    }

    function restart() {
      slimes.slice().forEach(removeSlime);
      projectiles.splice(0).forEach(projectile => {
        projectileGroup.remove(projectile.mesh);
      });
      crystals.splice(0).forEach(crystal => {
        effectGroup.remove(crystal.mesh);
        crystal.material.dispose();
      });
      particles.splice(0).forEach(particle => {
        effectGroup.remove(particle.mesh);
        particle.material.dispose();
      });
      health = settings.maxHealth;
      ammo = settings.magazineSize;
      wave = 0;
      gameOver = false;
      reloadTimer = 0;
      hitCooldown = 0;
      fireCooldown = 0;
      crystalCount = 0;
      score = 0;
      paused = false;
      crystalText.textContent = "0";
      gameOverPanel.hidden = true;
      updateHealthUI();
      updateAmmoUI();
      spawnWave();
    }

    function updateSlimes(deltaTime, playerPosition) {
      for (const slime of slimes.slice()) {
        const dx = playerPosition.x - slime.x;
        const dz = playerPosition.z - slime.z;
        const distance = Math.hypot(dx, dz);
        if (distance < slime.radius + 0.42 && Math.abs(playerPosition.y - (slime.y + 0.5)) < 1.6) {
          damagePlayer();
        }

        slime.hopTimer -= deltaTime;
        if (slime.hopTimer <= 0 && slime.verticalVelocity <= 0.01) {
          slime.verticalVelocity = 2.9 + Math.min(wave * 0.12, 1.4);
          slime.hopTimer = Math.max(0.44, 1.05 - wave * 0.035) + random() * 0.26;
        }
        if (distance > 0.001) {
          const speed = 0.62 + Math.min(wave * 0.075, 1.25);
          const moveDistance = Math.min(distance, speed * deltaTime);
          slime.x += dx / distance * moveDistance;
          slime.z += dz / distance * moveDistance;
          slime.group.rotation.y = Math.atan2(dx, dz);
        }
        const ground = world.getHeightAt(slime.x, slime.z);
        if (ground !== null) {
          slime.verticalVelocity -= 8.8 * deltaTime;
          slime.y += slime.verticalVelocity * deltaTime;
          if (slime.y <= ground) {
            slime.y = ground;
            slime.verticalVelocity = 0;
          }
        } else {
          slime.verticalVelocity = 0;
          slime.y = world.seaLevel || 1.35;
        }

        slime.phase += deltaTime * 5;
        const airborne = Math.max(0, slime.verticalVelocity) * 0.055;
        const squish = Math.sin(slime.phase) * 0.035;
        slime.group.position.set(slime.x, slime.y - 0.05, slime.z);
        slime.body.scale.set(1 + airborne * 0.32 + squish, 0.9 - airborne * 0.2 - squish, 1 + airborne * 0.32 + squish);
      }
      if (slimes.length === 0 && nextWaveTimer <= 0) nextWaveTimer = 2.4;
    }

    function updateProjectiles(deltaTime) {
      for (const projectile of projectiles.slice()) {
        projectile.life -= deltaTime;
        projectile.position.addScaledVector(projectile.velocity, deltaTime);
        projectile.mesh.position.copy(projectile.position);
        projectile.mesh.rotation.x += deltaTime * 5;
        projectile.mesh.rotation.y += deltaTime * 7;
        let hit = null;
        for (const slime of slimes) {
          const center = new THREE.Vector3(slime.x, slime.y + 0.45, slime.z);
          if (center.distanceToSquared(projectile.position) <= 0.68 * 0.68) {
            hit = slime;
            break;
          }
        }
        if (hit) burstSlime(hit);
        if (hit || projectile.life <= 0) {
          projectileGroup.remove(projectile.mesh);
          const index = projectiles.indexOf(projectile);
          if (index >= 0) projectiles.splice(index, 1);
        }
      }
    }

    function updateEffects(deltaTime, playerPosition) {
      for (const particle of particles.slice()) {
        particle.life -= deltaTime;
        particle.velocity.y -= 5.5 * deltaTime;
        particle.mesh.position.addScaledVector(particle.velocity, deltaTime);
        particle.material.opacity = Math.max(0, particle.life / particle.maxLife);
        particle.mesh.scale.setScalar(Math.max(0.05, particle.life / particle.maxLife));
        if (particle.life <= 0) {
          effectGroup.remove(particle.mesh);
          particle.material.dispose();
          particles.splice(particles.indexOf(particle), 1);
        }
      }

      for (const crystal of crystals.slice()) {
        crystal.phase += deltaTime * 2.8;
        crystal.mesh.position.y = crystal.y + Math.sin(crystal.phase) * 0.12;
        crystal.mesh.rotation.y += deltaTime * 1.8;
        if (crystal.mesh.position.distanceTo(playerPosition) < 1.1) {
          effectGroup.remove(crystal.mesh);
          crystal.material.dispose();
          crystals.splice(crystals.indexOf(crystal), 1);
          crystalCount += 1;
          score += 25;
          crystalText.textContent = String(crystalCount);
          announce("crystal", { count: crystalCount, score });
          showToast("كريستالة جُمعت! 💎", 1.3);
          if (typeof settings.onCrystalCollected === "function") settings.onCrystalCollected(crystalCount);
        }
      }
    }

    function update(deltaTime) {
      if (disposed || paused) return;
      const dt = Math.max(0, Math.min(Number(deltaTime) || 0, 0.05));
      if (!dt) return;
      fireCooldown = Math.max(0, fireCooldown - dt);
      hitCooldown = Math.max(0, hitCooldown - dt);
      gunPulse = Math.max(0, gunPulse - dt);
      if (energyGun.visible) {
        energyGun.position.y = -0.32 + Math.sin(performance.now() * 0.004) * 0.006;
        muzzleGlow.scale.setScalar(gunPulse > 0 ? 1.8 : 1);
      }
      if (announcementTimer > 0) {
        announcementTimer -= dt;
        if (announcementTimer <= 0) toast.classList.remove("is-visible");
      }
      if (reloadTimer > 0 && !gameOver) {
        reloadTimer = Math.max(0, reloadTimer - dt);
        if (reloadTimer === 0) {
          ammo = settings.magazineSize;
          updateAmmoUI();
        }
      }
      if (gameOver) return;

      const playerPosition = player.getPosition(new THREE.Vector3());
      updateSlimes(dt, playerPosition);
      updateProjectiles(dt);
      updateEffects(dt, playerPosition);
      if (slimes.length === 0 && nextWaveTimer > 0) {
        nextWaveTimer -= dt;
        if (nextWaveTimer <= 0) spawnWave();
      }
    }

    function getState() {
      return {
        health,
        maxHealth: settings.maxHealth,
        ammo,
        magazineSize: settings.magazineSize,
        reloading: reloadTimer > 0,
        wave,
        slimes: slimes.length,
        crystals: crystalCount,
        score,
        mode: interactionMode,
        paused,
        gameOver
      };
    }

    function setPaused(value) {
      paused = Boolean(value);
      return paused;
    }

    function setGameOverScreen(enabled) {
      showGameOverScreen = Boolean(enabled);
      gameOverPanel.hidden = !showGameOverScreen || !gameOver;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      pointerLockElement.removeEventListener("pointerdown", handlePointerDown, true);
      pointerLockElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      restartButton.removeEventListener("click", restart);
      scene.remove(root);
      camera.remove(energyGun);
      uiStyle.remove();
      hud.remove();
      toast.remove();
      gameOverPanel.remove();
      slimes.forEach(slime => slime.material.dispose());
      crystals.forEach(crystal => crystal.material.dispose());
      particles.forEach(particle => particle.material.dispose());
      [
        bodyGeometry,
        eyeGeometry,
        pupilGeometry,
        projectileGeometry,
        glowGeometry,
        crystalGeometry,
        particleGeometry,
        gunBodyGeometry,
        gunGripGeometry,
        gunBarrelGeometry,
        muzzleGlow.geometry
      ].forEach(geometry => geometry.dispose());
      [eyeMaterial, pupilMaterial, smileMaterial, gunMaterial, gunGlowMaterial, projectileMaterial, projectileGlowMaterial].forEach(material => material.dispose());
      slimes.length = 0;
      projectiles.length = 0;
      particles.length = 0;
      crystals.length = 0;
      player.setInteractionMode("build");
    }

    pointerLockElement.addEventListener("pointerdown", handlePointerDown, true);
    pointerLockElement.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    restartButton.addEventListener("click", restart);
    updateHealthUI();
    updateAmmoUI();
    spawnWave();

    return {
      update,
      shoot,
      toggleMode,
      setPaused,
      setGameOverScreen,
      restart,
      getState,
      dispose
    };
  }

  global.CraftEnemies = Object.assign(global.CraftEnemies || {}, { createEnemies });
})(globalThis);
