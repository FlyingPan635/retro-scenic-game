// cloud&hill：地图数据都放在这里。坐标采用 { x, z }，单位约为米。
// 改 terrain 可重塑草坡；改 paths、objects、groves 可布置探索区域。
export const MAP = {
  title: 'cloud&hill',
  seed: 4207,
  size: 150,
  spawn: { x: 1, z: 18, facing: 0, cameraYaw: 1.15 },
  terrain: {
    base: -0.7,
    waves: [
      { amplitude: 1.45, frequencyX: 0.055, frequencyZ: 0.052, phase: 0.7 },
      { amplitude: 0.7, frequencyX: 0.12, frequencyZ: 0.09, phase: 2.1 },
    ],
    hills: [
      { x: -22, z: -25, height: 4.6, radius: 23 },
      { x: 29, z: -20, height: 4.4, radius: 32 },
      { x: -44, z: 17, height: 2.5, radius: 28 },
      { x: 31, z: 33, height: 2.1, radius: 35 },
    ],
  },
  // 河流从北向南流过西侧草坡；points 为 [x, z]，width 是水面的宽度。
  river: {
    width: 6.2,
    points: [[-10, 75], [-11, 55], [-13, 34], [-15, 17], [-27, -1], [-43, -21], [-51, -44], [-58, -75]],
  },
  // 每条 path 是一条自动贴合地形的路。points 按行走顺序排列。
  paths: [
    { width: 2.3, points: [[4, 61], [3, 42], [1, 21], [-1, 9], [-6, -2], [-12, -13], [-11, -22], [-13, -31], [-21, -42]] },
    { width: 1.8, points: [[-7, -3], [4, -7], [15, -13], [29, -22], [39, -35]] },
  ],
  // objects 支持 tent、windmill、tree、sign、flowerPatch、rock。
  objects: [
    { type: 'tent', x: -21, z: -29, scale: 1.22, label: '落日马戏团' },
    { type: 'windmill', x: 37, z: -32, scale: 1, label: '风车坡' },
    { type: 'sign', x: -4, z: 5, text: '马戏团 ←   /   风车 →' },
    { type: 'tree', x: 15, z: -6, scale: 1.45 },
    { type: 'tree', x: 21, z: -11, scale: 1.1 },
    { type: 'tree', x: 33, z: -15, scale: 1.5 },
    { type: 'tree', x: -32, z: -20, scale: 1.2 },
    { type: 'tree', x: -38, z: -13, scale: 1.5 },
    { type: 'tree', x: -40, z: -27, scale: 1.05 },
    { type: 'tree', x: 6, z: -38, scale: 0.9 },
    { type: 'tree', x: 12, z: -43, scale: 1.15 },
    { type: 'tree', x: 49, z: 6, scale: 1.4 },
    { type: 'tree', x: 43, z: 15, scale: 1.1 },
    { type: 'tree', x: -41, z: 23, scale: 1.3 },
    { type: 'rock', x: 7, z: 10, scale: 1.1 },
    { type: 'rock', x: -29, z: -37, scale: 1.4 },
    { type: 'rock', x: 26, z: -26, scale: 0.9 },
    { type: 'flowerPatch', x: -8, z: 6, radius: 3.7, count: 16 },
    { type: 'flowerPatch', x: 11, z: -16, radius: 4.3, count: 22 },
    { type: 'flowerPatch', x: -30, z: -28, radius: 4, count: 18 },
    { type: 'flowerPatch', x: 29, z: 6, radius: 5.2, count: 25 },
  ],
  // groves 用固定种子生成疏密不一的远景树丛。
  groves: [
    { x: -57, z: -35, radius: 18, count: 13 },
    { x: 54, z: -34, radius: 19, count: 17 },
    { x: -51, z: 42, radius: 16, count: 11 },
    { x: 48, z: 42, radius: 19, count: 13 },
    { x: -7, z: -61, radius: 28, count: 16 },
  ],
  // 飞鸟在中心附近做缓弧飞行。
  birds: [
    { x: 5, z: -1, altitude: 9.8, radius: 6.5, speed: .28, scale: 1, color: 0x5d9dc2 },
    { x: -9, z: -5, altitude: 13, radius: 8.5, speed: .22, scale: .95, color: 0xd58c86 },
    { x: -26, z: -19, altitude: 15, radius: 10, speed: .19, scale: 1, color: 0x7cadd1 },
    { x: 22, z: -18, altitude: 14, radius: 9.5, speed: .25, scale: .9, color: 0xe1bb6d },
    { x: 38, z: -35, altitude: 16, radius: 11, speed: .2, scale: .95, color: 0x83b5c5 },
  ],
  // 睡着的小动物：altitude 是物件顶面相对地面的高度。
  sleepers: [
    { type: 'mouse', x: -4.5, z: 5, altitude: 2.57, scale: 1.15 },
    { type: 'cat', x: 7, z: 10, altitude: .68, scale: 1.25 },
  ],
};
