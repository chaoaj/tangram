// Tangram-like puzzle: draggable polygon pieces, rotation, snapping to target
// Controls: drag with mouse, press 'r' to rotate selected piece 45° clockwise, 'R' to rotate counter-clockwise, 'h' to toggle hint, 'space' to reset

let pieces = [];
let targetLayout = [];
let selected = null;
let offset = { x: 0, y: 0 };
let showHint = true;
let levelComplete = false;
let touchStartPos = null;
let didTouchMove = false;
let levelsData = null;
let currentLevel = 0; // index into levelsData.levels
// touch gesture helpers
let lastTapTime = 0;
let lastTapPos = null;
let touchLastPos = null;

function setup() {
  createCanvas(windowWidth, windowHeight);
  angleMode(DEGREES);
  textFont('Arial');
  // load levels
  fetch('levels.json').then(r => r.json()).then(data => {
    levelsData = data;
    currentLevel = 0;
    initLevel();
    setupUI();
  }).catch(err => {
    console.error('failed to load levels.json', err);
    // fallback
    initLevel();
    setupUI();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  initLevel();
}

function initLevel() {
  // load level data (levels.json) if available, otherwise use defaults
  const levelSpec = (levelsData && levelsData.levels && levelsData.levels[currentLevel]) || null;
  // target area on left
  const size = min(480, floor(min(width, height) * 0.6));
  const tx = 40; // left margin
  // position target area about 200px from top, but keep it on-screen
  let ty = 200;
  if (ty + size > height - 20) ty = max(20, height - size - 20);
  const scatterLeft = tx + size + 40; // start x for scattering pieces on right

  // reset level state
  levelComplete = false;
  selected = null;

  // canonical unit-piece definitions (normalized coords inside 0..1 square)
  const u = (x, y) => [x, y];
    // compute normalized PA dims so mapped width ~240px and height ~120px relative to `size`
    const paTargetPxW = 240;
    const paTargetPxH = 120;
    const wNorm = min(0.9, paTargetPxW / size); // clamp so it stays inside unit square
    const hNorm = min(0.9, paTargetPxH / size);
    // center PA to the right side of the target (approx location inside unit coords)
    const paCx = 0.65;
    const paCy = 0.5;
    const shear = 0.12; // horizontal shear applied to top/right vertices (normalized)
    // define 7 piece shapes in unit coordinates (non-degenerate, center-based later)
    // These are approximate canonical tangram pieces that tile a unit square.
    const unitPolys = [
      // Large triangle A (bottom-left corner)
      { name: 'LT1', verts: [u(0,0), u(0.5,0.5), u(1,0)] },
      // Large triangle B (top-right corner)
      { name: 'LT2', verts: [u(0,1), u(0.5,0.5), u(1,1)] },
      // Medium triangle (right-side, right triangle half-size)
      { name: 'MT', verts: [u(0.5,0.25), u(1.0,0.25), u(0.5,0.75)] },
      // Small triangle A (bottom-center)
      { name: 'ST1', verts: [u(0.25,0.25), u(0.5,0.5), u(0.75,0.25)] },
      // Small triangle B (top-center)
      { name: 'ST2', verts: [u(0.25,0.75), u(0.5,0.5), u(0.75,0.75)] },
      // Square (diamond-oriented)
      { name: 'SQ', verts: [u(0.5,0.25), u(0.75,0.5), u(0.5,0.75), u(0.25,0.5)] },
      // Parallelogram -> parallelogram with top/bottom length ~=240px and left/right sides ~=120px
      (() => {
        // desired sizes expressed as fractions of the target size (responsive)
        // For a 480px target, width=240 -> 0.5; height=120 -> 0.25
        const desiredWNorm = 0.5;
        const desiredHNorm = 0.25;
        // normalized lengths relative to the unit target (clamped to remain inside)
        let bNorm = min(0.9, desiredWNorm);
        let hNorm = min(0.9, desiredHNorm);
        // choose shear so the left corner angle is 45 degrees: tan(theta)=h/s => for 45deg s=h
        const shear = hNorm;
        // clamp center so polygon stays inside unit square: paCx in [bNorm/2, 1 - bNorm/2 - shear]
        const minCx = bNorm / 2;
        const maxCx = max(minCx, 1 - bNorm / 2 - shear);
        const cx = constrain(paCx, minCx, maxCx);
        // clamp vertical center
        const cy = constrain(paCy, hNorm / 2, 1 - hNorm / 2);
        // build top/bottom coordinates
        const tlx = cx - bNorm / 2;
        const trx = cx + bNorm / 2;
        const tly = cy - hNorm / 2;
        const bry = cy + hNorm / 2;
        const verts = [
          u(tlx, tly),
          u(trx, tly),
          u(trx + shear, bry),
          u(tlx + shear, bry)
        ];
        return { name: 'PA', verts };
      })()
    ];

  // build targets and pieces: map unit coords into actual target bbox using levelSpec.target bbox if present
  // target bbox normalized coordinates in levelSpec.target.bbox [x,y,w,h] (0..1)
  const targetBBox = levelSpec && levelSpec.target && levelSpec.target.bbox ? levelSpec.target.bbox : [0,0,1,1];
  const bx = tx + targetBBox[0] * size;
  const by = ty + targetBBox[1] * size;
  const bw = targetBBox[2] * size || size;
  const bh = targetBBox[3] * size || size;

  // create targetLayout entry (single gray target region)
  targetLayout = [];
  targetLayout.push({ name: 'targetRegion', x: bx + bw/2, y: by + bh/2, w: bw, h: bh });

  // compute piece targets from levelSpec pieces (normalized tx,ty) if provided
  const pieceTargets = {};
  if (levelSpec && levelSpec.pieces) {
    for (let p of levelSpec.pieces) pieceTargets[p.name] = p;
  }

  // scatter pieces on right side in grid slots to avoid overlap
  pieces = [];
  const scatterW = max(220, width - scatterLeft - 40);
  let cols = max(2, floor(scatterW / (size / 3)));
  // don't have more columns than pieces
  const numPieces = unitPolys.length;
  cols = min(cols, numPieces);
  if (cols < 1) cols = 1;

  // compute rows needed and available vertical space beneath the target
  let rows = Math.ceil(numPieces / cols);
  let availableBelow = height - (ty + size) - 40; // space below target
  if (availableBelow < 0) availableBelow = height - 160; // fallback

  // compute cell sizes so rows fit in available space
  let cellH = Math.max(80, Math.floor(availableBelow / Math.max(1, rows)));
  // cap cellH to reasonable size relative to piece size
  cellH = min(cellH, Math.max(100, Math.floor(size / 2)));

  const cellW = Math.max(120, Math.floor(scatterW / Math.max(1, cols)));
  let slot = 0;
  // start scattering pieces below the target area, but adjust so all rows fit on screen
  let scatterTop = ty + size + 20;
  const totalRowsHeight = rows * cellH;
  if (scatterTop + totalRowsHeight + 40 > height) {
    // move scattering area up so last row fits
    scatterTop = Math.max(20, height - totalRowsHeight - 40);
  }

  for (let poly of unitPolys) {
    // map absolute vertices into target-space to compute centroid if piece target not specified
    const absVerts = poly.verts.map(v => [bx + v[0] * bw, by + v[1] * bh]);
    let sx = 0, sy = 0;
    for (let v of absVerts) { sx += v[0]; sy += v[1]; }
    const cxv = sx / absVerts.length;
    const cyv = sy / absVerts.length;

    const relVerts = absVerts.map(v => [v[0] - cxv, v[1] - cyv]);
    const target = { name: poly.name, x: cxv, y: cyv, angle: 0, relVerts };
    // create piece: vertices relative to centroid so piece draws around its pos
    const verts = relVerts.map(v => [v[0], v[1]]);
    // place in grid slots on the right side to avoid overlap
    const col = slot % cols;
    const row = floor(slot / cols);
    const px = scatterLeft + col * cellW + cellW / 2 + random(-10, 10);
    const py = scatterTop + row * cellH + cellH / 2 + random(-10, 10);
    slot++;
    let angle = random([0, 90, 180, 270]);
    // ensure PA piece is oriented at 45 degrees so its top/bottom map to requested width
    if (poly.name === 'PA') {
      angle = 45;
      target.angle = 45;
    }
    const p = new Piece(poly.name, verts, px, py, angle, color(random(80, 220), random(80, 220), random(80, 220), 220));
    p.target = target;
    pieces.push(p);
    console.log('created piece', poly.name, 'at', px.toFixed(1), py.toFixed(1));
    console.log('  abs verts:', absVerts.map(v => `(${v[0].toFixed(1)},${v[1].toFixed(1)})`).join(', '));
    console.log('  centroid:', cxv.toFixed(1), cyv.toFixed(1));
    console.log('  rel verts:', relVerts.map(v => `(${v[0].toFixed(1)},${v[1].toFixed(1)})`).join(', '));
  }
  console.log('initLevel: created pieces=', pieces.length, 'targets=', targetLayout.length);
}

class Piece {
  constructor(name, vertices, x, y, angle = 0, c) {
    this.name = name;
    this.vertices = vertices; // array of [x,y] local
    this.pos = createVector(x, y);
    this.angle = angle;
    this.col = c || color(200, 200, 200, 220);
    this.locked = false; // when snapped to target
    this.target = null;
    this.flipped = false;
  }

  draw(alpha = 255) {
    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.angle);
    fill(red(this.col), green(this.col), blue(this.col), alpha);
    stroke(40);
    strokeWeight(2);
    beginShape();
    for (let v of this.vertices) vertex(v[0], v[1]);
    endShape(CLOSE);
    pop();
  }

  contains(mx, my) {
    // point-in-polygon in local coords
    const cosA = cos(-this.angle);
    const sinA = sin(-this.angle);
    const dx = mx - this.pos.x;
    const dy = my - this.pos.y;
    const rx = dx * cosA - dy * sinA;
    const ry = dx * sinA + dy * cosA;
    let inside = false;
    for (let i = 0, j = this.vertices.length - 1; i < this.vertices.length; j = i++) {
      const xi = this.vertices[i][0], yi = this.vertices[i][1];
      const xj = this.vertices[j][0], yj = this.vertices[j][1];
      const intersect = ((yi > ry) != (yj > ry)) && (rx < (xj - xi) * (ry - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // check if piece is close enough to its target (pos and angle)
  checkSnap(posThreshold = 18, angleThreshold = 12) {
    if (!this.target) return false;
    const dx = dist(this.pos.x, this.pos.y, this.target.x, this.target.y);
    const da = abs(((this.angle - this.target.angle + 180) % 360) - 180);
    return dx < posThreshold && da < angleThreshold;
  }

  snapToTarget() {
    if (!this.target) return;
    this.pos.set(this.target.x, this.target.y);
    this.angle = this.target.angle;
    this.locked = true;
  }

  // flip piece horizontally (mirror in local x), toggles `flipped`
  flip() {
    for (let i = 0; i < this.vertices.length; i++) {
      this.vertices[i][0] = -this.vertices[i][0];
    }
    this.flipped = !this.flipped;
  }
}

function draw() {
  background(245);

  // draw instruction
  noStroke();
  fill(60);
  textSize(14);
  text('Drag pieces to the left target area. Tap to select, swipe to rotate, H for hint, Space to reset.', 12, 22);

  // draw target area outline
  drawTargetArea();

  // draw hint (target silhouettes)
  if (showHint) drawHints();

  // draw pieces (non-selected first)
  for (let p of pieces) if (p !== selected) p.draw();

  // debug: label pieces with index/name
  push();
  fill(0);
  noStroke();
  textSize(12);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    // compute world-space vertices for this piece
    const wverts = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let vi = 0; vi < p.vertices.length; vi++) {
      const v = p.vertices[vi];
      const wx = p.pos.x + (v[0] * cos(p.angle) - v[1] * sin(p.angle));
      const wy = p.pos.y + (v[0] * sin(p.angle) + v[1] * cos(p.angle));
      wverts.push([wx, wy]);
      minX = min(minX, wx); minY = min(minY, wy);
      maxX = max(maxX, wx); maxY = max(maxY, wy);
    }
    const bw = (isFinite(minX) ? (maxX - minX) : 0);
    const bh = (isFinite(minY) ? (maxY - minY) : 0);
    // piece header label
    text(`${i+1}: ${p.name}  [w:${bw.toFixed(0)} h:${bh.toFixed(0)}]`, p.pos.x + 8, p.pos.y - 8);
    // draw vertex markers and index numbers
    for (let vi = 0; vi < wverts.length; vi++) {
      const [vx, vy] = wverts[vi];
      fill(0);
      noStroke();
      ellipse(vx, vy, 6, 6);
      fill(255);
      textSize(10);
      textAlign(CENTER, CENTER);
      text(String(vi), vx, vy);
    }
    textAlign(LEFT, BASELINE);
    textSize(12);
    fill(0);
  }
  pop();

  // draw selected last with highlight
  if (selected) {
    selected.draw(255);
    // outline
    push();
    translate(selected.pos.x, selected.pos.y);
    rotate(selected.angle);
    noFill();
    stroke(0, 180, 255);
    strokeWeight(3);
    beginShape();
    for (let v of selected.vertices) vertex(v[0], v[1]);
    endShape(CLOSE);
    pop();
  }

  // check completion
  if (!levelComplete && pieces.every(p => p.locked || p.checkSnap())) {
    // snap any that are close
    for (let p of pieces) if (!p.locked && p.checkSnap()) p.snapToTarget();
    levelComplete = true;
  }

  if (levelComplete) {
    push();
    fill(50, 160, 60);
    textSize(36);
    textAlign(CENTER, CENTER);
    text('Level Complete!', width / 2, 60);
    pop();
  }
}

function drawTargetArea() {
  if (targetLayout.length === 0) return;
  const t = targetLayout[0];
  // draw filled gray region (no internal shape lines)
  push();
  noStroke();
  fill(200, 200, 200, 220);
  rectMode(CENTER);
  rect(t.x, t.y, t.w, t.h, 6);
  // label
  fill(40);
  textSize(12);
  textAlign(CENTER, TOP);
  text('Target', t.x, t.y - t.h/2 - 18);
  pop();
}

function drawHints() {
  // hints intentionally blank for the 'generic gray region' requirement
  return;
}

function mousePressed() {
  if (levelComplete) return;
  // iterate in reverse to pick topmost
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.locked) continue;
    if (p.contains(mouseX, mouseY)) {
      selected = p;
      // bring to top
      pieces.splice(i, 1);
      pieces.push(selected);
      offset.x = mouseX - selected.pos.x;
      offset.y = mouseY - selected.pos.y;
      return;
    }
  }
}

function mouseDragged() {
  if (selected && !selected.locked) {
    selected.pos.x = mouseX - offset.x;
    selected.pos.y = mouseY - offset.y;
  }
}

function mouseReleased() {
  if (selected) {
    // if close to target, snap
    if (selected.checkSnap()) {
      selected.snapToTarget();
    } else if (targetLayout.length > 0) {
      // try snapping to nearest edge of target region when releasing
      const snapped = snapPieceToRectEdge(selected, targetLayout[0], 20);
      if (snapped) {
        // do not lock unless angle matches; allow placement on edge
      }
    }
    selected = null;
  }
}

// Touch handlers for mobile
function touchStarted() {
  if (touches && touches.length > 1) return false;
  didTouchMove = false;
  touchStartPos = { x: touches && touches[0] ? touches[0].x : mouseX, y: touches && touches[0] ? touches[0].y : mouseY };
  touchLastPos = { ...touchStartPos };
  // double-tap detection
  const now = Date.now();
  const dt = now - (lastTapTime || 0);
  const tappedNear = lastTapPos && dist(touchStartPos.x, touchStartPos.y, lastTapPos.x, lastTapPos.y) < 40;
  const isDouble = dt > 0 && dt < 350 && tappedNear;
  if (isDouble) {
    // detect piece under the tap and flip it
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (p.contains(touchStartPos.x, touchStartPos.y)) {
        p.flip();
        // bring to top
        pieces.splice(i, 1);
        pieces.push(p);
        return false;
      }
    }
    lastTapTime = 0; lastTapPos = null;
    return false;
  }
  lastTapTime = now;
  lastTapPos = { ...touchStartPos };
  // reuse mousePressed logic but with touch coords
  const tx = touchStartPos.x, ty = touchStartPos.y;
  if (levelComplete) return false;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.locked) continue;
    if (p.contains(tx, ty)) {
      selected = p;
      pieces.splice(i, 1);
      pieces.push(selected);
      offset.x = tx - selected.pos.x;
      offset.y = ty - selected.pos.y;
      return false;
    }
  }
  return false;
}

