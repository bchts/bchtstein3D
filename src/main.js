// ============================================================
//  Moje střílečka – hlavní soubor hry (Milník 0 + 1)
//  Zatím: 3D místnost, chůze (WASD) a rozhlížení myší.
//  Vše je bohatě okomentované, ať víš, co která část dělá.
// ============================================================

import * as THREE from 'three';

// ------------------------------------------------------------
// 1) ZÁKLAD SCÉNY: scéna, kamera (oči hráče), renderer (kreslič)
// ------------------------------------------------------------

// Scéna = 3D svět, do kterého vkládáme objekty
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8); // světle modrá "obloha"
scene.fog = new THREE.Fog(0x87b8e8, 10, 60);  // mlha do dálky, ať to má hloubku

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
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// Směrové světlo = jako slunce, vrhá stíny
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(10, 20, 10);
sun.castShadow = true;
scene.add(sun);

// ------------------------------------------------------------
// 3) MÍSTNOST: podlaha, stěny a pár sloupů (překážek)
// ------------------------------------------------------------

const ROOM = 20;       // rozměr místnosti (20 x 20 metrů)
const WALL_H = 4;      // výška stěn
const WALL_T = 1;      // tloušťka stěn

// Podlaha
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM, ROOM),
  new THREE.MeshStandardMaterial({ color: 0x555555 })
);
floor.rotation.x = -Math.PI / 2; // otočíme naležato
floor.receiveShadow = true;
scene.add(floor);

// Sem si ukládáme všechny objekty, do kterých se dá střílet (pro "paprsek" výstřelu)
const shootables = [];
shootables.push(floor);

// Strop (jen barevný, ať nekoukáme do modré oblohy uvnitř)
const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM, ROOM),
  new THREE.MeshStandardMaterial({ color: 0x333333 })
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = WALL_H;
scene.add(ceiling);

// Sem si budeme ukládat všechny objekty, do kterých se nesmí projít (pro kolize)
const obstacles = [];

// Pomocná funkce: vytvoří kvádr (stěnu/sloup) a zaeviduje ho do kolizí
function makeBox(w, h, d, x, y, z, color) {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color })
  );
  box.position.set(x, y, z);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
  // Uložíme si jeho "obálku" (bounding box) pro kolize
  box.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(box);
  obstacles.push(bbox);
  shootables.push(box); // do stěn i sloupů se dá střílet
  return box;
}

const half = ROOM / 2;
// Čtyři obvodové stěny
makeBox(ROOM, WALL_H, WALL_T, 0, WALL_H / 2, -half, 0x8a8a9a); // severní
makeBox(ROOM, WALL_H, WALL_T, 0, WALL_H / 2, half, 0x8a8a9a);  // jižní
makeBox(WALL_T, WALL_H, ROOM, -half, WALL_H / 2, 0, 0x9a8a8a); // západní
makeBox(WALL_T, WALL_H, ROOM, half, WALL_H / 2, 0, 0x9a8a8a);  // východní

// Pár sloupů uprostřed jako překážky, ať se je do čeho zakoukat
makeBox(1.5, WALL_H, 1.5, -4, WALL_H / 2, -3, 0xcc6644);
makeBox(1.5, WALL_H, 1.5, 4, WALL_H / 2, -6, 0x44aa88);
makeBox(1.5, WALL_H, 1.5, 0, WALL_H / 2, 2, 0xaa8844);

// ------------------------------------------------------------
// 4) OVLÁDÁNÍ: rozhlížení myší (pointer lock) + pohyb WASD
// ------------------------------------------------------------

const overlay = document.getElementById('overlay');

// "yaw" = otáčení doleva/doprava, "pitch" = nahoru/dolů
let yaw = 0;
let pitch = 0;

// Kliknutí na překryv → zamkneme myš do hry (pointer lock)
overlay.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});

// Když se myš zamkne/odemkne, ukážeme/schováme překryv
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle('hidden', locked);
});

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

// Rozmístíme pár nepřátel po místnosti
spawnEnemy(-6, -7);
spawnEnemy(6, -8);
spawnEnemy(-2, -9);
spawnEnemy(7, 4);

// Když nepřítel dostane zásah
let kills = 0;
const hudEl = document.getElementById('hud');

function damageEnemy(enemy) {
  enemy.health -= 1;

  if (enemy.health <= 0) {
    // Mrtvý – odstraníme ze scény i ze seznamu
    scene.remove(enemy.sprite);
    const i = enemies.indexOf(enemy);
    if (i !== -1) enemies.splice(i, 1);
    kills += 1;
    if (hudEl) hudEl.textContent = 'Zabito: ' + kills;
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
