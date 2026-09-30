import * as THREE from './vendor/three.module.js';

const fur = {
  mouse: new THREE.MeshLambertMaterial({ color: 0xb4a7a3, flatShading: true }),
  cat: new THREE.MeshLambertMaterial({ color: 0xe9a354, flatShading: true }),
};
const pink = new THREE.MeshLambertMaterial({ color: 0xf4a8af, flatShading: true });
const cream = new THREE.MeshLambertMaterial({ color: 0xffdfad, flatShading: true });
const ink = new THREE.MeshBasicMaterial({ color: 0x493a42 });
const nose = new THREE.MeshBasicMaterial({ color: 0xc66f7c });
const round = new THREE.IcosahedronGeometry(1, 1);

function blob(parent, material, position, size) {
  const mesh = new THREE.Mesh(round, material);
  mesh.position.set(...position);
  mesh.scale.set(...size);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function tail(parent, points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 5, false), material);
  mesh.castShadow = true;
  parent.add(mesh);
}

function zTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 94px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#514477';
  ctx.strokeText('Z', 64, 66);
  ctx.fillStyle = '#fff2af';
  ctx.fillText('Z', 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeAnimal(type) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const material = fur[type];
  const mouse = type === 'mouse';
  blob(body, material, [0, .17, -.1], mouse ? [.31, .18, .39] : [.41, .23, .46]);
  blob(body, material, [0, .26, .27], mouse ? [.25, .22, .24] : [.30, .27, .28]);
  if (mouse) {
    for (const side of [-1, 1]) {
      blob(body, material, [side * .18, .44, .22], [.13, .17, .10]);
      blob(body, pink, [side * .18, .45, .297], [.086, .12, .025]);
    }
    tail(body, [[0,.19,-.42],[.2,.16,-.59],[.36,.19,-.62],[.43,.24,-.53]], .025, pink);
  } else {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(.16, .29, 3), material);
      ear.position.set(side * .2, .53, .25);
      ear.rotation.y = Math.PI / 2;
      ear.castShadow = true;
      body.add(ear);
      blob(body, cream, [side * .12, .12, .39], [.14, .075, .15]);
    }
    tail(body, [[.28,.17,-.38],[.47,.16,-.49],[.56,.27,-.39],[.47,.32,-.23]], .067, material);
  }
  for (const side of [-1, 1]) {
    // Small angled marks read as closed, contented eyes from the starting camera.
    const eye = blob(body, ink, [side * (mouse ? .105 : .135), .29, mouse ? .491 : .538], [.068, .016, .012]);
    eye.rotation.z = side * .25;
  }
  blob(body, nose, [0, .22, mouse ? .51 : .545], [.035, .025, .018]);
  return { root, body };
}

export function createSleepers(scene, items, heightAt) {
  const texture = zTexture();
  return items.map((item, index) => {
    const { root, body } = makeAnimal(item.type);
    const surfaceY = heightAt(item.x, item.z) + item.altitude;
    root.position.set(item.x, surfaceY, item.z);
    root.scale.setScalar(item.scale || 1);
    scene.add(root);
    const zees = Array.from({ length: 3 }, (_, i) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.scale.setScalar(.27 + i * .07);
      scene.add(sprite);
      return sprite;
    });
    return { root, body, zees, x: item.x, z: item.z, surfaceY, phase: index * 1.7 };
  });
}

export function animateSleepers(sleepers, time) {
  for (const sleeper of sleepers) {
    sleeper.body.scale.y = 1 + Math.sin(time * 2.2 + sleeper.phase) * .025;
    for (let i = 0; i < sleeper.zees.length; i++) {
      const sprite = sleeper.zees[i];
      const progress = ((time * .22 + i / 3 + sleeper.phase * .11) % 1 + 1) % 1;
      sprite.position.set(
        sleeper.x + .28 + Math.sin(progress * Math.PI * 2 + sleeper.phase) * .08,
        sleeper.surfaceY + .55 + progress * 1.05,
        sleeper.z + .28
      );
      sprite.material.opacity = Math.sin(progress * Math.PI) * .94;
      sprite.scale.setScalar(.34 + progress * .28);
    }
  }
}