function touchMoved() {
  didTouchMove = true;
  if (selected && !selected.locked) {
    const tx = touches && touches[0] ? touches[0].x : mouseX;
    const ty = touches && touches[0] ? touches[0].y : mouseY;
    selected.pos.x = tx - offset.x;
    selected.pos.y = ty - offset.y;
    touchLastPos = { x: tx, y: ty };
  }
  return false;
}

function touchEnded() {
  // if there was a tap (no meaningful move) and a piece was selected, rotate it
  if (!didTouchMove && touchStartPos && selected) {
    // single tap = rotate 90° clockwise
    selected.angle = (selected.angle + 90) % 360;
  } else if (didTouchMove && touchStartPos && selected) {
    // swipe rotation based on horizontal direction
    const end = touchLastPos || { x: mouseX, y: mouseY };
    const dx = end.x - touchStartPos.x;
    const dy = end.y - touchStartPos.y;
    if (abs(dx) > 30 && abs(dx) > abs(dy)) {
      selected.angle = (selected.angle + (dx > 0 ? 90 : -90)) % 360;
    } else if (abs(dy) > 30 && abs(dy) > abs(dx)) {
      // vertical swipe rotates opposite direction
      selected.angle = (selected.angle + (dy < 0 ? 90 : -90)) % 360;
    }
  }
  if (selected) {
    if (selected.checkSnap()) selected.snapToTarget();
    else if (targetLayout.length > 0) snapPieceToRectEdge(selected, targetLayout[0], 20);
    selected = null;
  }
  touchStartPos = null;
  didTouchMove = false;
  return false;
}

