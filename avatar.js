import * as THREE from './vendor/three.module.js';

export function createAvatar() {
  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);
  const mat = color => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const cloth = mat(0xf2c85b), clothLight = mat(0xffe498);
  const skin = mat(0xf2b58e), red = mat(0xc85861);
  const dark = mat(0x3b5263), boots = mat(0x654a48);
  const pack = mat(0x5e666e), packFlap = mat(0x85545a);
  const face = mat(0x342f37);

  function mesh(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z);
    item.scale.set(sx, sy, sz);
    item.castShadow = true;
    parent.add(item);
    return item;
  }

  const lowSphere = new THREE.IcosahedronGeometry(1, 1);
  mesh(upper, lowSphere, cloth, 0, 1.12, 0, .36, .43, .27);
  mesh(upper, lowSphere, clothLight, 0, 1.04, -.21, .2, .23, .07);
  mesh(upper, new THREE.CylinderGeometry(.26, .26, .1, 8), dark, 0, .81, 0);

  // 正面表情和帽檐；背面背包在第三人称镜头下更显眼。
  mesh(upper, lowSphere, skin, 0, 1.69, -.025, .29, .31, .27);
  mesh(upper, lowSphere, face, -.102, 1.71, -.285, .026, .028, .023);
  mesh(upper, lowSphere, face, .102, 1.71, -.285, .026, .028, .023);
  mesh(upper, new THREE.ConeGeometry(.045, .085, 4), skin, 0, 1.61, -.315);
  mesh(upper, new THREE.CylinderGeometry(.31, .32, .21, 8), red, 0, 1.94, -.005);
  mesh(upper, new THREE.CylinderGeometry(.42, .36, .045, 8), red, 0, 1.85, -.09);
  mesh(upper, new THREE.TorusGeometry(.26, .06, 4, 8), red, 0, 1.41, 0).rotation.x = Math.PI / 2;
  const scarfTail = mesh(upper, new THREE.BoxGeometry(.13, .29, .055), red, .17, 1.27, -.255);
  scarfTail.rotation.z = -.15;

  mesh(upper, lowSphere, pack, 0, 1.12, .31, .32, .38, .21);
  mesh(upper, new THREE.BoxGeometry(.49, .17, .14), packFlap, 0, 1.38, .43);
  mesh(upper, new THREE.BoxGeometry(.12, .1, .035), clothLight, 0, 1.33, .51);
  for (const side of [-1, 1]) {
    const strap = mesh(upper, new THREE.BoxGeometry(.07, .51, .04), boots, side * .22, 1.13, -.18);
    strap.rotation.z = side * .12;
  }

  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * .36, 1.33, 0); upper.add(arm);
    const sleeve = mesh(arm, new THREE.CylinderGeometry(.11, .105, .38, 6), cloth, side * .025, -.20, 0);
    sleeve.rotation.z = side * .13;
    mesh(arm, lowSphere, skin, side * .055, -.43, 0, .095, .095, .095);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(side * .16, .76, 0); root.add(leg);
    mesh(leg, new THREE.CylinderGeometry(.115, .10, .54, 6), dark, 0, -.28, 0);
    mesh(leg, lowSphere, boots, 0, -.62, -.08, .16, .12, .24);
    legs.push(leg);
  }

  function animate(activity, clock, time) {
    const swing = Math.sin(clock) * activity;
    legs[0].rotation.x = swing * .48;
    legs[1].rotation.x = -swing * .48;
    arms[0].rotation.x = -swing * .35;
    arms[1].rotation.x = swing * .35;
    upper.position.y = activity ? Math.abs(swing) * .045 : Math.sin(time * 2.2) * .015;
    upper.rotation.z = activity ? Math.sin(clock * .5) * .023 * activity : 0;
  }

  return { root, animate };
}
