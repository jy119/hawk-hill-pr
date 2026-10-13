(() => {
  'use strict';

  // Strava segment 229781, "Hawk Hill". Public example in Strava's API docs.
  const SEGMENT = {
    distanceM: 2684.82,
    gainM: 155.733,
    averageGrade: 0.057,
    center: { lat: 37.8306, lon: -122.4908 },
    polyline: '}g|eFnpqjVl@En@Md@HbAd@d@^h@Xx@VbARjBDh@OPQf@w@d@k@XKXDFPH\\EbGT`AV`@v@|@NTNb@?XOb@cAxAWLuE@eAFMBoAv@eBt@q@b@}@tAeAt@i@dAC`AFZj@dB?~@[h@MbAVn@b@b@\\d@Eh@Qb@_@d@eB|@c@h@WfBK|AMpA?VF\\\\t@f@t@h@j@|@b@hCb@b@XTd@Bl@GtA?jAL`ALp@Tr@RXd@Rx@Pn@^Zh@Tx@Zf@`@FTCzDy@f@Yx@m@n@Op@VJr@',
  };

  const DEFAULTS = {
    powerW: 400,
    riderLb: 182,
    bikeLb: 17,
    cda: 0.32,
    crr: 0.004,
    drivetrain: 0.975,
  };

  const els = {
    status: document.querySelector('#status'),
    hero: document.querySelector('#hero'),
    bestTime: document.querySelector('#bestTime'),
    bestDate: document.querySelector('#bestDate'),
    bestSummary: document.querySelector('#bestSummary'),
    bestChips: document.querySelector('#bestChips'),
    bestPredicted: document.querySelector('#bestPredicted'),
    bestDelta: document.querySelector('#bestDelta'),
    confidence: document.querySelector('#confidence'),
    topWindows: document.querySelector('#topWindows'),
    heatmap: document.querySelector('#heatmap'),
    routeSvg: document.querySelector('#routeSvg'),
    calmTime: document.querySelector('#calmTime'),
    updatedAt: document.querySelector('#updatedAt'),
    refreshBtn: document.querySelector('#refreshBtn'),
    resetBtn: document.querySelector('#resetBtn'),
    powerInput: document.querySelector('#powerInput'),
    riderInput: document.querySelector('#riderInput'),
    bikeInput: document.querySelector('#bikeInput'),
    cdaInput: document.querySelector('#cdaInput'),
  };

  const routePoints = decodePolyline(SEGMENT.polyline);
  const routeLegs = buildRouteLegs(routePoints);
  let rawForecast = [];
  let settings = loadSettings();

  initialize();

  function initialize() {
    renderRoute();
    syncInputs();
    bindEvents();
    fetchForecast();
  }

  function bindEvents() {
    els.refreshBtn.addEventListener('click', fetchForecast);
    els.resetBtn.addEventListener('click', () => {
      settings = { ...DEFAULTS };
      saveSettings();
      syncInputs();
      rerank();
    });

    const listeners = [
      [els.powerInput, 'powerW'],
      [els.riderInput, 'riderLb'],
      [els.bikeInput, 'bikeLb'],
      [els.cdaInput, 'cda'],
    ];

    for (const [input, key] of listeners) {
      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (Number.isFinite(n) && n > 0) {
          settings[key] = n;
          saveSettings();
          rerank();
        }
      });
    }
  }

  function syncInputs() {
    els.powerInput.value = settings.powerW;
    els.riderInput.value = settings.riderLb;
    els.bikeInput.value = settings.bikeLb;
    els.cdaInput.value = settings.cda;
  }

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem('hawkHillPrSettings') || '{}');
      return { ...DEFAULTS, ...stored };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    localStorage.setItem('hawkHillPrSettings', JSON.stringify(settings));
  }

  async function fetchForecast() {
    showStatus('Loading the latest 15-minute forecast…', 'loading');
    els.refreshBtn.disabled = true;

    const p = new URLSearchParams({
      latitude: String(SEGMENT.center.lat),
      longitude: String(SEGMENT.center.lon),
      minutely_15: [
        'temperature_2m',
        'precipitation',
        'weather_code',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
        'is_day',
      ].join(','),
      hourly: 'precipitation_probability',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'America/Los_Angeles',
      forecast_days: '7',
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p.toString()}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Weather API returned ${res.status}`);
      const data = await res.json();
      rawForecast = normalizeForecast(data);
      if (!rawForecast.length) throw new Error('No forecast points returned');
      els.updatedAt.textContent = `Updated ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
      rerank();
      hideStatus();
    } catch (err) {
      console.error(err);
      showStatus('Could not load Open-Meteo. Check your connection and tap Refresh.', 'error');
      els.hero.classList.add('hidden');
    } finally {
      els.refreshBtn.disabled = false;
    }
  }

  function normalizeForecast(data) {
    const m = data.minutely_15;
    if (!m?.time) return [];

    const hourlyProb = new Map();
    if (data.hourly?.time) {
      data.hourly.time.forEach((t, i) => hourlyProb.set(t.slice(0, 13), data.hourly.precipitation_probability?.[i] ?? 0));
    }

    return m.time.map((time, i) => ({
      time,
      date: new Date(time),
      tempF: m.temperature_2m?.[i] ?? 55,
      precipIn: m.precipitation?.[i] ?? 0,
      precipProb: hourlyProb.get(time.slice(0, 13)) ?? 0,
      weatherCode: m.weather_code?.[i] ?? 0,
      windMph: m.wind_speed_10m?.[i] ?? 0,
      windFromDeg: m.wind_direction_10m?.[i] ?? 0,
      gustMph: m.wind_gusts_10m?.[i] ?? 0,
      isDay: (m.is_day?.[i] ?? 1) === 1,
    }));
  }

  function rerank() {
    const calm = predictRouteTime({ windMph: 0, windFromDeg: 0, tempF: 55 }, settings);
    els.calmTime.textContent = formatDuration(calm);
    if (!rawForecast.length) return;

    const now = Date.now();
    const predictions = rawForecast
      .filter(p => p.date.getTime() >= now - 15 * 60 * 1000)
      .map(p => {
        const routeWind = routeWindSummary(p.windMph, p.windFromDeg);
        const predictedSec = predictRouteTime(p, settings);
        const savingsSec = calm - predictedSec;
        const gustSpread = Math.max(0, p.gustMph - p.windMph);
        const safe = p.isDay && p.precipIn < 0.01 && p.gustMph <= 35;
        const wetPenalty = p.precipIn >= 0.01 ? 120 : p.precipProb > 45 ? 8 : 0;
        const gustPenalty = Math.max(0, gustSpread - 8) * 0.15;
        const rankingSec = predictedSec + wetPenalty + gustPenalty;
        return { ...p, ...routeWind, predictedSec, savingsSec, safe, rankingSec };
      });

    const candidates = predictions.filter(p => p.safe);
    const ranked = (candidates.length ? candidates : predictions.filter(p => p.isDay))
      .sort((a, b) => a.rankingSec - b.rankingSec);

    if (!ranked.length) {
      showStatus('No daylight forecast windows are available yet.', 'error');
      return;
    }

    const best = ranked[0];
    renderHero(best, calm);
    renderTopWindows(pickSeparated(ranked, 5, 60));
    renderHeatmap(predictions, calm);
    els.hero.classList.remove('hidden');
    els.topWindows.classList.remove('skeleton-block');
    els.heatmap.classList.remove('skeleton-block');
  }

  function renderHero(best, calm) {
    const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    const horizonH = Math.max(0, (best.date.getTime() - Date.now()) / 36e5);
    const confidence = horizonH <= 48 ? 'High' : horizonH <= 96 ? 'Medium' : 'Lower';

    els.bestTime.textContent = timeFmt.format(best.date);
    els.bestDate.textContent = dayFmt.format(best.date);
    els.bestPredicted.textContent = formatDuration(best.predictedSec);

    if (best.savingsSec >= 0) {
      els.bestDelta.textContent = `${Math.round(best.savingsSec)} sec faster than calm-air model`;
      els.bestDelta.style.color = 'var(--accent)';
    } else {
      els.bestDelta.textContent = `${Math.round(Math.abs(best.savingsSec))} sec slower than calm-air model`;
      els.bestDelta.style.color = 'var(--bad)';
    }

    const windWord = best.effectiveTailwindMph >= 1
      ? `${best.effectiveTailwindMph.toFixed(1)} mph route-effective tailwind`
      : best.effectiveTailwindMph <= -1
        ? `${Math.abs(best.effectiveTailwindMph).toFixed(1)} mph route-effective headwind`
        : 'mostly cross/calm effective wind';

    els.bestSummary.textContent = `${windWord}. Forecast wind ${Math.round(best.windMph)} mph from ${cardinal(best.windFromDeg)}, gusting ${Math.round(best.gustMph)} mph.`;
    els.bestChips.innerHTML = [
      `${Math.round(best.tempF)}°F`,
      `${best.precipProb}% rain chance`,
      `${Math.round(best.windMph)} mph ${cardinal(best.windFromDeg)}`,
      `${Math.round(best.gustMph)} mph gusts`,
    ].map(x => `<span class="chip">${escapeHtml(x)}</span>`).join('');
    els.confidence.textContent = `${confidence} forecast confidence • ${formatHorizon(horizonH)}`;
  }

  function renderTopWindows(windows) {
    const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

    els.topWindows.innerHTML = windows.map((p, i) => {
      const saveClass = p.savingsSec >= 0 ? 'save' : 'save loss';
      const saveText = p.savingsSec >= 0 ? `−${Math.round(p.savingsSec)}s vs calm` : `+${Math.round(Math.abs(p.savingsSec))}s vs calm`;
      return `<div class="window">
        <div class="rank"><strong>#${i + 1}</strong>${confidenceShort(p.date)}</div>
        <div class="window-main">
          <div class="window-time">${escapeHtml(dayFmt.format(p.date))} · ${escapeHtml(timeFmt.format(p.date))}</div>
          <div class="window-meta">${Math.round(p.windMph)} mph ${cardinal(p.windFromDeg)} · eff. ${signed(p.effectiveTailwindMph)} mph · gust ${Math.round(p.gustMph)} · ${Math.round(p.tempF)}°</div>
        </div>
        <div class="window-result"><strong>${formatDuration(p.predictedSec)}</strong><div class="${saveClass}">${saveText}</div></div>
      </div>`;
    }).join('');
  }

  function renderHeatmap(predictions, calm) {
    const startHour = 6;
    const endHour = 19;
    const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
    const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' });

    const groups = new Map();
    for (const p of predictions) {
      const d = p.time.slice(0, 10);
      const hour = Number(p.time.slice(11, 13));
      if (hour < startHour || hour > endHour) continue;
      const key = `${d}|${hour}`;
      const prev = groups.get(key);
      if (p.isDay && p.precipIn < 0.01 && (!prev || p.rankingSec < prev.rankingSec)) groups.set(key, p);
    }

    const days = [...new Set(predictions.map(p => p.time.slice(0, 10)))].slice(0, 7);
    const allSavings = [...groups.values()].map(p => p.savingsSec);
    const minSave = Math.min(-20, ...allSavings);
    const maxSave = Math.max(20, ...allSavings);

    const labels = `<div class="heat-row"><div></div>${range(startHour, endHour).map(h => `<div class="heat-label">${formatHour(h)}</div>`).join('')}</div>`;
    const rows = days.map(d => {
      const dateObj = new Date(`${d}T12:00:00`);
      const cells = range(startHour, endHour).map(h => {
        const p = groups.get(`${d}|${h}`);
        if (!p) return `<div class="heat-cell empty">—</div>`;
        const t = clamp((p.savingsSec - minSave) / (maxSave - minSave), 0, 1);
        const bg = heatColor(t);
        const tip = `${formatClock(p.date)} · ${formatDuration(p.predictedSec)} · ${signed(p.effectiveTailwindMph)} mph effective wind`;
        return `<div class="heat-cell" style="background:${bg}" title="${escapeHtml(tip)}"><b>${formatDuration(p.predictedSec)}</b><span>${p.savingsSec >= 0 ? '−' : '+'}${Math.abs(Math.round(p.savingsSec))}s</span></div>`;
      }).join('');
      return `<div class="heat-row"><div class="heat-day"><strong>${dayFmt.format(dateObj)}</strong>${dateFmt.format(dateObj)}</div>${cells}</div>`;
    }).join('');

    els.heatmap.innerHTML = `<div class="heat-table">${labels}${rows}</div>`;
  }

  function renderRoute() {
    const xs = routePoints.map(p => p.lon);
    const ys = routePoints.map(p => p.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 28, w = 640, h = 260;
    const pts = routePoints.map(p => {
      const x = pad + (p.lon - minX) / (maxX - minX) * (w - pad * 2);
      const y = h - pad - (p.lat - minY) / (maxY - minY) * (h - pad * 2);
      return [x, y];
    });
    const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const s = pts[0], e = pts[pts.length - 1];
    els.routeSvg.innerHTML = `<path class="route-shadow" d="${d}"/><path class="route-path" d="${d}"/><circle class="route-dot" cx="${s[0]}" cy="${s[1]}" r="6"/><circle class="route-end" cx="${e[0]}" cy="${e[1]}" r="7"/>`;
  }

  function predictRouteTime(weather, s) {
    const massKg = (s.riderLb + s.bikeLb) * 0.45359237;
    const wheelPower = s.powerW * s.drivetrain;
    const theta = Math.atan(SEGMENT.gainM / SEGMENT.distanceM);
    const gravityForce = massKg * 9.80665 * Math.sin(theta);
    const rollingForce = massKg * 9.80665 * Math.cos(theta) * s.crr;
    const tempK = ((weather.tempF ?? 55) - 32) * 5 / 9 + 273.15;
    const meanElevationM = 169;
    const pressurePa = 101325 * Math.pow(1 - 2.25577e-5 * meanElevationM, 5.25588);
    const rho = pressurePa / (287.05 * tempK);
    const windMs = (weather.windMph ?? 0) * 0.44704;
    const windTo = normalizeDeg((weather.windFromDeg ?? 0) + 180);

    let totalSec = 0;
    const scale = SEGMENT.distanceM / routeLegs.reduce((a, b) => a + b.distanceM, 0);

    for (const leg of routeLegs) {
      const delta = degToRad(shortAngle(windTo - leg.bearingDeg));
      const tail = windMs * Math.cos(delta);
      const cross = windMs * Math.sin(delta);
      const speed = solveSpeed(wheelPower, gravityForce, rollingForce, rho, s.cda, tail, cross);
      totalSec += (leg.distanceM * scale) / speed;
    }
    return totalSec;
  }

  function solveSpeed(power, gravityForce, rollingForce, rho, cda, tailwindMs, crosswindMs) {
    let lo = 0.5, hi = 25;
    for (let i = 0; i < 48; i++) {
      const v = (lo + hi) / 2;
      const relAlong = v - tailwindMs;
      const relMag = Math.hypot(relAlong, crosswindMs);
      const aeroForward = 0.5 * rho * cda * relMag * relAlong;
      const required = (gravityForce + rollingForce + aeroForward) * v;
      if (required < power) lo = v; else hi = v;
    }
    return (lo + hi) / 2;
  }

  function routeWindSummary(windMph, windFromDeg) {
    const windTo = normalizeDeg(windFromDeg + 180);
    let along = 0, cross = 0, total = 0;
    for (const leg of routeLegs) {
      const delta = degToRad(shortAngle(windTo - leg.bearingDeg));
      along += windMph * Math.cos(delta) * leg.distanceM;
      cross += Math.abs(windMph * Math.sin(delta)) * leg.distanceM;
      total += leg.distanceM;
    }
    return {
      effectiveTailwindMph: along / total,
      effectiveCrosswindMph: cross / total,
    };
  }

  function buildRouteLegs(points) {
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      legs.push({
        distanceM: haversine(points[i - 1], points[i]),
        bearingDeg: bearing(points[i - 1], points[i]),
      });
    }
    return legs.filter(l => l.distanceM > 1);
  }

  function decodePolyline(str) {
    let index = 0, lat = 0, lon = 0;
    const points = [];
    while (index < str.length) {
      let result = 0, shift = 0, b;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      result = 0; shift = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);
      points.push({ lat: lat / 1e5, lon: lon / 1e5 });
    }
    return points;
  }

  function haversine(a, b) {
    const R = 6371000;
    const p1 = degToRad(a.lat), p2 = degToRad(b.lat);
    const dp = degToRad(b.lat - a.lat), dl = degToRad(b.lon - a.lon);
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function bearing(a, b) {
    const p1 = degToRad(a.lat), p2 = degToRad(b.lat), dl = degToRad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return normalizeDeg(radToDeg(Math.atan2(y, x)));
  }

  function pickSeparated(items, count, minutes) {
    const out = [];
    const minMs = minutes * 60 * 1000;
    for (const item of items) {
      if (out.every(x => Math.abs(x.date - item.date) >= minMs)) out.push(item);
      if (out.length >= count) break;
    }
    return out;
  }

  function confidenceShort(date) {
    const h = (date.getTime() - Date.now()) / 36e5;
    return h <= 48 ? 'HIGH' : h <= 96 ? 'MED' : 'LOW';
  }

  function cardinal(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(normalizeDeg(deg) / 22.5) % 16];
  }

  function formatDuration(sec) {
    if (!Number.isFinite(sec)) return '—';
    const total = Math.max(0, Math.round(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function formatHour(h) {
    if (h === 12) return '12p';
    return h < 12 ? `${h}a` : `${h - 12}p`;
  }

  function formatHorizon(h) {
    if (h < 24) return `${Math.max(1, Math.round(h))}h away`;
    return `${(h / 24).toFixed(1)} days away`;
  }

  function signed(n) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
  }

  function heatColor(t) {
    // Neutral blue-gray -> bright green. Keep luminance restrained for white text.
    const a = [44, 57, 80], b = [45, 138, 79];
    const x = Math.pow(t, 1.15);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * x));
    return `rgb(${c.join(',')})`;
  }

  function showStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = `status ${kind}`.trim();
    els.status.classList.remove('hidden');
  }

  function hideStatus() { els.status.classList.add('hidden'); }
  function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function normalizeDeg(d) { return ((d % 360) + 360) % 360; }
  function shortAngle(d) { return ((d + 540) % 360) - 180; }
  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }
  function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
