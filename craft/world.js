(function (global) {
  "use strict";

  function createWorld(scene, options) {
    if (!global.THREE) throw new Error("حمّل Three.js قبل ملف world.js.");
    if (!scene || !scene.isScene) throw new TypeError("createWorld يتطلب THREE.Scene.");

    const THREE = global.THREE;
    const settings = Object.assign({ seed: 73421 }, options || {});
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    const size = 32;
    const halfSize = size / 2;
    const seaLevel = 1.35;
    const bottomY = -2;
    const group = new THREE.Group();
    group.name = "voxel-island";
    const terrainHeights = Array.from({ length: size }, () => Array(size).fill(null));
    const instances = {
      grass: [],
      dirt: [],
      rock: [],
      bark: [],
      leaves: []
    };
    const voxelBlocks = new Map();
    const instanceMeshes = new Map();
    const materials = {};
    const geometries = {};
    const disposableTextures = [];
    let randomState = settings.seed >>> 0 || 73421;
    let disposed = false;

    function random() {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    function makePixelTexture(name, baseColor, accents, count) {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(`تعذر إنشاء قوام ${name}.`);

      context.fillStyle = baseColor;
      context.fillRect(0, 0, 16, 16);
      for (let index = 0; index < count; index++) {
        context.fillStyle = accents[Math.floor(random() * accents.length)];
        const x = Math.floor(random() * 16);
        const y = Math.floor(random() * 16);
        const width = 1 + Math.floor(random() * 4);
        const height = 1 + Math.floor(random() * 3);
        context.fillRect(x, y, Math.min(width, 16 - x), Math.min(height, 16 - y));
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.name = `pixel-${name}`;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      disposableTextures.push(texture);
      return texture;
    }

    function makeBlockMaterial(name, baseColor, accents, roughness) {
      const material = new THREE.MeshStandardMaterial({
        map: makePixelTexture(name, baseColor, accents, 42),
        color: 0xffffff,
        roughness,
        metalness: 0
      });
      material.name = `voxel-${name}`;
      materials[name] = material;
      return material;
    }

    makeBlockMaterial("grass", "#639a58", ["#76ad63", "#4f864e", "#8ab76a", "#5b9252"], 0.94);
    makeBlockMaterial("dirt", "#966543", ["#a9784d", "#80543c", "#b18756", "#76513d"], 1);
    makeBlockMaterial("rock", "#747d7b", ["#89908a", "#626e70", "#9a9d91", "#596467"], 0.88);
    makeBlockMaterial("bark", "#805237", ["#96633f", "#68462f", "#a47149", "#71482f"], 0.96);
    makeBlockMaterial("leaves", "#438251", ["#5a9b5a", "#34744b", "#74a95f", "#3e8b56"], 0.92);

    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 4;
    skyCanvas.height = 128;
    const skyContext = skyCanvas.getContext("2d");
    if (!skyContext) throw new Error("تعذر إنشاء قوام السماء.");
    const skyGradient = skyContext.createLinearGradient(0, 0, 0, skyCanvas.height);
    skyGradient.addColorStop(0, "#65b6d4");
    skyGradient.addColorStop(0.56, "#c4e6dc");
    skyGradient.addColorStop(1, "#f3e5b9");
    skyContext.fillStyle = skyGradient;
    skyContext.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.magFilter = THREE.LinearFilter;
    skyTexture.minFilter = THREE.LinearFilter;
    disposableTextures.push(skyTexture);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(100, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, depthWrite: false })
    );
    sky.name = "voxel-sky";
    sky.frustumCulled = false;
    group.add(sky);

    const waterTexture = makePixelTexture("water", "#4d9db0", ["#65b2bb", "#3e899f", "#8bc5bc", "#5394a8"], 32);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(92, 92),
      new THREE.MeshStandardMaterial({
        map: waterTexture,
        color: 0xb7e1da,
        transparent: true,
        opacity: 0.76,
        roughness: 0.24,
        metalness: 0.04,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    water.name = "voxel-water";
    water.rotation.x = -Math.PI / 2;
    water.position.y = seaLevel;
    water.renderOrder = 1;
    group.add(water);

    group.add(new THREE.HemisphereLight(0xdff5ff, 0x71836a, 1.25));

    const sunlight = new THREE.DirectionalLight(0xfff2d2, 2.15);
    sunlight.name = "voxel-sunlight";
    sunlight.position.set(-22, 34, 18);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = -24;
    sunlight.shadow.camera.right = 24;
    sunlight.shadow.camera.top = 32;
    sunlight.shadow.camera.bottom = -24;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 90;
    sunlight.shadow.bias = -0.00025;
    group.add(sunlight);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 12, 8),
      new THREE.MeshBasicMaterial({ color: "#fff0b5" })
    );
    sun.name = "voxel-sun";
    sun.position.set(-38, 43, -52);
    group.add(sun);

    function smoothNoise(x, z) {
      return Math.sin(x * 0.47 + 0.5) * 0.52 +
        Math.cos(z * 0.39 - 0.8) * 0.42 +
        Math.sin((x + z) * 0.25) * 0.34 +
        Math.cos((x - z) * 0.19) * 0.3;
    }

    function isLand(x, z) {
      const irregularity = smoothNoise(x, z) * 0.78;
      const radius = Math.sqrt((x / 15.7) ** 2 + (z / 15.3) ** 2);
      return radius < 0.91 + irregularity * 0.035;
    }

    function surfaceHeight(x, z) {
      const distance = Math.sqrt((x / 15.7) ** 2 + (z / 15.3) ** 2);
      const inland = Math.max(0, 1 - distance);
      const hills = smoothNoise(x, z);
      const centerRise = Math.round(inland * 1.9);
      const gentleSlope = distance > 0.77 ? -1 : 0;
      return 2 + centerRise + Math.round(hills * 0.7) + gentleSlope;
    }

    function addBlock(kind, x, y, z, scale) {
      const transform = {
        x,
        y,
        z,
        sx: scale && scale.x !== undefined ? scale.x : 1,
        sy: scale && scale.y !== undefined ? scale.y : 1,
        sz: scale && scale.z !== undefined ? scale.z : 1,
        tint: 0.91 + random() * 0.16
      };
      instances[kind].push(transform);
      if (
        transform.sx === 1 && transform.sy === 1 && transform.sz === 1 &&
        Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      ) {
        const key = blockKey(x, y, z);
        if (voxelBlocks.has(key)) throw new Error(`موقع مكعب مكرر في العالم: ${key}`);
        voxelBlocks.set(key, { kind, transform });
      }
    }

    function blockKey(x, y, z) {
      return `${x},${y},${z}`;
    }

    function rebuildInstances(kind) {
      const previousMesh = instanceMeshes.get(kind);
      if (previousMesh) group.remove(previousMesh);
      const transforms = instances[kind];
      if (!transforms.length) {
        instanceMeshes.delete(kind);
        return;
      }

      const mesh = new THREE.InstancedMesh(geometries.block, materials[kind], transforms.length);
      mesh.name = `voxel-${kind}-instances`;
      mesh.castShadow = kind !== "leaves";
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      const dummy = new THREE.Object3D();
      const tint = new THREE.Color();
      const voxelCoordinates = [];
      transforms.forEach((transform, index) => {
        dummy.position.set(transform.x, transform.y, transform.z);
        dummy.scale.set(transform.sx, transform.sy, transform.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        tint.setRGB(transform.tint, transform.tint, transform.tint);
        mesh.setColorAt(index, tint);
        voxelCoordinates.push(
          transform.sx === 1 && transform.sy === 1 && transform.sz === 1 &&
          Number.isInteger(transform.x) && Number.isInteger(transform.y) && Number.isInteger(transform.z)
            ? { x: transform.x, y: transform.y, z: transform.z }
            : null
        );
      });

      mesh.userData.voxelCoordinates = voxelCoordinates;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      instanceMeshes.set(kind, mesh);
    }

    const rockTopCells = new Set();
    const rockCandidates = [];
    for (let z = -16; z < 16; z++) {
      for (let x = -16; x < 16; x++) {
        if (!isLand(x, z)) continue;
        const worldX = x + halfSize;
        const worldZ = z + halfSize;
        const topY = surfaceHeight(x, z);
        terrainHeights[worldZ][worldX] = topY;

        const rocky = random() < 0.045 && Math.abs(x) + Math.abs(z) > 7;
        if (rocky) rockTopCells.add(`${x},${z}`);
        rockCandidates.push({ x, z, topY, rocky });

        for (let y = bottomY; y <= topY; y++) {
          let kind = "rock";
          if (rocky && y === topY) kind = "rock";
          else if (!rocky && y === topY) kind = "grass";
          else if (y >= topY - 2) kind = "dirt";
          addBlock(kind, x, y, z);
        }
      }
    }

    for (const cell of rockCandidates) {
      if (cell.rocky || random() > 0.045) continue;
      const neighborX = cell.x + (random() < 0.5 ? -1 : 1);
      const neighborZ = cell.z + (random() < 0.5 ? -1 : 1);
      if (rockTopCells.has(`${cell.x},${cell.z}`)) continue;
      if (cell.topY < 2) continue;
      addBlock("rock", cell.x, cell.topY + 0.5, cell.z, { x: 0.72, y: 0.72, z: 0.72 });
      if (random() > 0.5) {
        addBlock("rock", neighborX, cell.topY + 0.25, neighborZ, { x: 0.48, y: 0.48, z: 0.48 });
      }
    }

    function placeTree(x, z, height) {
      const worldX = x + halfSize;
      const worldZ = z + halfSize;
      const ground = terrainHeights[worldZ][worldX];
      if (ground === null || rockTopCells.has(`${x},${z}`)) return;

      for (let trunkY = 1; trunkY <= height; trunkY++) {
        addBlock("bark", x, ground + trunkY, z);
      }

      const crownY = ground + height + 1;
      for (let layer = 0; layer < 3; layer++) {
        const radius = layer === 1 ? 2 : 1;
        const layerY = crownY + layer;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && random() < 0.55) continue;
            addBlock("leaves", x + dx, layerY, z + dz);
          }
        }
      }
      addBlock("leaves", x, crownY + 3, z);
    }

    const treeSites = [
      [-10, -7, 3], [-5, -11, 4], [3, -10, 3], [9, -8, 4],
      [-11, 1, 4], [-6, 5, 3], [7, 3, 4], [10, 7, 3],
      [-4, 10, 4], [4, 11, 3], [0, -5, 3], [11, 0, 3]
    ];
    for (const site of treeSites) placeTree(site[0], site[1], site[2]);

    geometries.block = new THREE.BoxGeometry(1, 1, 1);

    for (const kind of Object.keys(instances)) rebuildInstances(kind);

    const worldBackground = new THREE.Color("#9dcfe0");
    const worldFog = new THREE.Fog("#c7e0d8", 38, 82);
    scene.background = worldBackground;
    scene.fog = worldFog;
    scene.add(group);

    function getHeightAt(x, z) {
      const gridX = Math.floor(x + halfSize);
      const gridZ = Math.floor(z + halfSize);
      if (gridX < 0 || gridX >= size || gridZ < 0 || gridZ >= size) return null;
      const height = terrainHeights[gridZ][gridX];
      return height === null ? null : height + 0.5;
    }

    function getBlockAt(x, y, z) {
      if (![x, y, z].every(Number.isFinite)) return null;
      const block = voxelBlocks.get(blockKey(Math.round(x), Math.round(y), Math.round(z)));
      if (!block) return null;
      return {
        kind: block.kind,
        x: block.transform.x,
        y: block.transform.y,
        z: block.transform.z
      };
    }

    function getVoxelHit(intersection) {
      if (!intersection || !intersection.object || !Number.isInteger(intersection.instanceId)) return null;
      const coordinates = intersection.object.userData.voxelCoordinates;
      if (!coordinates) return null;
      const voxel = coordinates[intersection.instanceId];
      if (!voxel) return null;
      const block = getBlockAt(voxel.x, voxel.y, voxel.z);
      return block ? Object.assign({}, voxel, { kind: block.kind }) : null;
    }

    function updateTerrainHeight(x, z) {
      const gridX = x + halfSize;
      const gridZ = z + halfSize;
      if (gridX < 0 || gridX >= size || gridZ < 0 || gridZ >= size) return;

      let highest = null;
      for (const block of voxelBlocks.values()) {
        const transform = block.transform;
        if (
          transform.x !== x || transform.z !== z || transform.sy !== 1 ||
          !["grass", "dirt", "rock"].includes(block.kind)
        ) continue;
        const blockTop = transform.y + 0.5;
        if (highest === null || blockTop > highest) highest = blockTop;
      }
      terrainHeights[gridZ][gridX] = highest === null ? null : highest - 0.5;
    }

    function removeBlock(x, y, z) {
      if (![x, y, z].every(Number.isInteger)) return false;
      const key = blockKey(x, y, z);
      const block = voxelBlocks.get(key);
      if (!block) return false;

      voxelBlocks.delete(key);
      const transforms = instances[block.kind];
      const index = transforms.indexOf(block.transform);
      if (index === -1) throw new Error(`تعذر العثور على مكعب ${key} في قائمة الرسم.`);
      transforms.splice(index, 1);
      rebuildInstances(block.kind);
      updateTerrainHeight(x, z);
      return true;
    }

    function addVoxelBlock(kind, x, y, z) {
      if (!Object.prototype.hasOwnProperty.call(instances, kind)) {
        throw new TypeError(`نوع مكعب غير مدعوم: ${kind}`);
      }
      if (![x, y, z].every(Number.isInteger)) return false;
      if (x < -halfSize || x >= halfSize || z < -halfSize || z >= halfSize || y < bottomY || y > 64) {
        return false;
      }
      if (voxelBlocks.has(blockKey(x, y, z))) return false;

      addBlock(kind, x, y, z);
      rebuildInstances(kind);
      updateTerrainHeight(x, z);
      return true;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      if (scene.background === worldBackground) scene.background = previousBackground;
      if (scene.fog === worldFog) scene.fog = previousFog;
      group.traverse(object => {
        if (object.isInstancedMesh || object.isMesh) {
          if (object.geometry && !Object.values(geometries).includes(object.geometry)) object.geometry.dispose();
        }
      });
      instanceMeshes.clear();
      voxelBlocks.clear();
      Object.values(geometries).forEach(geometry => geometry.dispose());
      Object.values(materials).forEach(material => material.dispose());
      disposableTextures.forEach(texture => texture.dispose());
    }

    return {
      group,
      size,
      seaLevel,
      getHeightAt,
      getBlockAt,
      getVoxelHit,
      addBlock: addVoxelBlock,
      removeBlock,
      dispose
    };
  }

  global.CraftWorld = Object.assign(global.CraftWorld || {}, { createWorld });
})(globalThis);