function keyPressed() {
  if (key === ' '){
    initLevel();
    return;
  }
  if (key === 'h' || key === 'H') {
    showHint = !showHint;
    return;
  }
  if ((key === 'r' || key === 'R') && selected) {
    // rotate clockwise for 'r' lowercase, counter for uppercase
    const delta = (key === 'r') ? 45 : -45;
    selected.angle = (selected.angle + delta) % 360;
    return;
  }
  if ((key === 'f' || key === 'F') && selected) {
    selected.flip();
    return;
  }
}

// Snap a piece to the nearest point on a rectangle's perimeter if within threshold.
function snapPieceToRectEdge(piece, rect, threshold = 18) {
  if (!piece || !rect) return false;
  // rect: {x,y,w,h} with rectMode CENTER
  const left = rect.x - rect.w / 2;
  const right = rect.x + rect.w / 2;
  const top = rect.y - rect.h / 2;
  const bottom = rect.y + rect.h / 2;
  const px = piece.pos.x;
  const py = piece.pos.y;

  // find nearest point on perimeter
  let nx = constrain(px, left, right);
  let ny = constrain(py, top, bottom);

  if (px >= left && px <= right) {
    // vertical projection inside horizontal span -> choose nearer horizontal edge
    const dTop = abs(py - top);
    const dBottom = abs(py - bottom);
    ny = dTop < dBottom ? top : bottom;
    nx = px;
  } else if (py >= top && py <= bottom) {
    // horizontal projection inside vertical span -> choose nearer vertical edge
    const dLeft = abs(px - left);
    const dRight = abs(px - right);
    nx = dLeft < dRight ? left : right;
    ny = py;
  } else {
    // outside corner region: nx,ny already clamped to inside rect; need nearest corner
    // choose corner closest to piece
    const corners = [[left, top], [right, top], [right, bottom], [left, bottom]];
    let best = corners[0];
    let bestD = dist(px, py, best[0], best[1]);
    for (let i = 1; i < corners.length; i++) {
      const c = corners[i];
      const d = dist(px, py, c[0], c[1]);
      if (d < bestD) { best = c; bestD = d; }
    }
    nx = best[0]; ny = best[1];
  }

  const d = dist(px, py, nx, ny);
  if (d <= threshold) {
    piece.pos.x = nx;
    piece.pos.y = ny;
    return true;
  }
  return false;
}

