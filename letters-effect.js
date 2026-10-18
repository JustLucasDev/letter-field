// Textura de letras da tela inicial do Claude Code, reimplementada em Canvas 2D.
//
// - Uma grade densa de caracteres minúsculos, quase todos invisíveis.
// - Um "vento" de ruído sopra rajadas na diagonal; só as letras por onde a rajada passa acendem.
// - Cada letra percorre uma sequência de caracteres no seu próprio ritmo (quadros de 40 ms).
// - O mouse "aquece" o ar no caminho e acende as letras por ali.
// - O clique dispara uma onda de choque que empurra o ar, embaralha as letras e brilha em azul.
//   A cada 3 cliques a onda sai em forma de coração.
//
// Cores ajustáveis via CSS no <canvas>: --letters-ink e --letters-glow.
(() => {
  'use strict';
  const canvas = document.getElementById('letters-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------- parâmetros
  // Modos (data-mode no canvas): letras (padrão) | "blocks" (blocos cheios) | "hacker" (blocos + caracteres hacker)
  const MODE = canvas.dataset.mode || '';
  const HACKER = MODE === 'hacker';
  const BLOCKS = MODE === 'blocks' || HACKER;
  const CELL_CSS = Number(canvas.dataset.cell) || 6.5; // largura da célula (altura = 2x)
  const GLYPH_CSS = CELL_CSS * 1.38;                  // tamanho da fonte
  const HACKER_CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789010110<>/*+=:$#';
  const FLICK = 1.2;         // trocas de letra por segundo (média)
  const FRAME_MS = 40;       // ritmo normal (25 fps); durante a onda roda a cada quadro
  const OPACITY = 0.78;      // opacidade final da camada
  const HEAD = 3;            // folga de brilho reservada para o azul
  const LULL = 0.5, EDGE = 0.75, CURL = 0.65, WISP = 0.5, TAIL = 0.35, SWEEP = 0.3;
  const MORPH = 3, STREAK = 0.4, DETAIL = 0.6, REVEAL_S = 4;
  // Zona mais calma atrás do conteúdo central (ajustável via data-calm-x / data-calm-y no canvas)
  const CALM_X = Number(canvas.dataset.calmX) || 250;
  const CALM_Y = Number(canvas.dataset.calmY) || 80;
  const CALM_FLOOR = 0.3, CALM_CENTER_Y = 0.45;
  const TAP_LIFE = 3.6, WAKE_LIFE = 2.4;
  const IDLE_S = 180, SETTLE_S = 8, RESUME_S = 3; // para de soprar após 3 min sem interação
  const LOOKS = {
    mixed: 'kb3aQe7rB1nTz0uLw5mHc9sXo2fJd8yVp4gR6iE',
    lettered: 'qwEr4tyUio7pAsdfGh2jkLzx9cVbnM5aeiouS',
    figured: '0x1y2Z3k4m5N6r7s8T9v0b1C2d3e4F5g6h7J8',
  };

  const TAU = Math.PI * 2;
  const LEVEL = 0.02 + (0.82 - 0.02) * LULL;
  const BAND = 0.26 + (0.03 - 0.26) * EDGE;
  const LOW = LEVEL - BAND - 0.55 * TAIL * 0.5;

  // ---------------------------------------------------------------- aleatório e ruído
  let seed = (Math.random() * 4294967296) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) vals[i] = rand() * 2 - 1;
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Ruído de valor (-1..1): manchas suaves
  function vnoise(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    return lerp(
      lerp(lerp(vals[perm[AA]], vals[perm[BA]], u), lerp(vals[perm[AB]], vals[perm[BB]], u), v),
      lerp(lerp(vals[perm[AA + 1]], vals[perm[BA + 1]], u), lerp(vals[perm[AB + 1]], vals[perm[BB + 1]], u), v),
      w);
  }
  // Ruído de gradiente (Perlin): cruza o zero entre pontos, sem bolhas moles
  function grad(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function gnoise(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    return 1.065 * lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }

  // ---------------------------------------------------------------- o vento desta visita
  const pick = (a, b) => a + (b - a) * rand();
  const lookKeys = Object.keys(LOOKS);
  const look = HACKER ? HACKER_CHARS : LOOKS[lookKeys[(rand() * lookKeys.length) | 0]];
  const angle = (() => {
    const lo = Math.PI / 10, hi = Math.PI / 4.3, a = pick(lo, hi);
    return rand() < 0.5 ? a : Math.PI - a; // sempre na diagonal, para um lado ou outro
  })();
  const HX = Math.cos(angle), HY = Math.sin(angle);
  const SPEED = pick(42, 64), GL = pick(380, 560), GW = pick(120, 190);
  const BEND = pick(60, 110), BEND_SCALE = pick(300, 440);

  // Coração: distância até o contorno numa direção (y para baixo), contra 1 de um círculo
  const HEART = new Float32Array(256);
  for (let k = 0; k < 256; k++) {
    const a = (k / 256) * TAU, ux = Math.cos(a), uy = Math.sin(a);
    const c = ux * ux * Math.pow(-uy, 3);
    let lo = 0.05, hi = 2;
    for (let i = 0; i < 24; i++) {
      const r = (lo + hi) / 2, s = r * r - 1;
      if (s * s * s - c * Math.pow(r, 5) < 0) lo = r; else hi = r;
    }
    HEART[k] = (lo + hi) / 2;
  }
  const heartAt = (x, y) => HEART[((Math.atan2(y, x) / TAU) * 256 + 256) & 255];

  // ---------------------------------------------------------------- estado
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dpr, cw, ch, cols, rows, sCols, cssW, cssH, offX, offY, cwCss, chCss;
  let pace, offs, rouse, jitter, start, light, glowX, glowY, roused;
  // Cada letra vira uma lista de pixels (posição + cobertura); o quadro é escrito direto num buffer
  let masks = [], palette = new Uint32Array(17), img = null, buf = null, glyphCount = 1;
  // modo hacker: atlas de caracteres desenhado por cima dos blocos (sem getImageData, que alguns navegadores embaralham)
  let atlas = null, gX, gY, gA, gG, gC;

  const taps = [];
  const wakes = [];
  let tapCount = 0;
  let lastMove = null, lastWake = null, moveSpeed = 0;

  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  let windT = rand() * 64;
  let lastFrame = 0, revealT = 0, lastActive = 0, resumedAt = -RESUME_S;
  let timer = 0, raf = 0, sleeping = false;

  function readColors() {
    const cs = getComputedStyle(canvas);
    return {
      ink: cs.getPropertyValue('--letters-ink').trim() || '#a6a39b',
      glow: cs.getPropertyValue('--letters-glow').trim() || 'rgb(26, 173, 255)',
    };
  }

  // Lê hex/rgb direto do texto: alguns navegadores embaralham getImageData (proteção anti-fingerprint)
  function toRgb(color) {
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const rgb = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    c.fillStyle = color;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  // Tons de tinta -> azul, já no formato do buffer (ABGR little-endian, alfa à parte)
  function buildPalette() {
    const { ink, glow } = readColors();
    const a = toRgb(ink), b = toRgb(glow);
    for (let i = 0; i <= 16; i++) {
      const k = i / 16;
      const r = Math.round(lerp(a[0], b[0], k)), g = Math.round(lerp(a[1], b[1], k)), bl = Math.round(lerp(a[2], b[2], k));
      palette[i] = (bl << 16) | (g << 8) | r;
    }
  }

  function buildAtlas() {
    const cs = getComputedStyle(canvas);
    const glyphColor = cs.getPropertyValue('--letters-glyph').trim() || '#7ff5d2';
    const { glow } = readColors();
    atlas = document.createElement('canvas');
    atlas.width = look.length * cw;
    atlas.height = ch * 2;
    const a = atlas.getContext('2d');
    a.font = `400 ${Math.round(GLYPH_CSS * dpr)}px "MS Gothic", "Osaka-Mono", "Noto Sans Mono CJK JP", ui-monospace, monospace`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    [glyphColor, glow].forEach((color, row) => {
      a.fillStyle = color;
      for (let i = 0; i < look.length; i++) a.fillText(look[i], i * cw + cw / 2, row * ch + ch / 2);
    });
    const n = cols * rows;
    gX = new Int32Array(n); gY = new Int32Array(n); gA = new Float32Array(n); gG = new Uint16Array(n); gC = new Uint8Array(n);
  }

  function buildGlyphs() {
    // Modos "blocks"/"hacker": cada célula vira um bloco cheio (no hacker, mais fraco, com o caractere por cima)
    if (BLOCKS) {
      const W = canvas.width, off = [], cov = [];
      const fill = HACKER ? 0.4 : 1;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { off.push(y * W + x); cov.push(fill); }
      masks = [{ off: Int32Array.from(off), cov: Float32Array.from(cov) }];
      glyphCount = HACKER ? look.length : 1;
      buildPalette();
      if (HACKER) buildAtlas();
      return;
    }
    const family = getComputedStyle(canvas).fontFamily || 'monospace';
    const weight = dpr >= 1.5 ? 300 : 400;
    const m = document.createElement('canvas').getContext('2d');
    m.font = `${weight} 100px ${family}`;
    const ratio = m.measureText('0').width / 100 || 0.6;
    const px = Math.min(Math.round(GLYPH_CSS * dpr), Math.floor((cw - 2) / ratio));

    const sheet = document.createElement('canvas');
    sheet.width = look.length * cw;
    sheet.height = ch;
    const a = sheet.getContext('2d', { willReadFrequently: true });
    a.font = `${weight} ${px}px ${family}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.fillStyle = '#fff';
    for (let i = 0; i < look.length; i++) a.fillText(look[i], i * cw + cw / 2, ch / 2);
    const data = a.getImageData(0, 0, sheet.width, ch).data;

    const W = canvas.width;
    masks = [];
    for (let i = 0; i < look.length; i++) {
      const off = [], cov = [];
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const alpha = data[(y * sheet.width + i * cw + x) * 4 + 3];
          if (alpha > 0) { off.push(y * W + x); cov.push(alpha / 255); }
        }
      }
      masks.push({ off: Int32Array.from(off), cov: Float32Array.from(cov) });
    }
    glyphCount = look.length;
    buildPalette();
  }

  function layout() {
    dpr = window.devicePixelRatio || 1;
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    cw = Math.max(5, Math.round(CELL_CSS * dpr));
    ch = cw * 2;
    const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    cols = Math.ceil(devW / cw);
    rows = Math.ceil(devH / ch);
    canvas.width = cols * cw;
    canvas.height = rows * ch;
    offX = Math.round((devW - cols * cw) / 2) / dpr;
    offY = Math.round((devH - rows * ch) / 2) / dpr;
    cwCss = cw / dpr;
    chCss = ch / dpr;
    Object.assign(canvas.style, {
      left: offX + 'px', top: offY + 'px',
      width: (cols * cw) / dpr + 'px', height: (rows * ch) / dpr + 'px',
    });

    const n = cols * rows;
    pace = new Float32Array(n); offs = new Float32Array(n); rouse = new Float32Array(n);
    jitter = new Float32Array(n); start = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      pace[i] = FLICK * (0.6 + 0.8 * rand());
      offs[i] = rand();
      rouse[i] = rand();
      jitter[i] = 0.65 + 0.35 * rand();
      start[i] = (rand() * 4096) | 0;
    }
    // O vento é calculado a cada 2 colunas (amostras de ~13x13 px)
    sCols = Math.ceil(cols / 2);
    const s = sCols * rows;
    light = new Float32Array(s); glowX = new Float32Array(s); glowY = new Float32Array(s); roused = new Float32Array(s);
    img = ctx.createImageData(canvas.width, canvas.height);
    buf = new Uint32Array(img.data.buffer);
    buildGlyphs();
  }

  // ---------------------------------------------------------------- rajadas
  const GAIN = 0.38 + (0.62 - 0.38) * DETAIL;
  let span = 1000;
  function gusts(ax, ay, carried, t) {
    let g = 0, w = 1, pw = 0, sx = 0.85 * GL, sy = 0.75 * GW;
    for (let k = 0; k < 3; k++) {
      g += w * gnoise((ax - carried * (1 + 0.1 * k)) / sx, ay / sy, MORPH * t * (0.03 + 0.018 * k) + 11 * k);
      pw += w * w; w *= GAIN; sx *= 0.5; sy *= 0.58;
    }
    const strand = 1 - Math.abs(gnoise((ax - 1.15 * carried) / (0.7 * GL), ay / (0.95 * GW), MORPH * t * 0.05 + 52));
    const swell = Math.cos((ax - carried + 0.5 * span * vnoise(t * 0.045, ay / (2.5 * GW), 7)) * (TAU / span));
    return g / Math.sqrt(pw) + WISP * 0.5 * (strand * strand * strand - 0.35) + SWEEP * swell;
  }

  // ---------------------------------------------------------------- quadro
  function frame() {
    raf = 0;
    // a grade ainda não foi montada (ex.: logo após recarregar): tenta no próximo quadro
    if (!buf) { schedule(); return; }
    const now = clock();
    const dt = Math.min(Math.max(now - lastFrame, 0), 0.25);
    lastFrame = now;

    // Energia: para devagar depois de muito tempo parado, volta ao interagir
    const idle = now - lastActive;
    const energy = (reduced ? 0 : 1)
      * (1 - smooth(0, 1, (idle - IDLE_S) / SETTLE_S))
      * smooth(0, 1, (now - resumedAt) / RESUME_S);
    windT += dt * energy;
    revealT += dt;
    const reveal = reduced ? 1 : smooth(0, 1, revealT / REVEAL_S);
    const t = windT;

    // Cliques e rastros do mouse ainda vivos
    while (taps.length && now - taps[0].at >= TAP_LIFE) taps.shift();
    while (wakes.length && now - wakes[0].at >= WAKE_LIFE) wakes.shift();
    const tp = taps.map((tap) => {
      const age = now - tap.at;
      return {
        x: tap.x, y: tap.y, heart: tap.force < 0, f: Math.abs(tap.force),
        radius: 620 * (1 - Math.exp(-age / 1.3)), width: 85 + 60 * age,
        e15: Math.exp(-age / 1.5), e1: Math.exp(-age), e13: Math.exp(-age / 1.3),
        gy: (1 - Math.exp(-age / 0.2)) * Math.exp(-age / 1.2),
      };
    });
    const wk = [];
    const spare = 48 - wakes.length;
    wakes.forEach((wake, i) => {
      const a = Math.max(0, now - wake.at);
      const s = wake.force * Math.min(1, (i + 1 + spare) / 8) * (1 - Math.exp(-a / 0.05)) * Math.exp(-a / 0.65);
      if (s < 0.002) return;
      const r = 50 + 40 * a;
      wk.push({ x: wake.x, y: wake.y, s, inv: 1 / (r * r), dx: wake.dx, dy: wake.dy, half: wake.half });
    });
    const hand = tp.length + wk.length > 0;

    const carried = SPEED * (t + vnoise(t * 0.09, 3.7, 0));
    span = 0.58 * (Math.abs(HX) * cssW + Math.abs(HY) * cssH);
    const eddyS = 1.15 * GW, fineS = 0.38 * GW;
    const mt = MORPH * t;
    const cx0 = cssW / 2, cy0 = CALM_CENTER_Y * cssH;

    // ---- campo do vento por amostra
    for (let j = 0; j < rows; j++) {
      const py = offY + (j + 0.5) * chCss;
      for (let si = 0; si < sCols; si++) {
        const px = offX + (si * 2 + 1) * cwCss;
        const s = j * sCols + si;

        let hx = 0, hy = 0, hz = 0, hw = 0, gx = 0, gy = 0, warm = 0;
        if (hand) {
          // lido um pouco fora do lugar, para a onda nunca ser um círculo perfeito
          const nx = px + 24 * vnoise(px / 95, py / 95, now * 0.12);
          const ny = py + 24 * vnoise(px / 95 + 9.1, py / 95 + 9.1, now * 0.12 + 4);
          for (let k = 0; k < tp.length; k++) {
            const q = tp[k];
            const ax = nx - q.x, ay = ny - q.y;
            const d = Math.sqrt(ax * ax + ay * ay);
            const reach = q.heart ? d / heartAt(ax, ay) : d;
            const behind = q.radius - reach;
            if (behind < -16) continue;
            const front = smooth(-16, 10, behind) * Math.exp(-(behind * behind) / (q.width * q.width));
            const swell = q.f * q.e15 * front;
            const inv = 1 / Math.max(d, 1);
            hx += ax * inv * 44 * swell;
            hy += ay * inv * 44 * swell;
            hz += 1.9 * swell * (0.25 + 0.75 * Math.cos(behind * (TAU / 130)));
            hw += swell;
            const trail = smooth(0, 70, behind) * Math.exp(-Math.max(behind, 0) / 260);
            gx += q.f * (q.e1 * front + 0.7 * q.e13 * trail);
            gy += q.f * q.gy * trail;
          }
          let heat = 0;
          for (let k = 0; k < wk.length; k++) {
            const w = wk[k];
            let ax = nx - w.x, ay = ny - w.y;
            const along = Math.min(w.half, Math.max(-w.half, ax * w.dx + ay * w.dy));
            ax -= w.dx * along; ay -= w.dy * along;
            heat += w.s * Math.exp(-(ax * ax + ay * ay) * w.inv);
          }
          warm = 1 - Math.exp(-1.5 * heat);
          hz += 0.25 * warm;
          hw += 0.05 * warm;
        }

        // O ar empurrado mostra aqui o que estava ali
        const fx = px - hx, fy = py - hy;
        const tx = vnoise(fx / BEND_SCALE, fy / BEND_SCALE, t * 0.04);
        const ty = vnoise(fx / BEND_SCALE + 17.3, fy / BEND_SCALE + 17.3, t * 0.04 + 5);
        const bx = fx + BEND * tx, by = fy + BEND * ty;
        const qx = bx * HX + by * HY, qy = -bx * HY + by * HX;
        const rx = qx - 0.85 * carried;
        const ex = gnoise(rx / eddyS, qy / eddyS, mt * 0.04);
        const ey = gnoise(rx / eddyS + 31.7, qy / eddyS + 31.7, mt * 0.04 + 3);
        const fox = rx + CURL * 0.9 * GW * ex, foy = qy + CURL * 0.9 * GW * ey;
        const fnx = gnoise(fox / fineS, foy / fineS, mt * 0.06);
        const fny = gnoise(fox / fineS + 13.1, foy / fineS + 13.1, mt * 0.06 + 7);
        const k = CURL * (1 + 0.9 * Math.min(hw, 1.5)) * GW;
        const ccx = qx + k * (0.9 * ex + 0.3 * fnx), ccy = qy + k * (0.9 * ey + 0.3 * fny);
        const field = gusts(ccx, ccy, carried, t) + hz;

        let strength = 0, streaks = 0;
        const blowing = field > LOW;
        if (blowing || warm > 0) {
          const thread = vnoise((ccx - carried * 1.6) / 140, ccy / 30, t * 0.16);
          streaks = 1 - smooth(0, 0.5, Math.abs(thread));
        }
        if (blowing) {
          const lit = smooth(LOW, LEVEL + BAND, field);
          const broad = lit * lit * lerp(0.45, 1, Math.min(1, Math.max(0, (field - LEVEL) / 0.45))) * (0.82 + 0.18 * fny);
          strength = broad * lerp(1, 0.25 + 0.95 * streaks, STREAK);
        }
        if (warm > 0) {
          const grain = 0.55 * fny + 0.45 * fnx + 0.3 * (streaks - 0.4);
          strength = 1 - (1 - strength) * (1 - 0.85 * warm * smooth(-0.5, 0.25, grain));
        }

        // Mais fraco atrás do conteúdo central
        const ux = (px - cx0) / CALM_X, uy = (py - cy0) / CALM_Y;
        const calm = 1 - (1 - CALM_FLOOR) * Math.exp(-0.9 * (ux * ux + uy * uy));
        const shown = Math.max(reveal, Math.min(1, 2 * hw + warm));
        light[s] = strength * calm * shown;
        glowX[s] = gx;
        glowY[s] = gy * calm * shown;
        roused[s] = hw;
      }
    }

    // ---- letras
    buf.fill(0);
    const n = glyphCount, W = canvas.width;
    let gn = 0;
    for (let j = 0; j < rows; j++) {
      const rowBase = j * ch * W;
      for (let i = 0; i < cols; i++) {
        const s = j * sCols + (i >> 1);
        const L = light[s];
        let GY = glowY[s];
        if (L < 0.01 && GY < 0.01) continue;
        const c = j * cols + i;
        let GX = glowX[s];
        if (GX > 0 || GY > 0) { GX *= jitter[c]; GY *= jitter[c]; }
        const tint = smooth(0.04, 0.3, GX);
        const bright = Math.min(1, L) * lerp(1, HEAD, tint);
        const left = 0.3 * GY;
        const a = Math.min(1, (bright + left) / HEAD);
        if (a < 0.012) continue;

        // Cada letra anda pela sequência no seu ritmo; agitada, anda mais
        const steps = Math.floor(t * pace[c] + offs[c]) + Math.floor(6 * roused[s] + rouse[c]);
        const g = (((start[c] + steps) % n) + n) % n;
        const blue = (tint * bright + left) / (bright + left + 1e-4);
        const color = palette[(blue * 16 + 0.5) | 0];
        const A = a * 255;
        const base = rowBase + i * cw;
        const { off, cov } = masks[BLOCKS ? 0 : g];
        for (let p = 0; p < off.length; p++) {
          buf[base + off[p]] = color | (((A * cov[p]) | 0) << 24);
        }
        if (HACKER && a > 0.1) {
          gX[gn] = i * cw; gY[gn] = j * ch; gA[gn] = Math.min(1, a * 1.9); gG[gn] = g; gC[gn] = blue > 0.5 ? 1 : 0;
          gn++;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // caracteres hacker por cima dos blocos
    for (let k = 0; k < gn; k++) {
      ctx.globalAlpha = gA[k];
      ctx.drawImage(atlas, gG[k] * cw, gC[k] * ch, cw, ch, gX[k], gY[k], cw, ch);
    }
    ctx.globalAlpha = 1;

    schedule(energy === 0 && !reduced && taps.length === 0 && wakes.length === 0 && revealT > REVEAL_S);
  }

  function schedule(stop) {
    clearTimeout(timer);
    if (raf) return;
    // pausado (ex.: cena 3D ocupando a tela): só continua enquanto houver onda de clique animando
    if (stop || (paused && !taps.length)) { sleeping = true; return; }
    sleeping = false;
    // onda: ~60 fps (sem acompanhar monitores de 120/144 Hz); normal: quadros de 40 ms
    timer = setTimeout(() => { raf = requestAnimationFrame(frame); }, taps.length ? 12 : FRAME_MS);
  }

  // Pausa o fundo enquanto um elemento com [data-pause-bg] ocupa boa parte da tela
  let paused = false;
  const pausers = document.querySelectorAll('[data-pause-bg]');
  if (pausers.length && 'IntersectionObserver' in window) {
    const seen = new Map();
    new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.intersectionRatio >= 0.5));
      const p = [...seen.values()].some(Boolean);
      if (p !== paused) { paused = p; if (!paused) wake(); }
    }, { threshold: [0, 0.5] }).observe(pausers[0]);
  }

  function wake() {
    const now = clock();
    if (now - lastActive > IDLE_S) resumedAt = now;
    lastActive = now;
    if (sleeping && !raf) { sleeping = false; raf = requestAnimationFrame(frame); }
  }

  // ---------------------------------------------------------------- interação
  const INTERACTIVE = 'a,button,input,textarea,select,label,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"]';

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const now = clock(), x = e.clientX, y = e.clientY;
    wake();
    if (!lastMove || now - lastMove.at > 0.25) {
      lastMove = lastWake = { x, y, at: now };
      moveSpeed = 0;
      return;
    }
    const dt = Math.max(now - lastMove.at, 1 / 240);
    const v = Math.hypot(x - lastMove.x, y - lastMove.y) / dt;
    moveSpeed += (v - moveSpeed) * Math.min(1, dt / 0.08);
    lastMove = { x, y, at: now };
    const len = Math.hypot(x - lastWake.x, y - lastWake.y);
    if (len < 18 || now - lastWake.at < 0.035) return;
    const stir = smooth(0, 1, (moveSpeed - 60) / (800 - 60));
    const prev = lastWake;
    lastWake = lastMove;
    if (stir < 0.04) return;
    const half = len / 2;
    wakes.push({
      x: (x + prev.x) / 2, y: (y + prev.y) / 2, at: now,
      force: (stir * len) / (len + 90),
      dx: (x - prev.x) / len, dy: (y - prev.y) / len, half,
    });
    if (wakes.length > 48) wakes.shift();
  }, { passive: true });

  window.addEventListener('pointerleave', () => { lastMove = null; });

  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    tapCount += 1;
    const force = tapCount % 3 === 0 ? -1.15 : 1; // a cada 3 cliques: coração
    taps.push({ x: e.clientX, y: e.clientY, at: clock(), force });
    if (taps.length > 6) taps.shift();
    wake();
    clearTimeout(timer);
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });

  window.addEventListener('keydown', wake, { passive: true });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); wake(); }, 150);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => buildPalette());

  layout();
  canvas.style.opacity = '0';
  requestAnimationFrame(() => {
    canvas.style.transition = 'opacity 600ms ease-out';
    canvas.style.opacity = String(OPACITY);
  });
  lastActive = clock();
  raf = requestAnimationFrame(frame);
})();
