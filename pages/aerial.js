(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let waypoints = [];
  let simFrame = 0;
  let simProgress = 0;
  let simRunning = false;

  function saveLocal() {
    localStorage.setItem('nougat-studio-aerial-waypoints', JSON.stringify(waypoints));
  }
  function loadLocal() {
    try { waypoints = JSON.parse(localStorage.getItem('nougat-studio-aerial-waypoints') || '[]') || []; }
    catch (_) { waypoints = []; }
  }
  function geometry(points, w = 900, h = 520, pad = 50) {
    if (!points.length) return [];
    let minLat = Math.min(...points.map(p => +p.lat));
    let maxLat = Math.max(...points.map(p => +p.lat));
    let minLon = Math.min(...points.map(p => +p.lon));
    let maxLon = Math.max(...points.map(p => +p.lon));
    if (minLat === maxLat) { minLat -= .001; maxLat += .001; }
    if (minLon === maxLon) { minLon -= .001; maxLon += .001; }
    return points.map(p => ({
      x: pad + (+p.lon - minLon) / (maxLon - minLon) * (w - pad * 2),
      y: pad + (maxLat - +p.lat) / (maxLat - minLat) * (h - pad * 2),
      lat: +p.lat,
      lon: +p.lon,
      alt: +p.alt || 0
    }));
  }
  function interp(points, t) {
    if (!points.length) return null;
    if (points.length === 1) return { ...points[0], leg: 1 };
    const scaled = Math.max(0, Math.min(.999999, t)) * (points.length - 1);
    const i = Math.floor(scaled), f = scaled - i;
    const a = points[i], b = points[Math.min(i + 1, points.length - 1)];
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      alt: a.alt + (b.alt - a.alt) * f,
      leg: i + 1
    };
  }
  function cancelSim() {
    simRunning = false;
    if (simFrame) cancelAnimationFrame(simFrame);
    simFrame = 0;
  }
  function renderList() {
    const list = $('waypointList');
    if (!waypoints.length) {
      list.innerHTML = '<div class="tool-empty">No waypoints yet.</div>';
      return;
    }
    list.innerHTML = waypoints.map((p, i) => `
      <div class="part-row">
        <div><strong>WP${i + 1}</strong><span>${(+p.lat).toFixed(6)}, ${(+p.lon).toFixed(6)} • ${(+p.alt).toFixed(1)} m</span></div>
        <button class="btn" data-remove="${i}">Remove</button>
      </div>`).join('');
    list.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
      waypoints.splice(Number(btn.dataset.remove), 1);
      saveLocal();
      simProgress = 0;
      cancelSim();
      render();
    }));
  }
  function render() {
    const svg = $('flightMap');
    const pts = geometry(waypoints);
    const poly = pts.map(v => `${v.x},${v.y}`).join(' ');
    const defs = `<defs><pattern id="grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="#183242" stroke-width="1"/></pattern></defs>`;
    svg.innerHTML = `${defs}<rect width="900" height="520" fill="#071018"/><rect width="900" height="520" fill="url(#grid)"/>${pts.length ? `<polyline points="${poly}" fill="none" stroke="#37a9ec" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>${pts.map((v, i) => `<circle cx="${v.x}" cy="${v.y}" r="7" fill="#f0f5f8" stroke="#1b8dca" stroke-width="3"/><text x="${v.x + 11}" y="${v.y - 11}" fill="#d9edf9" font-size="16">WP${i + 1}</text>`).join('')}<circle id="simCraft" cx="${pts[0].x}" cy="${pts[0].y}" r="10" fill="#52d684" stroke="#e6fff0" stroke-width="3"/>` : '<text x="50" y="80" fill="#8fa4b4" font-size="20">Add waypoints to build a cinematic flight path.</text>'}`;
    renderList();
    drawTelemetry();
  }
  function drawTelemetry() {
    const pts = geometry(waypoints);
    const v = interp(pts, simProgress);
    if (!v) {
      $('simLeg').textContent = '-'; $('simLat').textContent = '-'; $('simLon').textContent = '-'; $('simAlt').textContent = '-'; $('simPct').textContent = '0%';
      return;
    }
    const craft = $('simCraft');
    if (craft) { craft.setAttribute('cx', v.x); craft.setAttribute('cy', v.y); }
    $('simLeg').textContent = v.leg;
    $('simLat').textContent = v.lat.toFixed(6);
    $('simLon').textContent = v.lon.toFixed(6);
    $('simAlt').textContent = `${v.alt.toFixed(1)} m`;
    $('simPct').textContent = `${Math.round(simProgress * 100)}%`;
  }

  let last = 0;
  function tick(now) {
    if (!simRunning) return;
    if (!last) last = now;
    const dt = Math.min(100, now - last);
    last = now;
    simProgress += dt / 1000 * (Number($('simSpeed').value) || .08);
    if (simProgress >= 1) { simProgress = 1; simRunning = false; }
    drawTelemetry();
    if (simRunning) simFrame = requestAnimationFrame(tick); else last = 0;
  }

  $('addWaypoint').addEventListener('click', () => {
    waypoints.push({
      lat: Number($('lat').value),
      lon: Number($('lon').value),
      alt: Number($('alt').value),
      name: $('shotName').value.trim() || `Waypoint ${waypoints.length + 1}`
    });
    saveLocal();
    simProgress = 0;
    render();
  });
  $('clearWaypoints').addEventListener('click', () => {
    cancelSim();
    waypoints = [];
    simProgress = 0;
    saveLocal();
    render();
  });
  $('saveShot').addEventListener('click', () => {
    localStorage.setItem('nougat-studio-aerial-shot', JSON.stringify({ name: $('shotName').value.trim(), waypoints }));
    $('flightStatus').textContent = 'Shot saved locally';
  });
  $('loadShot').addEventListener('click', () => {
    try {
      const shot = JSON.parse(localStorage.getItem('nougat-studio-aerial-shot') || 'null');
      if (shot?.waypoints) {
        waypoints = shot.waypoints;
        $('shotName').value = shot.name || 'Aerial Shot';
        saveLocal();
        simProgress = 0;
        render();
        $('flightStatus').textContent = 'Saved shot loaded';
      }
    } catch (_) {}
  });
  $('simStart').addEventListener('click', () => {
    if (!waypoints.length) return;
    if (simProgress >= 1) simProgress = 0;
    simRunning = true;
    simFrame = requestAnimationFrame(tick);
    $('flightStatus').textContent = 'Simulation running';
  });
  $('simPause').addEventListener('click', () => {
    cancelSim();
    last = 0;
    $('flightStatus').textContent = 'Simulation paused';
  });
  $('simReset').addEventListener('click', () => {
    cancelSim();
    last = 0;
    simProgress = 0;
    drawTelemetry();
    $('flightStatus').textContent = 'Simulation reset';
  });

  loadLocal();
  render();
})();
