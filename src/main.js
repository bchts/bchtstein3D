// ============================================================
//  Moje střílečka – hlavní soubor hry
//  Umí: mřížkovou mapu s texturami, chůzi (WASD) a rozhlížení myší,
//  střílení, nepřátele se životy, HUD (životy + zabití), výhru/prohru.
//  Vše je bohatě okomentované, ať víš, co která část dělá.
// ============================================================

import * as THREE from 'three';

// ------------------------------------------------------------
// 1) ZÁKLAD SCÉNY: scéna, kamera (oči hráče), renderer (kreslič)
// ------------------------------------------------------------

// Scéna = 3D svět, do kterého vkládáme objekty
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14141c); // tmavé pozadí (uvnitř budovy)
scene.fog = new THREE.Fog(0x14141c, 8, 45);   // vzdálené chodby se ztrácejí ve tmě

// Bezpečné rozměry okna (kdyby prohlížeč hlásil 0, použijeme rozumnou náhradu),
// jinak by poměr stran vyšel neplatně a rozbil by se výpočet výstřelu.
function viewSize() {
  return { w: window.innerWidth || 1280, h: window.innerHeight || 720 };
}

// Kamera = odkud a jak se do světa díváme (naše "oči")
// (zorný úhel 75°, poměr stran okna, blízká a vzdálená mez viditelnosti)
const camera = new THREE.PerspectiveCamera(75, viewSize().w / viewSize().h, 0.1, 1000);
camera.position.set(0, 1.7, 5); // výška ~1,7 m (jako oči člověka)

// Renderer = to, co scénu vykreslí na obrazovku
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewSize().w, viewSize().h);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true; // povolíme stíny
document.body.appendChild(renderer.domElement);

// Kameru přidáme do scény, aby se s ní vykreslila i zbraň (bude její "potomek")
scene.add(camera);

// ------------------------------------------------------------
// 2) SVĚTLA: bez světla by byla scéna černá
// ------------------------------------------------------------

// Rozptýlené světlo (jemně nasvítí vše, aby nebyly úplné černé stíny)
scene.add(new THREE.AmbientLight(0xffffff, 0.85));

// Směrové světlo = jako slunce, vrhá stíny
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(10, 20, 10);
sun.castShadow = true;
scene.add(sun);

// ------------------------------------------------------------
// 3) MAPA: level poskládaný z mřížky.
//    #=zeď, .=podlaha (volno), P=start hráče, E=nepřítel.
//    Mapu si klidně uprav – jen ať mají všechny řádky STEJNOU délku
//    a celý okraj je ze stěn (#), aby se nedalo vypadnout ven.
// ------------------------------------------------------------

const CELL = 4;    // velikost jedné buňky mřížky (metry)
const WALL_H = 4;  // výška stěn

const MAP = [
  "################",
  "#P....#........#",
  "#.....#........#",
  "#.....#...E....#",
  "#.....#........#",
  "#.....####.#####",
  "#.........#....#",
  "#....E....#.E..#",
  "#.........#....#",
  "####.######....#",
  "#....#....#....#",
  "#..E.#.E..#..E.#",
  "#....#....#....#",
  "#....#....#....#",
  "################",
];

const ROWS = MAP.length;
const COLS = MAP[0].length;

// Převod pozice v mřížce na souřadnice ve světě (mapu vycentrujeme na střed)
function cellToWorldX(col) { return (col - (COLS - 1) / 2) * CELL; }
function cellToWorldZ(row) { return (row - (ROWS - 1) / 2) * CELL; }

// --- Textury nakreslené přímo v kódu (žádné stahování obrázků) ---

