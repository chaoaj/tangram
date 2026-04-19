// level.js - Debug viewer for levels-new.json (falls back to levels.json)
document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('levelSelect');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const info = document.getElementById('info');
  const canvas = document.getElementById('cv');
  const ctx = canvas.getContext('2d');
  let levelsData = null;
  let current = 0;

  function tryLoad() {
    // load only levels-new.json for previewing exported outlines
    return fetch('levels-new.json').then(r => {
      if (!r.ok) throw new Error('levels-new.json not ok');
      return r.json();
    });
  }

  // normalize different shapes of JSON into { levels: [...] }
  function normalizeData(raw) {
    if (!raw) return { levels: [] };
    if (raw.levels && Array.isArray(raw.levels)) return raw;
    if (Array.isArray(raw)) return { levels: raw };
    // single level object
    if (raw.target || raw.pieces || raw.id) return { levels: [raw] };
    return { levels: [] };
  }

  function populate() {
    while (select.firstChild) select.removeChild(select.firstChild);
    if (!levelsData || !levelsData.levels) return;
    levelsData.levels.forEach((lvl, idx) => {
      const opt = document.createElement('option'); opt.value = String(idx); opt.textContent = lvl.name || `Level ${idx+1}`;
      select.appendChild(opt);
    });
    select.value = String(current);
  }

  function drawLevel(idx) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!levelsData || !levelsData.levels || !levelsData.levels[idx]) return;
    const lvl = levelsData.levels[idx];
    info.textContent = `id=${lvl.id} name=${lvl.name} `;
    const t = lvl.target || { bbox: [0,0,1,1] };
    const margin = 40;
    const tw = canvas.width - margin*2;
    const th = canvas.height - margin*2;
    const tx = margin;
    const ty = margin;

    // draw bbox box (full target area)
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
    ctx.strokeRect(tx, ty, tw, th);

    function flattenOutlinePoints(outline) {
      if (!outline || !outline.length) return [];
      if (Array.isArray(outline[0]) && Array.isArray(outline[0][0])) {
        let points = [];
        for (let ring of outline) points = points.concat(ring);
        return points;
      }
      return outline;
    }

    function getOutlineSpan(points) {
      if (!points.length) return { width: 0, height: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let point of points) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
      return { width: maxX - minX, height: maxY - minY };
    }

    // helper to draw one target entry (with its own bbox inside the full target area)
    function drawTargetEntry(entry) {
      // entry.bbox normalized relative to full target area
      const bb = entry.bbox || [0,0,1,1];
      const bx = tx + bb[0] * tw;
      const by = ty + bb[1] * th;
      const bw = Math.max(1, bb[2] * tw);
      const bh = Math.max(1, bb[3] * th);
      const points = flattenOutlinePoints(entry.outline);
      const span = getOutlineSpan(points);
      const hasRenderableOutline = entry.outline && entry.outline.length && span.width > 0.02 && span.height > 0.02;

      ctx.save();
      ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();

      if (hasRenderableOutline) {
        // support single-ring or multi-ring outlines
        ctx.fillStyle = 'rgba(200,200,200,0.95)';
        if (Array.isArray(entry.outline[0]) && Array.isArray(entry.outline[0][0])) {
          for (let ring of entry.outline) {
            ctx.beginPath();
            for (let i = 0; i < ring.length; i++) {
              const p = ring[i];
              const x = bx + p[0] * bw;
              const y = by + p[1] * bh;
              if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
          }
        } else {
          ctx.beginPath();
          for (let i = 0; i < entry.outline.length; i++) {
            const p = entry.outline[i];
            const x = bx + p[0] * bw;
            const y = by + p[1] * bh;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
        }
        // draw sample points (flatten all rings so multi-ring outlines show all points)
        ctx.fillStyle = '#000';
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          const x = bx + p[0] * bw;
          const y = by + p[1] * bh;
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(200,200,200,0.35)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(bx + bw / 2, by + bh / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#222';
      ctx.font = '12px Arial, sans-serif';
      ctx.fillText(entry.name || 'target', bx + 4, Math.max(12, by - 6));
    }

    if (t.targets && Array.isArray(t.targets)) {
      // multiple sub-targets
      for (let entry of t.targets) drawTargetEntry(entry);
      info.textContent += `targets=${t.targets.length}`;
      console.log('Level debug draw:', lvl.name, 'targets=', t.targets.length);
    } else {
      // single target: respect its bbox if provided
      const tb = t.bbox || [0,0,1,1];
      const singleEntry = { bbox: tb, outline: t.outline };
      drawTargetEntry(singleEntry);
      info.textContent += (t.outline && t.outline.length) ? `outlinePts=${t.outline.length}` : 'outlinePts=0 (filled bbox)';
      if (typeof t.scale !== 'undefined') info.textContent += ` scale=${t.scale}`;
      console.log('Level debug draw:', lvl.name, 'single target', 'bbox=', tb);
    }
  }

  select.onchange = () => { current = parseInt(select.value || '0',10); drawLevel(current); };
  prevBtn.onclick = () => { current = Math.max(0, current-1); select.value = String(current); drawLevel(current); };
  nextBtn.onclick = () => { current = Math.min((levelsData.levels.length-1)||0, current+1); select.value = String(current); drawLevel(current); };
  const reloadBtn = document.getElementById('reloadBtn');
  if (reloadBtn) reloadBtn.onclick = () => {
    tryLoad().then(data => {
      levelsData = normalizeData(data);
      populate();
      current = 0;
      drawLevel(current);
      console.log('Reloaded levels-new.json/levels.json');
    }).catch(err => console.error('Reload failed', err));
  };

  tryLoad().then(data => {
    levelsData = normalizeData(data);
    console.log('Loaded levels for debug:', (levelsData && levelsData.levels && levelsData.levels.length) || 0);
    populate();
    drawLevel(current);
  }).catch(err => {
    console.error('Failed to load levels-new.json for preview', err);
    alert('Failed to load levels-new.json — export a level from the maker first.');
  });
});
