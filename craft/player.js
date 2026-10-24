(function (global) {
  "use strict";

  function createPlayer(camera, pointerLockElement, world, options) {
    if (!global.THREE) throw new Error("حمّل Three.js قبل ملف player.js.");
    if (!camera || !camera.isCamera) throw new TypeError("createPlayer يتطلب كاميرا Three.js.");
    if (!pointerLockElement || typeof pointerLockElement.addEventListener !== "function") {
      throw new TypeError("createPlayer يتطلب عنصراً لالتقاط الماوس.");
    }
    if (!world || !world.group || typeof world.getHeightAt !== "function") {
      throw new TypeError("createPlayer يتطلب كائناً من CraftWorld.createWorld.");
    }
    if (
      typeof world.getVoxelHit !== "function" ||
      typeof world.getBlockAt !== "function" ||
      typeof world.addBlock !== "function" ||
      typeof world.removeBlock !== "function"
    ) {
      throw new TypeError("العالم لا يدعم التفاعل مع المكعبات. استخدم نسخة world.js المحدثة.");
    }

    const THREE = global.THREE;
    const settings = Object.assign({
      moveSpeed: 5.2,
      sprintMultiplier: 1.5,
      mouseSensitivity: 0.0022,
      gravity: 20,
      jumpVelocity: 7.1,
      playerHeight: 1.72,
      eyeHeight: 1.55,
      radius: 0.29,
      stepHeight: 0.55,
      reach: 6,
      spawnX: 0,
      spawnZ: 0,
      lockOnClick: true,
      onPointerLockChange: null,
      onPointerLockError: null
    }, options || {});

    const input = new Set();
    const collidersByCell = new Map();
    const inverseMatrix = new THREE.Matrix4();
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const instancePosition = new THREE.Vector3();
    const instanceQuaternion = new THREE.Quaternion();
    const instanceScale = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    raycaster.far = settings.reach;
    const screenCenter = new THREE.Vector2(0, 0);
    const normalMatrix = new THREE.Matrix3();
    const selectedBlocks = [
      { kind: "grass", label: "عشب", icon: "🌿" },
      { kind: "dirt", label: "تراب", icon: "🟫" },
      { kind: "rock", label: "صخر", icon: "🪨" },
      { kind: "bark", label: "خشب", icon: "🪵" },
      { kind: "leaves", label: "أوراق", icon: "🍃" }
    ];
    let yaw = camera.rotation.y || 0;
    let pitch = camera.rotation.x || 0;
    let verticalVelocity = 0;
    let grounded = false;
    let disposed = false;
    let colliderId = 0;
    let selectedBlockIndex = 0;
    let currentTarget = null;
    let interactionMode = "build";
    let paused = false;

    camera.rotation.order = "YXZ";
    const spawnHeight = world.getHeightAt(settings.spawnX, settings.spawnZ);
    camera.position.set(
      settings.spawnX,
      (spawnHeight === null ? world.seaLevel || 0 : spawnHeight) + settings.eyeHeight,
      settings.spawnZ
    );
    camera.rotation.set(pitch, yaw, 0, "YXZ");

    const interactionStyle = document.createElement("style");
    interactionStyle.dataset.craftPlayer = "";
    interactionStyle.textContent = `
      .craft-crosshair {
        position: fixed;
        z-index: 9998;
        top: 50%;
        left: 50%;
        width: 20px;
        height: 20px;
        color: #fff;
        filter: drop-shadow(0 1px 2px rgba(18, 32, 38, .85));
        pointer-events: none;
        transform: translate(-50%, -50%);
      }
      .craft-crosshair::before, .craft-crosshair::after {
        position: absolute;
        top: 50%;
        left: 50%;
        display: block;
        background: currentColor;
        border-radius: 2px;
        content: "";
        transform: translate(-50%, -50%);
      }
      .craft-crosshair::before { width: 16px; height: 2px; }
      .craft-crosshair::after { width: 2px; height: 16px; }
      .craft-crosshair.is-targeting { color: #ffde72; }
      .craft-hotbar {
        position: fixed;
        z-index: 9999;
        right: 50%;
        bottom: max(16px, env(safe-area-inset-bottom));
        display: flex;
        max-width: calc(100vw - 20px);
        gap: 7px;
        padding: 8px;
        overflow-x: auto;
        background: rgba(27, 40, 48, .74);
        border: 1px solid rgba(255, 255, 255, .32);
        border-radius: 15px;
        box-shadow: 0 8px 24px rgba(13, 27, 32, .25);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        transform: translateX(50%);
      }
      .craft-hotbar[hidden] { display: none; }
      .craft-hotbar-button {
        display: grid;
        width: 56px;
        min-width: 56px;
        height: 58px;
        grid-template-rows: 1fr auto;
        place-items: center;
        padding: 3px;
        color: #f4f4ed;
        background: rgba(255, 255, 255, .09);
        border: 2px solid rgba(255, 255, 255, .16);
        border-radius: 10px;
        cursor: pointer;
        font: 11px Tahoma, Arial, sans-serif;
        touch-action: manipulation;
      }
      .craft-hotbar-button:hover { background: rgba(255, 255, 255, .2); }
      .craft-hotbar-button.is-selected {
        background: rgba(255, 220, 119, .2);
        border-color: #ffdc77;
        box-shadow: 0 0 0 1px rgba(255, 220, 119, .2);
      }
      .craft-hotbar-icon { font-size: 20px; line-height: 1; }
      .craft-hotbar-key { align-self: end; color: rgba(255, 255, 255, .72); font-size: 10px; }
      @media (max-width: 380px) {
        .craft-hotbar { gap: 5px; padding: 6px; }
        .craft-hotbar-button { width: 49px; min-width: 49px; height: 53px; }
      }
    `;
    document.head.appendChild(interactionStyle);

    const crosshair = document.createElement("div");
    crosshair.className = "craft-crosshair";
    crosshair.setAttribute("role", "img");
    crosshair.setAttribute("aria-label", "مؤشر التصويب");
    document.body.appendChild(crosshair);

    const hotbar = document.createElement("div");
    hotbar.className = "craft-hotbar";
    hotbar.setAttribute("role", "toolbar");
    hotbar.setAttribute("aria-label", "اختيار نوع المكعب");
    const hotbarHandlers = [];
    const hotbarButtons = selectedBlocks.map((block, index) => {
      const button = document.createElement("button");
      button.className = "craft-hotbar-button";
      button.type = "button";
      button.dataset.index = String(index);
      button.setAttribute("aria-label", `${index + 1}: ${block.label}`);
      button.setAttribute("aria-pressed", String(index === selectedBlockIndex));

      const icon = document.createElement("span");
      icon.className = "craft-hotbar-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = block.icon;
      const key = document.createElement("span");
      key.className = "craft-hotbar-key";
      key.textContent = String(index + 1);
      button.append(icon, key);
      button.addEventListener("pointerdown", event => event.stopPropagation());
      const handleSelection = () => selectBlock(index);
      button.addEventListener("click", handleSelection);
      hotbarHandlers.push(handleSelection);
      hotbar.appendChild(button);
      return button;
    });
    document.body.appendChild(hotbar);

    function selectBlock(index) {
      if (!Number.isInteger(index) || index < 0 || index >= selectedBlocks.length) return;
      selectedBlockIndex = index;
      hotbarButtons.forEach((button, buttonIndex) => {
        const selected = buttonIndex === selectedBlockIndex;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      if (typeof settings.onBlockSelected === "function") {
        settings.onBlockSelected(selectedBlocks[index].kind);
      }
    }

    function setInteractionMode(mode) {
      if (mode !== "build" && mode !== "energy") {
        throw new TypeError(`وضع تفاعل غير مدعوم: ${mode}`);
      }
      interactionMode = mode;
      hotbar.hidden = mode !== "build";
      if (typeof settings.onInteractionModeChange === "function") {
        settings.onInteractionModeChange(mode);
      }
      return interactionMode;
    }

    function cellKey(x, z) {
      return `${x},${z}`;
    }

    function addColliderToCell(collider, x, z) {
      const key = cellKey(x, z);
      let colliders = collidersByCell.get(key);
      if (!colliders) {
        colliders = [];
        collidersByCell.set(key, colliders);
      }
      colliders.push(collider);
    }

    function refreshColliders() {
      collidersByCell.clear();
      colliderId = 0;
      world.group.updateMatrixWorld(true);

      world.group.traverse(object => {
        if (!object.isInstancedMesh || !object.count) return;
        for (let index = 0; index < object.count; index++) {
          object.getMatrixAt(index, instanceMatrix);
          worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
          worldMatrix.decompose(instancePosition, instanceQuaternion, instanceScale);

          const halfWidth = Math.abs(instanceScale.x) * 0.5;
          const halfHeight = Math.abs(instanceScale.y) * 0.5;
          const halfDepth = Math.abs(instanceScale.z) * 0.5;
          const collider = {
            id: colliderId++,
            minX: instancePosition.x - halfWidth,
            maxX: instancePosition.x + halfWidth,
            minY: instancePosition.y - halfHeight,
            maxY: instancePosition.y + halfHeight,
            minZ: instancePosition.z - halfDepth,
            maxZ: instancePosition.z + halfDepth
          };
          const minCellX = Math.ceil(collider.minX - 0.5);
          const maxCellX = Math.floor(collider.maxX + 0.5);
          const minCellZ = Math.ceil(collider.minZ - 0.5);
          const maxCellZ = Math.floor(collider.maxZ + 0.5);

          for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
            for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
              addColliderToCell(collider, cellX, cellZ);
            }
          }
        }
      });
      grounded = findSupport(getFeetY(), 0.06, 0.12) !== null;
      if (grounded) verticalVelocity = 0;
      return colliderId;
    }

    function getFeetY() {
      return camera.position.y - settings.eyeHeight;
    }

    function candidateColliders(x, z, radius) {
      const result = [];
      const seen = new Set();
      const minCellX = Math.floor(x - radius + 0.5);
      const maxCellX = Math.floor(x + radius + 0.5);
      const minCellZ = Math.floor(z - radius + 0.5);
      const maxCellZ = Math.floor(z + radius + 0.5);

      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          const colliders = collidersByCell.get(cellKey(cellX, cellZ));
          if (!colliders) continue;
          for (const collider of colliders) {
            if (seen.has(collider.id)) continue;
            seen.add(collider.id);
            result.push(collider);
          }
        }
      }
      return result;
    }

    function footprintOverlaps(x, z, radius, collider) {
      const closestX = Math.max(collider.minX, Math.min(x, collider.maxX));
      const closestZ = Math.max(collider.minZ, Math.min(z, collider.maxZ));
      const offsetX = x - closestX;
      const offsetZ = z - closestZ;
      return offsetX * offsetX + offsetZ * offsetZ < radius * radius;
    }

    function findSupport(feetY, rise, fall, x, z) {
      const playerX = x === undefined ? camera.position.x : x;
      const playerZ = z === undefined ? camera.position.z : z;
      const minTop = feetY - fall;
      const maxTop = feetY + rise;
      let bestTop = null;

      for (const collider of candidateColliders(playerX, playerZ, settings.radius)) {
        if (collider.maxY < minTop - 0.001 || collider.maxY > maxTop + 0.001) continue;
        if (!footprintOverlaps(playerX, playerZ, settings.radius, collider)) continue;
        if (bestTop === null || collider.maxY > bestTop) bestTop = collider.maxY;
      }
      return bestTop;
    }

    function intersectsObstacle(x, z, feetY) {
      const headY = feetY + settings.playerHeight;
      for (const collider of candidateColliders(x, z, settings.radius)) {
        if (collider.maxY <= feetY + 0.015 || collider.minY >= headY - 0.015) continue;
        if (footprintOverlaps(x, z, settings.radius, collider)) return true;
      }
      return false;
    }

    function canOccupyAtHeight(x, z, feetY) {
      return !intersectsObstacle(x, z, feetY);
    }

    function moveAxis(axis, amount) {
      if (!amount) return;
      const distance = Math.abs(amount);
      const steps = Math.max(1, Math.ceil(distance / 0.2));
      const step = amount / steps;

      for (let index = 0; index < steps; index++) {
        const nextX = camera.position.x + (axis === "x" ? step : 0);
        const nextZ = camera.position.z + (axis === "z" ? step : 0);
        const feetY = getFeetY();

        if (!intersectsObstacle(nextX, nextZ, feetY)) {
          camera.position[axis] += step;
          continue;
        }

        const support = findSupport(feetY, settings.stepHeight, 0.05, nextX, nextZ);
        if (support !== null && support > feetY + 0.02 && canOccupyAtHeight(nextX, nextZ, support)) {
          camera.position[axis] += step;
          camera.position.y = support + settings.eyeHeight;
          verticalVelocity = 0;
          grounded = true;
        }
      }
    }

    function updateVertical(deltaTime) {
      const feetY = getFeetY();
      const headY = feetY + settings.playerHeight;
      verticalVelocity -= settings.gravity * deltaTime;
      const nextFeetY = feetY + verticalVelocity * deltaTime;

      if (verticalVelocity <= 0) {
        let landingHeight = null;
        for (const collider of candidateColliders(camera.position.x, camera.position.z, settings.radius)) {
          if (collider.maxY > feetY + 0.035 || collider.maxY < nextFeetY - 0.035) continue;
          if (!footprintOverlaps(camera.position.x, camera.position.z, settings.radius, collider)) continue;
          if (landingHeight === null || collider.maxY > landingHeight) landingHeight = collider.maxY;
        }

        if (landingHeight !== null) {
          camera.position.y = landingHeight + settings.eyeHeight;
          verticalVelocity = 0;
          grounded = true;
          return;
        }
      } else {
        let ceilingHeight = null;
        for (const collider of candidateColliders(camera.position.x, camera.position.z, settings.radius)) {
          if (collider.minY < headY - 0.025 || collider.minY > nextFeetY + settings.playerHeight) continue;
          if (!footprintOverlaps(camera.position.x, camera.position.z, settings.radius, collider)) continue;
          if (ceilingHeight === null || collider.minY < ceilingHeight) ceilingHeight = collider.minY;
        }

        if (ceilingHeight !== null) {
          camera.position.y = ceilingHeight - settings.playerHeight + settings.eyeHeight;
          verticalVelocity = 0;
          grounded = false;
          return;
        }
      }

      camera.position.y += verticalVelocity * deltaTime;
      grounded = false;

      if (camera.position.y < -24) {
        const height = world.getHeightAt(settings.spawnX, settings.spawnZ);
        camera.position.set(
          settings.spawnX,
          (height === null ? world.seaLevel || 0 : height) + settings.eyeHeight,
          settings.spawnZ
        );
        verticalVelocity = 0;
        grounded = true;
      }
    }

    function look(deltaX, deltaY) {
      yaw -= deltaX * settings.mouseSensitivity;
      pitch -= deltaY * settings.mouseSensitivity;
      pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
      camera.rotation.set(pitch, yaw, 0, "YXZ");
    }

    function handleMouseMove(event) {
      if (document.pointerLockElement !== pointerLockElement) return;
      look(event.movementX || 0, event.movementY || 0);
    }

    function findTarget() {
      camera.updateMatrixWorld(true);
      world.group.updateMatrixWorld(true);
      raycaster.setFromCamera(screenCenter, camera);
      const meshes = world.group.children.filter(object => object.isInstancedMesh && object.count > 0);
      const intersections = raycaster.intersectObjects(meshes, false);

      for (const intersection of intersections) {
        const block = world.getVoxelHit(intersection);
        if (!block) continue;
        const normal = intersection.face ? intersection.face.normal.clone() : new THREE.Vector3();
        normal.applyMatrix3(normalMatrix.getNormalMatrix(intersection.object.matrixWorld)).normalize();
        currentTarget = {
          block,
          normal: new THREE.Vector3(
            Math.round(normal.x),
            Math.round(normal.y),
            Math.round(normal.z)
          ),
          point: intersection.point.clone(),
          distance: intersection.distance
        };
        crosshair.classList.add("is-targeting");
        if (typeof settings.onTarget === "function") settings.onTarget(currentTarget);
        return currentTarget;
      }

      currentTarget = null;
      crosshair.classList.remove("is-targeting");
      if (typeof settings.onTarget === "function") settings.onTarget(null);
      return null;
    }

    function destroyTarget() {
      if (interactionMode !== "build") return false;
      const target = findTarget();
      if (!target) return false;
      const removed = world.removeBlock(target.block.x, target.block.y, target.block.z);
      if (!removed) return false;
      currentTarget = null;
      refreshColliders();
      if (typeof settings.onBlockChanged === "function") {
        settings.onBlockChanged({ action: "remove", block: target.block });
      }
      return true;
    }

    function canPlaceAt(x, y, z) {
      if (world.getBlockAt(x, y, z)) return false;
      const minY = y - 0.5;
      const maxY = y + 0.5;
      const feetY = getFeetY();
      const headY = feetY + settings.playerHeight;
      if (maxY <= feetY + 0.02 || minY >= headY - 0.02) return true;
      return !footprintOverlaps(camera.position.x, camera.position.z, settings.radius, {
        minX: x - 0.5,
        maxX: x + 0.5,
        minZ: z - 0.5,
        maxZ: z + 0.5
      });
    }

    function placeBlock() {
      if (interactionMode !== "build") return false;
      const target = findTarget();
      if (!target || target.normal.lengthSq() === 0) return false;
      const x = target.block.x + target.normal.x;
      const y = target.block.y + target.normal.y;
      const z = target.block.z + target.normal.z;
      if (!canPlaceAt(x, y, z)) return false;

      const block = selectedBlocks[selectedBlockIndex];
      if (!world.addBlock(block.kind, x, y, z)) return false;
      refreshColliders();
      if (typeof settings.onBlockChanged === "function") {
        settings.onBlockChanged({ action: "add", block: { kind: block.kind, x, y, z } });
      }
      return true;
    }

    function handlePointerDown(event) {
      if (document.pointerLockElement !== pointerLockElement) return;
      if (interactionMode !== "build") return;
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      if (event.button === 0) destroyTarget();
      else placeBlock();
    }

    function handleContextMenu(event) {
      event.preventDefault();
    }

    function reportPointerLockError(error) {
      if (typeof settings.onPointerLockError === "function") {
        settings.onPointerLockError(error);
      } else {
        console.error("تعذر تفعيل التحكم بالماوس:", error);
      }
    }

    function requestPointerLock() {
      if (disposed || document.pointerLockElement === pointerLockElement) return;
      if (typeof pointerLockElement.requestPointerLock !== "function") {
        reportPointerLockError(new Error("Pointer Lock API غير مدعومة في هذا المتصفح."));
        return;
      }

      try {
        const request = pointerLockElement.requestPointerLock();
        if (request && typeof request.catch === "function") {
          request.catch(reportPointerLockError);
        }
      } catch (error) {
        reportPointerLockError(error);
      }
    }

    function handlePointerLockChange() {
      const isLocked = document.pointerLockElement === pointerLockElement;
      if (!isLocked) input.clear();
      if (typeof settings.onPointerLockChange === "function") settings.onPointerLockChange(isLocked);
    }

    function handlePointerLockError() {
      reportPointerLockError(new Error("رفض المتصفح قفل مؤشر الماوس."));
    }

    function isInteractiveTarget(target) {
      return target instanceof Element &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, button, a[href], [contenteditable='true']") !== null);
    }

    function handleKeyDown(event) {
      if (/^Digit[1-5]$/.test(event.code)) {
        if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        selectBlock(Number(event.code.slice(-1)) - 1);
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      const movementKey = [
        "KeyW", "KeyA", "KeyS", "KeyD",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
      ].includes(event.code);
      if (!movementKey && event.code !== "Space") return;

      event.preventDefault();
      input.add(event.code);
      if (event.code === "Space" && grounded && !event.repeat) {
        verticalVelocity = settings.jumpVelocity;
        grounded = false;
      }
    }

    function handleKeyUp(event) {
      input.delete(event.code);
    }

    function handleWindowBlur() {
      input.clear();
    }

    function setPaused(value) {
      paused = Boolean(value);
      if (paused) input.clear();
      return paused;
    }

    function handleClick() {
      if (settings.lockOnClick) requestPointerLock();
    }

    function update(deltaTime) {
      if (disposed || paused) return;
      const dt = Math.max(0, Math.min(Number(deltaTime) || 0, 0.05));
      if (!dt) return;

      let forward = Number(input.has("KeyW") || input.has("ArrowUp")) -
        Number(input.has("KeyS") || input.has("ArrowDown"));
      let strafe = Number(input.has("KeyD") || input.has("ArrowRight")) -
        Number(input.has("KeyA") || input.has("ArrowLeft"));
      const magnitude = Math.hypot(forward, strafe);
      if (magnitude > 1) {
        forward /= magnitude;
        strafe /= magnitude;
      }

      if (forward || strafe) {
        const speed = settings.moveSpeed * (input.has("ShiftLeft") || input.has("ShiftRight") ? settings.sprintMultiplier : 1);
        const moveX = (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed * dt;
        const moveZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed * dt;
        moveAxis("x", moveX);
        moveAxis("z", moveZ);
      }

      updateVertical(dt);
      findTarget();
    }

    function getPosition(target) {
      const position = target || new THREE.Vector3();
      return position.set(camera.position.x, camera.position.y, camera.position.z);
    }

    function setPosition(x, y, z) {
      if (![x, y, z].every(Number.isFinite)) throw new TypeError("إحداثيات اللاعب يجب أن تكون أرقاماً صالحة.");
      camera.position.set(x, y, z);
      verticalVelocity = 0;
      grounded = findSupport(getFeetY(), 0.06, 0.12) !== null;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      input.clear();
      pointerLockElement.removeEventListener("click", handleClick);
      pointerLockElement.removeEventListener("pointerdown", handlePointerDown);
      pointerLockElement.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("pointerlockerror", handlePointerLockError);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      hotbarButtons.forEach((button, index) => button.removeEventListener("click", hotbarHandlers[index]));
      hotbar.remove();
      crosshair.remove();
      interactionStyle.remove();
      if (document.pointerLockElement === pointerLockElement && typeof document.exitPointerLock === "function") {
        document.exitPointerLock();
      }
      collidersByCell.clear();
    }

    refreshColliders();
    pointerLockElement.addEventListener("click", handleClick);
    pointerLockElement.addEventListener("pointerdown", handlePointerDown);
    pointerLockElement.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("pointerlockerror", handlePointerLockError);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return {
      update,
      look,
      requestPointerLock,
      refreshColliders,
      getPosition,
      setPosition,
      getTarget: () => currentTarget,
      getSelectedBlock: () => selectedBlocks[selectedBlockIndex].kind,
      getInteractionMode: () => interactionMode,
      setInteractionMode,
      setPaused,
      isPaused: () => paused,
      selectBlock,
      destroyTarget,
      placeBlock,
      isGrounded: () => grounded,
      isPointerLocked: () => document.pointerLockElement === pointerLockElement,
      dispose
    };
  }

  global.CraftPlayer = Object.assign(global.CraftPlayer || {}, { createPlayer });
})(globalThis);