// UI helpers
function setupUI() {
  const levelSelect = document.getElementById('levelSelect');
  const checkBtn = document.getElementById('checkBtn');
  const resetBtn = document.getElementById('resetBtn');

  // populate level select
  while (levelSelect.firstChild) levelSelect.removeChild(levelSelect.firstChild);
  if (levelsData && levelsData.levels && levelsData.levels.length > 0) {
    levelsData.levels.forEach((lvl, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = lvl.name || `Level ${idx+1}`;
      levelSelect.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option'); opt.value = '0'; opt.textContent = 'Level 1'; levelSelect.appendChild(opt);
  }
  levelSelect.value = String(currentLevel);

  levelSelect.onchange = () => {
    const idx = parseInt(levelSelect.value || '0', 10);
    if (!isNaN(idx)) {
      currentLevel = idx;
      initLevel();
    }
  };

  checkBtn.onclick = () => checkSolution();
  resetBtn.onclick = () => initLevel();
}

function checkSolution() {
  if (pieces.length === 0) return;
  if (!targetLayout || targetLayout.length === 0) {
    alert('No target defined for this level.');
    return;
  }
  const t = targetLayout[0];
  // create offscreen graphics matching target pixel size
  const gw = max(1, floor(t.w));
  const gh = max(1, floor(t.h));
  const gAll = createGraphics(gw, gh);
  gAll.pixelDensity(1);
  gAll.background(0);
  gAll.noStroke();
  gAll.fill(255);

  // helper to draw a piece onto a graphics buffer (coords relative to target top-left)
  function drawPieceTo(gfx, piece) {
    gfx.push();
    gfx.noStroke();
    gfx.fill(255);
    gfx.beginShape();
    for (let v of piece.vertices) {
      // local vertex -> world
      const wx = piece.pos.x + (v[0] * cos(piece.angle) - v[1] * sin(piece.angle));
      const wy = piece.pos.y + (v[0] * sin(piece.angle) + v[1] * cos(piece.angle));
      // transform to target-local coords (top-left origin)
      const localX = wx - (t.x - t.w / 2);
      const localY = wy - (t.y - t.h / 2);
      gfx.vertex(localX, localY);
    }
    gfx.endShape(CLOSE);
    gfx.pop();
  }

  // draw combined
  for (let p of pieces) drawPieceTo(gAll, p);
  gAll.loadPixels();
  let combinedPx = 0;
  for (let i = 0; i < gAll.pixels.length; i += 4) {
    if (gAll.pixels[i] > 0) combinedPx++;
  }

  // draw each piece individually and sum pixels
  let sumIndividual = 0;
  for (let p of pieces) {
    const gi = createGraphics(gw, gh);
    gi.pixelDensity(1);
    gi.background(0);
    gi.noStroke();
    gi.fill(255);
    drawPieceTo(gi, p);
    gi.loadPixels();
    let pxCount = 0;
    for (let i = 0; i < gi.pixels.length; i += 4) if (gi.pixels[i] > 0) pxCount++;
    sumIndividual += pxCount;
  }

  // overlap exists if sum of individual covered pixels > combined covered pixels
  const overlapPx = Math.max(0, sumIndividual - combinedPx);

  const targetAreaPx = gw * gh;
  const coverage = combinedPx / targetAreaPx;
  const overlapFraction = overlapPx / targetAreaPx;

  // relaxed acceptance rules: allow small overlaps (<= 2% of target) and slightly lower coverage threshold
  const maxOverlapFraction = 0.02; // allow up to 2% overlap
  const coverageThreshold = 0.97; // 97% coverage required

  if (overlapFraction > maxOverlapFraction) {
    alert(`Too much overlap inside target (${(overlapFraction*100).toFixed(2)}%). Reduce overlaps.`);
    return;
  }
  if (coverage >= coverageThreshold) {
    // snap any that are very close
    for (let p of pieces) if (!p.locked && p.checkSnap(20, 18)) p.snapToTarget();
    levelComplete = true;
    alert(`Solution accepted — coverage ${(coverage*100).toFixed(1)}% overlap ${(overlapFraction*100).toFixed(2)}%.`);
  } else {
    alert(`Coverage ${(coverage*100).toFixed(1)}% — need ${(coverageThreshold*100).toFixed(0)}% to complete.`);
  }
}