// Cihlová zeď
function makeBrickTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5a5148';                 // malta (spáry mezi cihlami)
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#8a4b3a';                 // barva cihly
  const bw = 60, bh = 28, gap = 4;
  let row = 0;
  for (let y = 0; y < 128; y += bh + gap, row++) {
    const offset = (row % 2) ? -(bw + gap) / 2 : 0; // každá druhá řada posunutá
    for (let x = offset; x < 128; x += bw + gap) {
      g.fillRect(x, y, bw, bh);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

// Dlaždicová podlaha
function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#25282e';                 // tmavá spára
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#40454d';                 // dlaždice
  g.fillRect(4, 4, 120, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(COLS, ROWS);              // jedna dlaždice na každou buňku
  return tex;
}

const brickTexture = makeBrickTexture();
const floorTexture = makeFloorTexture();

// Podlaha (jedna velká deska přes celou mapu)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
  new THREE.MeshStandardMaterial({ map: floorTexture })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Strop
const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
  new THREE.MeshStandardMaterial({ color: 0x202028 })
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = WALL_H;
scene.add(ceiling);

// Objekty pro střelbu (paprsek) a pro kolize (neprůchodnost)
const shootables = [floor];
const obstacles = [];

// Vytvoří jednu zeď (buňku mřížky) na daných světových souřadnicích
const wallMaterial = new THREE.MeshStandardMaterial({ map: brickTexture });
function makeWall(x, z) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H, CELL), wallMaterial);
  box.position.set(x, WALL_H / 2, z);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
  box.updateMatrixWorld(true);
  obstacles.push(new THREE.Box3().setFromObject(box));
  shootables.push(box);
}

// Projdeme mapu: postavíme stěny a zapamatujeme si start hráče + pozice nepřátel
const enemySpawns = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const ch = MAP[row][col];
    const x = cellToWorldX(col);
    const z = cellToWorldZ(row);
    if (ch === '#') {
      makeWall(x, z);
    } else if (ch === 'P') {
      camera.position.set(x, 1.7, z); // sem postavíme hráče
    } else if (ch === 'E') {
      enemySpawns.push({ x, z });
    }
  }
}

// ------------------------------------------------------------
// 4) OVLÁDÁNÍ: rozhlížení myší (pointer lock) + pohyb WASD
// ------------------------------------------------------------

const overlay = document.getElementById('overlay');

// "yaw" = otáčení doleva/doprava, "pitch" = nahoru/dolů
let yaw = Math.PI; // otočíme hráče čelem do mapy (ne do rohové stěny)
let pitch = 0;

let gameOver = false; // true po výhře/prohře – zastaví hru

// Kliknutí na překryv → buď restart (po konci), nebo start hry (zamčení myši)
overlay.addEventListener('click', () => {
  if (gameOver) { location.reload(); return; }
  renderer.domElement.requestPointerLock();
});

// Když se myš zamkne/odemkne, ukážeme/schováme překryv
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle('hidden', locked);
});

// Konec hry – ukáže zprávu; kliknutím se hra restartuje (znovunačtením stránky)
function endGame(message) {
  if (gameOver) return;
  gameOver = true;
  document.exitPointerLock();
  overlay.innerHTML = '<h1>' + message + '</h1><p>Klikni pro nový pokus</p>';
  overlay.classList.remove('hidden');
}

// Pohyb myší → měníme úhel pohledu
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw   -= e.movementX * 0.0025;
  pitch -= e.movementY * 0.0025;
  // Omezíme pohled nahoru/dolů, ať se hráč nepřetočí
  const limit = Math.PI / 2 - 0.05;
  pitch = Math.max(-limit, Math.min(limit, pitch));
});

// Stav kláves: které jsou právě zmáčknuté
const keys = {};
document.addEventListener('keydown', (e) => { keys[e.code] = true; });
document.addEventListener('keyup',   (e) => { keys[e.code] = false; });

// ------------------------------------------------------------
// 5) KOLIZE: nepustíme hráče skrz stěny/sloupy
// ------------------------------------------------------------

const PLAYER_RADIUS = 0.4; // hráč má "poloměr" ~40 cm

// Zjistí, jestli by daná pozice narazila do některé překážky
function collides(x, z) {
  for (const box of obstacles) {
    // Nejbližší bod obálky k hráči (v rovině X-Z)
    const cx = Math.max(box.min.x, Math.min(x, box.max.x));
    const cz = Math.max(box.min.z, Math.min(z, box.max.z));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
  }
  return false;
}

// ------------------------------------------------------------
// 5a) NEPŘÁTELÉ (ploché "sprity", které se vždy dívají na hráče)
// ------------------------------------------------------------

