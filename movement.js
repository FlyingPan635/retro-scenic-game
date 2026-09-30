// 复古第三人称：A/D 改变朝向，W/S 沿角色朝向前进或倒退。
// 镜头角度不参与行走计算，拖动镜头不会让角色突然掉头。
export function tankStep(facing, forward, turn, speed, dt) {
  const turnInput = Math.max(-1, Math.min(1, turn));
  const walkInput = Math.max(-1, Math.min(1, forward));
  // three.js 的正 Y 旋转会把朝向 -Z 的角色转向左侧，D 需要取负号。
  const nextFacing = facing - turnInput * 3.3 * dt;
  const distance = walkInput * speed * dt * (walkInput < 0 ? .72 : 1);
  return {
    facing: nextFacing,
    turnDelta: nextFacing - facing,
    dx: -Math.sin(nextFacing) * distance,
    dz: -Math.cos(nextFacing) * distance,
    distance,
  };
}