// Obrázek nepřítele si nakreslíme rovnou v kódu (na skrytou kreslicí plochu),
// takže nemusíme nic stahovat. Vytvoříme jednoduchou "příšerku".
function makeEnemyTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');

  // Tělo (kulaté, zelené)
  g.fillStyle = '#3aa655';
  g.beginPath();
  g.arc(64, 72, 46, 0, Math.PI * 2);
  g.fill();

  // Oči (bílé s černou zorničkou)
  for (const ex of [46, 82]) {
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(ex, 60, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(ex, 62, 6, 0, Math.PI * 2); g.fill();
  }

  // Zlá ústa
  g.strokeStyle = '#000'; g.lineWidth = 5;
  g.beginPath(); g.arc(64, 100, 18, Math.PI, 0); g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; // ostré pixely (retro nádech)
  return tex;
}

const enemyTexture = makeEnemyTexture();

// Seznam živých nepřátel
const enemies = [];

// Vytvoří nepřítele na dané pozici
function spawnEnemy(x, z) {
  const material = new THREE.SpriteMaterial({ map: enemyTexture });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.4, 1.4, 1); // velikost ~1,4 m
  sprite.position.set(x, 0.9, z); // těsně nad podlahou
  scene.add(sprite);

  const enemy = { sprite, health: 3 };
  sprite.userData.enemyRef = enemy; // ať u zásahu poznáme, že jde o nepřítele
  enemies.push(enemy);
  return enemy;
}

// Rozmístíme nepřátele podle značek 'E' v mapě
for (const s of enemySpawns) spawnEnemy(s.x, s.z);

// --- Stav hráče a HUD (životy + počet zabitých) ---
let kills = 0;
let playerHealth = 100;
const totalEnemies = enemies.length;
const healthEl = document.getElementById('hud-health');
const killsEl = document.getElementById('hud-kills');

function updateHud() {
  if (healthEl) healthEl.textContent = '❤️ Životy: ' + Math.max(0, Math.ceil(playerHealth));
  if (killsEl) killsEl.textContent = '💀 Zabito: ' + kills + ' / ' + totalEnemies;
}
updateHud();

function damageEnemy(enemy) {
  enemy.health -= 1;

  if (enemy.health <= 0) {
    // Mrtvý – odstraníme ze scény i ze seznamu
    scene.remove(enemy.sprite);
    const i = enemies.indexOf(enemy);
    if (i !== -1) enemies.splice(i, 1);
    kills += 1;
    updateHud();
    if (enemies.length === 0) endGame('🏆 Vyhráls! Všichni nepřátelé zneškodněni.');
  } else {
    // Zásah, ale žije – krátce zčervená jako zpětná vazba
    enemy.sprite.material.color.setHex(0xff5555);
    setTimeout(() => enemy.sprite.material.color.setHex(0xffffff), 120);
  }
}

// ------------------------------------------------------------
// 5b) ZBRAŇ + STŘÍLENÍ
// ------------------------------------------------------------

// --- Model zbraně (jednoduchý kvádr) připnutý ke kameře v pravé dolní části ---
const gun = new THREE.Group();

const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.15, 0.15, 0.6),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
);
gunBody.position.set(0, 0, -0.1);
gun.add(gunBody);

// Hlaveň
const gunBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.03, 0.03, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x111111 })
);
gunBarrel.rotation.x = Math.PI / 2; // otočíme dopředu
gunBarrel.position.set(0, 0.02, -0.5);
gun.add(gunBarrel);

// Umístění zbraně vůči kameře: kousek doprava, dolů a dopředu
gun.position.set(0.25, -0.25, -0.6);
camera.add(gun); // připneme ke kameře, ať se hýbe s pohledem

// Výšleh z hlavně (malá žlutá "koule", normálně schovaná)
const muzzleFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffdd55 })
);
muzzleFlash.position.set(0, 0.02, -0.8);
muzzleFlash.visible = false;
gun.add(muzzleFlash);

// --- Raycaster = "paprsek" ze středu obrazovky (kam míříme) ---
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0); // 0,0 = přesně střed

// Stopy po zásahu (necháme jich max pár desítek, ať se scéna nezaplní)
const impacts = [];
const MAX_IMPACTS = 30;

function makeImpact(point, normal) {
  const mark = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 12),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  mark.position.copy(point);
  // Natočíme kolečko podle plochy, do které jsme trefili, a kousek odsadíme
  mark.lookAt(point.clone().add(normal));
  mark.position.addScaledVector(normal, 0.01);
  scene.add(mark);
  impacts.push(mark);
  if (impacts.length > MAX_IMPACTS) {
    const old = impacts.shift();
    scene.remove(old);
  }
}

// Zpětný ráz: po výstřelu zbraň lehce "cukne" dozadu a vrátí se
let recoil = 0;

function shoot() {
  // Vyšleme paprsek ze středu obrazovky do scény.
  // Cílem jsou stěny/sloupy i nepřátelé – bereme ten NEJBLIŽŠÍ zásah,
  // takže stěna před nepřítelem ho správně zacloní.
  raycaster.setFromCamera(screenCenter, camera);
  const targets = shootables.concat(enemies.map(e => e.sprite));
  const hits = raycaster.intersectObjects(targets, false);

  if (hits.length > 0) {
    const hit = hits[0];
    const enemy = hit.object.userData.enemyRef;
    if (enemy) {
      // Trefili jsme nepřítele
      damageEnemy(enemy);
    } else {
      // Trefili jsme stěnu/sloup/podlahu → stopa po zásahu
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      makeImpact(hit.point, normal);
    }
  }

  // Efekty: výšleh + zpětný ráz
  muzzleFlash.visible = true;
  recoil = 0.08;
}

// Levé tlačítko myši = výstřel (jen když hrajeme = myš je zamčená)
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  shoot();
});

// ------------------------------------------------------------
// 6) HERNÍ SMYČKA: běží ~60x za sekundu a překresluje obraz
// ------------------------------------------------------------

const clock = new THREE.Clock();
const SPEED = 5; // rychlost chůze (metry za sekundu)

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta(); // čas od minulého snímku (v sekundách)

  // --- Rozhlížení: přepočítáme natočení kamery z yaw/pitch ---
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // --- Pohyb WASD (jen když je myš zamčená = hrajeme) ---
  if (document.pointerLockElement === renderer.domElement) {
    // Směr "dopředu" a "doprava" podle toho, kam se díváme (jen vodorovně)
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right   = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(forward);
    if (keys['KeyS']) move.sub(forward);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(SPEED * dt);
      // Zkusíme pohyb po osách zvlášť, ať to hezky "klouže" podél stěn
      const nx = camera.position.x + move.x;
      const nz = camera.position.z + move.z;
      if (!collides(nx, camera.position.z)) camera.position.x = nx;
      if (!collides(camera.position.x, nz)) camera.position.z = nz;
    }
  }

  // --- Nepřátelé ti ubližují, když jsi moc blízko ---
  if (!gameOver && document.pointerLockElement === renderer.domElement) {
    for (const e of enemies) {
      const dx = camera.position.x - e.sprite.position.x;
      const dz = camera.position.z - e.sprite.position.z;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        playerHealth -= 20 * dt; // ubývá životů za sekundu v blízkosti
        updateHud();
        if (playerHealth <= 0) { endGame('💀 Prohráls! Nepřátelé tě dostali.'); break; }
      }
    }
  }

  // --- Zpětný ráz zbraně: cukne dozadu (+z) a plynule se vrací ---
  if (recoil > 0) {
    recoil = Math.max(0, recoil - dt * 0.4); // rychlost návratu
  }
  gun.position.z = -0.6 + recoil;

  // Výšleh z hlavně svítí jen velmi krátce
  if (muzzleFlash.visible && recoil < 0.05) {
    muzzleFlash.visible = false;
  }

  renderer.render(scene, camera);
}
animate();

// ------------------------------------------------------------
// 7) Reakce na změnu velikosti okna
// ------------------------------------------------------------
window.addEventListener('resize', () => {
  const { w, h } = viewSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
