(() => {
  const VERSION = '3.0.2';
  console.log(
    `%c Monitor A/V %c v${VERSION} `,
    'background:#49b6c1;color:#101214;font-weight:900;padding:2px 0;border-radius:3px 0 0 3px',
    'background:#1a3438;color:#49b6c1;font-weight:700;padding:2px 4px;border-radius:0 3px 3px 0'
  );

  const Q_DIV  = [8, 4, 2, 1.5, 1];
  const D_STEP = [8, 4, 2, 1, 1];
  const HIST_LEGAL = { lo: 16, hi: 235 };

  // Primárias CIE xy para triângulo de gamut
  const CIE_GAMUT = {
    bt709:  { r:[.640,.330], g:[.300,.600], b:[.150,.060], w:[.3127,.3290] },
    bt2020: { r:[.708,.292], g:[.170,.797], b:[.131,.046], w:[.3127,.3290] },
  };

  const state = {
    hls: null, audioContext: null, analyserL: null, analyserR: null,
    splitter: null, sourceNode: null, rafId: null,
    lastFrameAt: 0, frameCount: 0, activeSource: null,
    loudnessHistory: [], lufsShortBuf: [],
    worker: null, workerBusy: false,
    quality: 3, density: 3,
    vsStd: 'bt709', wfMode: 'luma', histRange: 'legal', cieStd: 'bt709',
    modules: { waveform:true, vector:true, histogram:true, cie:true, diamond:true, spectrum:true, phase:true, loudness:true },
    wfPoints: null, wfModeResult: 'luma',
    vsPoints: null,
    histR: null, histG: null, histB: null,
    ciePoints: null, diamondPoints: null,
  };

  const $ = id => document.getElementById(id);
  const el = {
    video: $('video'), streamUrl: $('streamUrl'),
    fileInput: $('fileInput'), loadUrlBtn: $('loadUrlBtn'),
    playerState: $('playerState'), videoState: $('videoState'),
    audioState: $('audioState'), corsState: $('corsState'),
    videoDot: $('videoDot'), audioDot: $('audioDot'), corsDot: $('corsDot'),
    sourceBadge: $('sourceBadge'),
    metaRes: $('metaRes'), metaResMax: $('metaResMax'), metaFps: $('metaFps'),
    metaFpsStream: $('metaFpsStream'), metaVcodec: $('metaVcodec'),
    metaAcodec: $('metaAcodec'), metaChans: $('metaChans'), metaSr: $('metaSr'),
    metaBitrate: $('metaBitrate'), metaGamma: $('metaGamma'),
    metaAR: $('metaAR'), metaSrc: $('metaSrc'), metaSrcType: $('metaSrcType'),
    metaVR: $('metaVR'), metaHlsVer: $('metaHlsVer'),
    metaHlsLevels: $('metaHlsLevels'), metaHlsSeg: $('metaHlsSeg'),
    metaHlsLatency: $('metaHlsLatency'),
    metricLoudness: $('metricLoudness'), metricLufs: $('metricLufs'),
    waveformCanvas: $('waveformCanvas'), vectorscopeCanvas: $('vectorscopeCanvas'),
    histogramCanvas: $('histogramCanvas'), audioCanvas: $('audioCanvas'),
    phaseCanvas: $('phaseCanvas'), loudnessCanvas: $('loudnessCanvas'),
    cieCanvas: $('cieCanvas'), diamondCanvas: $('diamondCanvas'),
    hlsQualityWrap: $('hlsQualityWrap'), hlsQualitySelect: $('hlsQualitySelect'),
    sliderQuality: $('sliderQuality'), sliderDensity: $('sliderDensity'),
    valQuality: $('valQuality'), valDensity: $('valDensity'),
    wfModeGroup: $('wfModeGroup'),
    vsStdGroup: $('vsStdGroup'),
    histRangeGroup: $('histRangeGroup'),
    cieStdGroup: $('cieStdGroup'),
  };

  const offscreen = document.createElement('canvas');
  const offctx = offscreen.getContext('2d', { willReadFrequently: true });

  // ── Web Worker ─────────────────────────────────────────────────────────────
  function initWorker() {
    fetch('worker.js')
      .then(r => r.blob())
      .then(blob => {
        state.worker = new Worker(URL.createObjectURL(blob));
        state.worker.onmessage = onWorkerResult;
        state.worker.onerror = e => { console.error('[Worker]', e.message); state.workerBusy = false; };
      })
      .catch(() => console.error('[Monitor] Falha ao carregar worker.js'));
  }

  function onWorkerResult(e) {
    const { wfPoints, vsPoints, histR, histG, histB, wfLen, vsLen, wfMode,
            ciePoints, cieLen, diamondPoints, diamondLen } = e.data;
    state.wfPoints      = new Float32Array(wfPoints).subarray(0, wfLen);
    state.wfModeResult  = wfMode;
    state.vsPoints      = new Float32Array(vsPoints).subarray(0, vsLen);
    state.histR         = new Uint32Array(histR);
    state.histG         = new Uint32Array(histG);
    state.histB         = new Uint32Array(histB);
    state.ciePoints     = ciePoints     ? new Float32Array(ciePoints).subarray(0, cieLen||0)     : null;
    state.diamondPoints = diamondPoints ? new Float32Array(diamondPoints).subarray(0, diamondLen||0) : null;
    state.workerBusy    = false;
    if (state.modules.waveform)  drawWaveformOn(state.wfPoints,      el.waveformCanvas);
    if (state.modules.vector)    drawVectorscopeOn(state.vsPoints,   el.vectorscopeCanvas);
    if (state.modules.histogram) drawHistogramOn(state.histR, state.histG, state.histB, el.histogramCanvas);
    if (state.modules.cie)       drawCieOn(state.ciePoints,          el.cieCanvas);
    if (state.modules.diamond)   drawDiamondOn(state.diamondPoints,  el.diamondCanvas);
  }

  // ── HiDPI canvas ───────────────────────────────────────────────────────────
  const CANVAS_HEIGHTS = {
    waveformCanvas:160, vectorscopeCanvas:160, histogramCanvas:160,
    cieCanvas:160,      diamondCanvas:160,      audioCanvas:160,
    phaseCanvas:220,    loudnessCanvas:220,
  };
  function initCanvases() {
    const dpr = window.devicePixelRatio || 1;
    Object.entries(CANVAS_HEIGHTS).forEach(([id, cssH]) => {
      const c = $(id); if (!c) return;
      const cssW = c.parentElement ? c.parentElement.offsetWidth || 400 : 400;
      c.width  = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function getCtx(canvas) { return canvas ? canvas.getContext('2d') : null; }
  function cw(c) { return c.width  / (window.devicePixelRatio || 1); }
  function ch(c) { return c.height / (window.devicePixelRatio || 1); }

  const BG  = '#090b0d';
  const LC  = 'rgba(153,163,173,.8)';
  const GC  = 'rgba(153,163,173,.14)';
  const GC2 = 'rgba(153,163,173,.28)';
  function fillBg(ctx, w, h) { ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h); }
  function font(ctx, sz) { ctx.font = `500 ${sz}px Satoshi,system-ui`; }

  // ── WAVEFORM ───────────────────────────────────────────────────────────────
  function drawWaveformGrid(ctx, w, h) {
    [255, 192, 128, 64, 0].forEach((lv, i) => {
      const y = h - (lv / 255) * h;
      ctx.strokeStyle = (lv === 0 || lv === 128 || lv === 255) ? GC2 : GC;
      ctx.lineWidth   = (lv === 0 || lv === 128 || lv === 255) ? 1 : .7;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      font(ctx, 10); ctx.fillStyle = LC; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(lv), 4, y + (i === 0 ? 7 : i === 4 ? -4 : 0));
    });
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'center'; ctx.fillStyle = LC; font(ctx, 9);
    [0, 25, 50, 75, 100].forEach(p => ctx.fillText(p + '%', (p / 100) * w, h - 2));
  }

  function drawWaveformLuma(ctx, pts, w, h) {
    ctx.fillStyle = 'rgba(73,182,193,.22)';
    for (let i = 0; i < pts.length; i += 2)
      ctx.fillRect(Math.round(pts[i] * (w - 1)), Math.round((1 - pts[i+1]) * (h - 1)), 1, 1);
  }
  function drawWaveformRGB(ctx, pts, w, h) {
    const colors = ['rgba(255,80,100,.3)', 'rgba(80,200,80,.3)', 'rgba(80,140,255,.3)'];
    for (let i = 0; i < pts.length; i += 6)
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = colors[c];
        ctx.fillRect(Math.round(pts[i + c*2] * (w - 1)), Math.round((1 - pts[i + c*2 + 1]) * (h - 1)), 1, 1);
      }
  }
  function drawWaveformYCbCr(ctx, pts, w, h) {
    for (let i = 0; i < pts.length; i += 4) {
      ctx.fillStyle = 'rgba(73,182,193,.28)';
      ctx.fillRect(Math.round(pts[i]   * (w-1)), Math.round((1 - pts[i+1]) * (h-1)), 1, 1);
      ctx.fillStyle = 'rgba(255,180,84,.28)';
      ctx.fillRect(Math.round(pts[i+2] * (w-1)), Math.round((1 - pts[i+3]) * (h-1)), 1, 1);
    }
  }

  function drawWaveformOn(pts, canvas) {
    if (!canvas) return;
    const ctx = getCtx(canvas), w = cw(canvas), h = ch(canvas);
    fillBg(ctx, w, h); drawWaveformGrid(ctx, w, h);
    if (!pts || pts.length < 2) return;
    const mode = state.wfModeResult || 'luma';
    if (mode === 'rgb')    drawWaveformRGB(ctx, pts, w, h);
    else if (mode === 'ycbcr') drawWaveformYCbCr(ctx, pts, w, h);
    else                   drawWaveformLuma(ctx, pts, w, h);
    font(ctx, 9); ctx.fillStyle = 'rgba(73,182,193,.8)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText({ luma:'Luma', rgb:'RGB Parade', ycbcr:'YCbCr' }[mode] || mode, w - 4, 4);
  }

  // ── VECTORSCOPE ────────────────────────────────────────────────────────────
  const VS_COLORS = [
    { label:'R',  r:255, g:0,   b:0   },
    { label:'G',  r:0,   g:255, b:0   },
    { label:'B',  r:0,   g:0,   b:255 },
    { label:'Cy', r:0,   g:255, b:255 },
    { label:'Mg', r:255, g:0,   b:255 },
    { label:'Ye', r:255, g:255, b:0   },
  ];
  function rgbToVS(r, g, b, std) {
    if (std === 'bt2020') return { cb: -0.1646*r - 0.3354*g + 0.5*b,  cr: 0.5*r - 0.4598*g - 0.0402*b };
    return                       { cb: -0.1873*r - 0.3127*g + 0.5*b,  cr: 0.5*r - 0.4187*g - 0.0813*b };
  }
  function drawVectorscopeOn(pts, canvas) {
    if (!canvas) return;
    const ctx = getCtx(canvas), w = cw(canvas), h = ch(canvas);
    const cx = w/2, cy = h/2, radius = Math.min(cx, cy) * .82;
    fillBg(ctx, w, h);
    [.25, .5, .75, 1].forEach((pct, i) => {
      ctx.strokeStyle = i === 3 ? GC2 : GC; ctx.lineWidth = i === 3 ? 1 : .7;
      ctx.beginPath(); ctx.arc(cx, cy, radius * pct, 0, Math.PI*2); ctx.stroke();
      font(ctx, 9); ctx.fillStyle = LC; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(pct * 100) + '%', cx + radius * pct + 8, cy - 5);
    });
    ctx.strokeStyle = GC2; ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius*1.06); ctx.lineTo(cx, cy + radius*1.06);
    ctx.moveTo(cx - radius*1.06, cy); ctx.lineTo(cx + radius*1.06, cy);
    ctx.stroke();
    font(ctx, 10); ctx.fillStyle = LC;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';    ctx.fillText('Cb\u2192', cx + radius + 18, cy + 4);
    ctx.textAlign = 'right';  ctx.textBaseline = 'bottom'; ctx.fillText('Cr\u2191', cx - 4, cy - radius - 2);
    font(ctx, 9); ctx.fillStyle = 'rgba(73,182,193,.8)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(state.vsStd.toUpperCase(), 4, 4);
    VS_COLORS.forEach(({ label, r, g, b }) => {
      const { cb, cr } = rgbToVS(r, g, b, state.vsStd);
      const tx = cx + (cb/128)*radius, ty = cy - (cr/128)*radius;
      ctx.beginPath(); ctx.arc(tx, ty, 4.5, 0, Math.PI*2);
      ctx.strokeStyle = `rgb(${r},${g},${b})`; ctx.lineWidth = 2; ctx.stroke();
      font(ctx, 9); ctx.fillStyle = LC; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, tx, ty - 6);
    });
    if (!pts || pts.length < 2) return;
    ctx.fillStyle = 'rgba(73,182,193,.22)';
    for (let i = 0; i < pts.length; i += 2) {
      const x = Math.round(cx + pts[i]*radius), y = Math.round(cy - pts[i+1]*radius);
      if (x >= 0 && x < w && y >= 0 && y < h) ctx.fillRect(x, y, 1, 1);
    }
  }

  // ── HISTOGRAMA ─────────────────────────────────────────────────────────────
  function drawHistogramOn(histR, histG, histB, canvas) {
    if (!canvas || !histR) return;
    const ctx = getCtx(canvas), w = cw(canvas), h = ch(canvas);
    fillBg(ctx, w, h);
    const legal = HIST_LEGAL;
    let mx = 1;
    for (let i = 0; i < 256; i++) mx = Math.max(mx, histR[i], histG[i], histB[i]);
    font(ctx, 10);
    for (let i = 0; i <= 4; i++) {
      const y = (h/4) * i;
      ctx.strokeStyle = GC; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = LC; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round((1 - i/4)*100) + '%', 4, y + (i===0?7:i===4?-4:0));
    }
    [0, 64, 128, 192, 255].forEach(v => {
      const x = (v/255)*w;
      ctx.strokeStyle = GC; ctx.lineWidth = .5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = LC; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(v, x, h-2);
    });
    if (state.histRange === 'legal') {
      const xLo = (legal.lo/255)*w, xHi = (legal.hi/255)*w;
      ctx.fillStyle = 'rgba(255,180,84,.06)';
      ctx.fillRect(0, 0, xLo, h); ctx.fillRect(xHi, 0, w - xHi, h);
      ctx.strokeStyle = 'rgba(255,180,84,.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xLo, 0); ctx.lineTo(xLo, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xHi, 0); ctx.lineTo(xHi, h); ctx.stroke();
    }
    const bw = w/256;
    for (let i = 0; i < 256; i++) {
      const x = i*bw;
      const clip = state.histRange === 'legal' && (i <= legal.lo || i >= legal.hi);
      const a = clip ? '.75' : '.42';
      ctx.fillStyle = `rgba(255,80,100,${a})`;  ctx.fillRect(x, h-14-(histR[i]/mx)*(h-14), Math.max(1,bw), (histR[i]/mx)*(h-14));
      ctx.fillStyle = `rgba(80,200,80,${a})`;   ctx.fillRect(x, h-14-(histG[i]/mx)*(h-14), Math.max(1,bw), (histG[i]/mx)*(h-14));
      ctx.fillStyle = `rgba(80,140,255,${a})`;  ctx.fillRect(x, h-14-(histB[i]/mx)*(h-14), Math.max(1,bw), (histB[i]/mx)*(h-14));
    }
    if (state.histRange === 'legal') {
      font(ctx, 9);
      if (histR[0]+histR[1]+histR[2] > 0) { ctx.fillStyle='rgba(255,180,84,.9)'; ctx.textAlign='left';  ctx.textBaseline='top'; ctx.fillText('\u25bc clip', 2, 2); }
      if (histR[253]+histR[254]+histR[255] > 0) { ctx.fillStyle='rgba(255,107,129,.9)'; ctx.textAlign='right'; ctx.textBaseline='top'; ctx.fillText('clip \u25bc', w-2, 2); }
    }
  }

  // ── CIE CHROMATICITY ───────────────────────────────────────────────────────
  const CIE_LOCUS = [
    [.1741,.0050],[.1740,.0050],[.1738,.0049],[.1736,.0049],[.1733,.0048],
    [.1730,.0048],[.1726,.0048],[.1721,.0048],[.1714,.0051],[.1703,.0058],
    [.1689,.0069],[.1669,.0086],[.1644,.0109],[.1611,.0138],[.1566,.0177],
    [.1510,.0227],[.1440,.0297],[.1355,.0399],[.1241,.0578],[.1096,.0868],
    [.0913,.1327],[.0687,.2007],[.0454,.2950],[.0235,.4127],[.0082,.5384],
    [.0039,.6548],[.0139,.7502],[.0389,.8120],[.0743,.8338],[.1142,.8262],
    [.1547,.8059],[.1929,.7816],[.2296,.7543],[.2658,.7243],[.3016,.6923],
    [.3373,.6589],[.3731,.6245],[.4087,.5896],[.4441,.5547],[.4788,.5202],
    [.5125,.4866],[.5448,.4544],[.5752,.4242],[.6029,.3965],[.6270,.3728],
    [.6482,.3529],[.6658,.3364],[.6801,.3229],[.6915,.3126],[.7006,.3044],
    [.7079,.2980],[.7140,.2928],[.7190,.2885],[.7230,.2853],[.7260,.2826],
    [.7283,.2807],[.7300,.2793],[.7311,.2783],[.7320,.2776],[.7327,.2771],
    [.7334,.2766],[.7340,.2762],[.7344,.2759],[.7346,.2758],[.7347,.2757],
    [.1741,.0050],
  ];

  // Converte primária CIE xy → pixel no diagrama
  function cieXyToPx(x, y, mx, my, pw, ph) {
    return [mx + x * pw / .8, my + (1 - y / .9) * ph];
  }

  function drawCieGamutTriangle(ctx, std, mx, my, pw, ph) {
    const g = CIE_GAMUT[std]; if (!g) return;
    const [rx, ry] = cieXyToPx(g.r[0], g.r[1], mx, my, pw, ph);
    const [gx, gy] = cieXyToPx(g.g[0], g.g[1], mx, my, pw, ph);
    const [bx, by] = cieXyToPx(g.b[0], g.b[1], mx, my, pw, ph);
    const [wx, wy] = cieXyToPx(g.w[0], g.w[1], mx, my, pw, ph);
    const isBt2020 = std === 'bt2020';
    const triColor  = isBt2020 ? 'rgba(255,180,84,.85)' : 'rgba(73,182,193,.85)';
    const fillColor = isBt2020 ? 'rgba(255,180,84,.06)' : 'rgba(73,182,193,.06)';
    ctx.beginPath();
    ctx.moveTo(rx, ry); ctx.lineTo(gx, gy); ctx.lineTo(bx, by); ctx.closePath();
    ctx.strokeStyle = triColor; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = fillColor; ctx.fill();
    // Rótulos RGB
    font(ctx, 9);
    [['R', rx, ry, 'rgba(255,100,100,.9)'],
     ['G', gx, gy, 'rgba(100,210,100,.9)'],
     ['B', bx, by, 'rgba(100,140,255,.9)']].forEach(([lbl, px, py, col]) => {
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(lbl, px, py - 4);
    });
    // Ponto branco D65
    ctx.beginPath(); ctx.arc(wx, wy, 3, 0, Math.PI*2);
    ctx.fillStyle = triColor; ctx.fill();
    font(ctx, 8); ctx.fillStyle = triColor;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('D65', wx + 4, wy);
  }

  function drawCieOn(pts, canvas) {
    if (!canvas) return;
    const ctx = getCtx(canvas), w = cw(canvas), h = ch(canvas);
    fillBg(ctx, w, h);
    const mx = 24, my = 20, pw = w - mx*2, ph = h - my*2;
    const grd = ctx.createLinearGradient(mx, my, mx+pw, my+ph);
    grd.addColorStop(0, 'rgba(0,0,200,.18)'); grd.addColorStop(.3, 'rgba(0,200,0,.18)');
    grd.addColorStop(.6, 'rgba(200,200,0,.18)'); grd.addColorStop(1, 'rgba(200,0,0,.18)');
    ctx.fillStyle = grd; ctx.fillRect(mx, my, pw, ph);
    font(ctx, 9);
    [0, .2, .4, .6, .8].forEach(v => {
      const x = mx + v*pw, y = my + v*ph;
      ctx.strokeStyle = GC; ctx.lineWidth = .6;
      ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my+ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx+pw, y); ctx.stroke();
      ctx.fillStyle = LC; ctx.textAlign = 'center'; ctx.textBaseline = 'top';    ctx.fillText(v.toFixed(1), x, my+ph+3);
      ctx.textAlign = 'right';  ctx.textBaseline = 'middle'; ctx.fillText(v.toFixed(1), mx-3, y);
    });
    ctx.fillStyle = LC;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';    ctx.fillText('x', mx+pw/2, my+ph+12);
    ctx.save(); ctx.translate(mx-16, my+ph/2); ctx.rotate(-Math.PI/2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('y', 0, 0); ctx.restore();
    // Spectral locus
    ctx.beginPath();
    CIE_LOCUS.forEach(([lx, ly], i) => {
      const px = mx + lx*pw/.8, py = my + (1 - ly/.9)*ph;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill();
    // Triângulo de gamut (BT.709 sempre + BT.2020 se selecionado)
    if (state.cieStd === 'bt2020') {
      drawCieGamutTriangle(ctx, 'bt709',  mx, my, pw, ph); // referência sutil
      drawCieGamutTriangle(ctx, 'bt2020', mx, my, pw, ph); // selecionado em destaque
    } else {
      drawCieGamutTriangle(ctx, 'bt709', mx, my, pw, ph);
    }
    // Pontos do sinal
    if (pts && pts.length >= 2) {
      ctx.fillStyle = 'rgba(255,200,80,.55)';
      for (let i = 0; i < pts.length; i += 2) {
        const px = mx + pts[i]*pw/.8, py = my + (1 - pts[i+1]/.9)*ph;
        if (px >= mx && px <= mx+pw && py >= my && py <= my+ph)
          ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
      }
    }
    // Label
    font(ctx, 9); ctx.fillStyle = 'rgba(73,182,193,.8)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const stdLabel = state.cieStd === 'bt2020' ? 'BT.2020' : 'BT.709';
    ctx.fillText('CIE 1931 xy \u00b7 ' + stdLabel, w - 4, 4);
  }

  // ── DIAMOND / TWIN PEAKS ───────────────────────────────────────────────────
  function drawDiamondOn(pts, canvas) {
    if (!canvas) return;
    const ctx = getCtx(canvas), w = cw(canvas), h = ch(canvas);
    fillBg(ctx, w, h);
    const cx = w/2, cy = h/2, sc = Math.min(cx, cy) * .84;
    ctx.beginPath();
    ctx.moveTo(cx,    cy-sc); ctx.lineTo(cx+sc, cy);
    ctx.lineTo(cx,    cy+sc); ctx.lineTo(cx-sc, cy);
    ctx.closePath();
    ctx.strokeStyle = GC2; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(73,182,193,.03)'; ctx.fill();
    ctx.strokeStyle = GC2; ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(cx, cy-sc); ctx.lineTo(cx, cy+sc);
    ctx.moveTo(cx-sc, cy); ctx.lineTo(cx+sc, cy);
    const s75 = sc * .75;
    ctx.moveTo(cx, cy-s75); ctx.lineTo(cx+s75, cy);
    ctx.lineTo(cx, cy+s75); ctx.lineTo(cx-s75, cy); ctx.closePath();
    ctx.stroke();
    font(ctx, 9); ctx.fillStyle = LC;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('Y\u2191', cx, cy-sc-4);
    ctx.textBaseline = 'top';    ctx.fillText('Y\u2193', cx, cy+sc+4);
    ctx.textAlign = 'right';  ctx.textBaseline = 'middle'; ctx.fillText('B-Y', cx-sc-4, cy);
    ctx.textAlign = 'left';   ctx.fillText('R-Y', cx+sc+4, cy);
    font(ctx, 9); ctx.fillStyle = 'rgba(73,182,193,.8)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('Diamond', w-4, 4);
    if (!pts || pts.length < 2) return;
    ctx.fillStyle = 'rgba(73,182,193,.3)';
    for (let i = 0; i < pts.length; i += 2) {
      const px = Math.round(cx + pts[i]*sc);
      const py = Math.round(cy - pts[i+1]*sc);
      if (px >= 0 && px < w && py >= 0 && py < h) ctx.fillRect(px, py, 1, 1);
    }
  }

  // ── AUDIO SPECTRUM ─────────────────────────────────────────────────────────
  function renderAudioSpectrum() {
    if (!state.modules.spectrum || !state.analyserL) return;
    const ctx = getCtx(el.audioCanvas), w = cw(el.audioCanvas), h = ch(el.audioCanvas);
    const freqBuf = new Uint8Array(state.analyserL.frequencyBinCount);
    state.analyserL.getByteFrequencyData(freqBuf);
    fillBg(ctx, w, h);
    const ny = state.audioContext.sampleRate/2, bc = state.analyserL.frequencyBinCount;
    font(ctx, 9);
    [100, 500, 1000, 5000, 10000, 20000].forEach(f => {
      if (f > ny) return;
      const x = (Math.round(f/ny*bc)/bc)*w;
      ctx.strokeStyle = GC; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h-14); ctx.stroke();
      ctx.fillStyle = LC; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(f >= 1000 ? (f/1000)+'k' : f, x, h-2);
    });
    [0, -12, -24, -36, -48, -60].forEach(db => {
      const y = (1 - Math.abs(db)/60) * (h-14);
      ctx.strokeStyle = GC; ctx.lineWidth = .5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = LC; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(db+'dB', 2, y);
    });
    const bw = w/120, step = Math.max(1, Math.floor(bc/120));
    for (let i = 0; i < 120; i++) {
      const v = (freqBuf[i*step] || 0)/255, barH = v*(h-14);
      ctx.fillStyle = `hsla(${185 + v*55},70%,58%,.88)`;
      ctx.fillRect(i*bw, h-14-barH, Math.max(1, bw-1), barH);
    }
  }

  // ── PHASE / GONIÔMETRO ────────────────────────────────────────────────────
  function renderPhase() {
    if (!state.modules.phase || !state.analyserL || !state.analyserR) return;
    const ctx = getCtx(el.phaseCanvas), w = cw(el.phaseCanvas), h = ch(el.phaseCanvas);
    const bufL = new Float32Array(state.analyserL.fftSize);
    const bufR = new Float32Array(state.analyserR.fftSize);
    state.analyserL.getFloatTimeDomainData(bufL); state.analyserR.getFloatTimeDomainData(bufR);
    const cx = w/2, cy = h/2, sc = Math.min(cx, cy) * .84;
    ctx.fillStyle = 'rgba(9,11,13,.2)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = GC2; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.arc(cx, cy, sc, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy-sc); ctx.lineTo(cx, cy+sc);
    ctx.moveTo(cx-sc, cy); ctx.lineTo(cx+sc, cy);
    ctx.stroke();
    font(ctx, 10); ctx.fillStyle = LC;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('M', cx, cy-sc-4);
    ctx.textAlign = 'left';  ctx.textBaseline = 'middle'; ctx.fillText('S', cx+sc+6, cy);
    ctx.textAlign = 'right'; ctx.fillText('-S', cx-sc-6, cy);
    ctx.fillStyle = 'rgba(73,182,193,.28)';
    for (let i = 0; i < bufL.length; i++) {
      const px = Math.round(cx + (bufL[i] - bufR[i]) * sc);
      const py = Math.round(cy - (bufL[i] + bufR[i]) * sc);
      if (px >= 0 && px < w && py >= 0 && py < h) ctx.fillRect(px, py, 1, 1);
    }
  }

  // ── LOUDNESS ───────────────────────────────────────────────────────────────
  function renderLoudness() {
    if (!state.modules.loudness || !state.analyserL) return;
    const ctx = getCtx(el.loudnessCanvas), w = cw(el.loudnessCanvas), h = ch(el.loudnessCanvas);
    const buf = new Float32Array(state.analyserL.fftSize);
    state.analyserL.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db  = rms > 0 ? Math.max(-60, 20*Math.log10(rms)) : -60;
    state.loudnessHistory.push(db); if (state.loudnessHistory.length > 300) state.loudnessHistory.shift();
    state.lufsShortBuf.push(db);   if (state.lufsShortBuf.length > 90)  state.lufsShortBuf.shift();
    const lufs = state.lufsShortBuf.reduce((a, v) => a + v, 0) / state.lufsShortBuf.length;
    if (el.metricLoudness) el.metricLoudness.textContent = db.toFixed(1) + ' dBFS';
    if (el.metricLufs)     el.metricLufs.textContent     = lufs.toFixed(1) + ' LUFS';
    fillBg(ctx, w, h);
    const refs = [
      { v:0,   l:'0 dBFS',    c:'rgba(255,107,129,.75)' },
      { v:-9,  l:'-9',        c:'rgba(255,180,84,.6)'   },
      { v:-16, l:'-16 str',   c:'rgba(119,178,85,.6)'   },
      { v:-23, l:'-23 R128',  c:'rgba(73,182,193,.6)'   },
    ];
    font(ctx, 9);
    refs.forEach(({ v, l, c }) => {
      const y = h * (1 - (v + 60)/60);
      ctx.strokeStyle = c; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = c.replace(/[\d.]+\)$/, '.95)');
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(l, w-18, y-1);
    });
    ctx.strokeStyle = 'rgba(255,180,84,.95)'; ctx.lineWidth = 1.5; ctx.beginPath();
    state.loudnessHistory.forEach((v, i) => {
      const x = (i / Math.max(1, state.loudnessHistory.length - 1)) * w;
      const y = h * (1 - (v + 60)/60);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }); ctx.stroke();
    const bH = Math.max(1, (db + 60)/60 * h);
    const bc2 = db > -9 ? '#ff6b81' : db > -16 ? '#ffb454' : '#77b255';
    ctx.fillStyle = bc2 + '55'; ctx.fillRect(w-14, h-bH, 10, bH);
    ctx.fillStyle = bc2;        ctx.fillRect(w-14, h-bH, 10, 2);
  }

  // ── Loop principal ─────────────────────────────────────────────────────────
  function analysisLoop(ts) {
    const v = el.video;
    if (!v.videoWidth) { state.rafId = requestAnimationFrame(analysisLoop); return; }
    state.frameCount++;
    if (!state.lastFrameAt) state.lastFrameAt = ts;
    const delta = ts - state.lastFrameAt;
    if (delta >= 1000) {
      const fps = Math.round((state.frameCount * 1000) / delta);
      if (el.metaFps) el.metaFps.textContent = fps + ' fps';
      state.frameCount = 0; state.lastFrameAt = ts;
    }
    if (el.metaRes) el.metaRes.textContent = `${v.videoWidth}\u00d7${v.videoHeight}`;
    const hasVideo = state.modules.waveform || state.modules.vector ||
                     state.modules.histogram || state.modules.cie || state.modules.diamond;
    if (hasVideo && !state.workerBusy && state.worker) {
      const div = Q_DIV[state.quality - 1];
      const fw = Math.max(1, Math.round(v.videoWidth  / div));
      const fh = Math.max(1, Math.round(v.videoHeight / div));
      offscreen.width = fw; offscreen.height = fh;
      offctx.drawImage(v, 0, 0, fw, fh);
      try {
        const imgData = offctx.getImageData(0, 0, fw, fh);
        state.workerBusy = true;
        state.worker.postMessage(
          { buf: imgData.data.buffer, fw, fh, step: D_STEP[state.density-1], vsStd: state.vsStd, wfMode: state.wfMode },
          [imgData.data.buffer]
        );
      } catch(e) {
        el.corsState.textContent = 'Bloqueado'; el.corsDot.className = 'dot err';
        state.workerBusy = false;
      }
    }
    renderAudioSpectrum();
    renderPhase();
    renderLoudness();
    state.rafId = requestAnimationFrame(analysisLoop);
  }

  // ── Áudio graph ───────────────────────────────────────────────────────────
  async function ensureAudioGraph() {
    if (state.audioContext) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AC();
    state.sourceNode = state.audioContext.createMediaElementSource(el.video);
    state.splitter   = state.audioContext.createChannelSplitter(2);
    state.analyserL  = state.audioContext.createAnalyser();
    state.analyserR  = state.audioContext.createAnalyser();
    state.analyserL.fftSize = 2048; state.analyserR.fftSize = 2048;
    state.sourceNode.connect(state.splitter);
    state.splitter.connect(state.analyserL, 0);
    state.splitter.connect(state.analyserR, 1);
    const merger = state.audioContext.createChannelMerger(2);
    state.analyserL.connect(merger, 0, 0);
    state.analyserR.connect(merger, 0, 1);
    merger.connect(state.audioContext.destination);
    el.audioState.textContent = 'Ativo'; el.audioDot.className = 'dot ok';
    if (el.metaSr) el.metaSr.textContent = state.audioContext.sampleRate + ' Hz';
    if (el.metaAcodec) el.metaAcodec.textContent = 'AAC/PCM (estimado)';
    if (el.metaChans)  el.metaChans.textContent  = 'Est\u00e9reo';
  }

  // ── Metadados HLS ──────────────────────────────────────────────────────────
  function updateHlsMetadata() {
    if (!state.hls) return;
    const lvl    = state.hls.currentLevel >= 0 ? state.hls.levels[state.hls.currentLevel] : null;
    const maxLvl = state.hls.levels[state.hls.levels.length - 1];
    if (maxLvl) {
      if (el.metaResMax)    el.metaResMax.textContent    = `${maxLvl.width}\u00d7${maxLvl.height}`;
      const fr = maxLvl.attrs?.['FRAME-RATE'] ? parseFloat(maxLvl.attrs['FRAME-RATE']).toFixed(2) + ' fps' : '\u2014';
      if (el.metaFpsStream) el.metaFpsStream.textContent = fr;
      const vc = maxLvl.attrs?.['CODECS'] ? maxLvl.attrs['CODECS'].split(',')[0] : 'H.264 (HLS)';
      if (el.metaVcodec)    el.metaVcodec.textContent    = vc;
      const vr = maxLvl.attrs?.['VIDEO-RANGE'] || 'SDR';
      if (el.metaVR)        el.metaVR.textContent        = vr;
      if (el.metaGamma)     el.metaGamma.textContent     = vr;
    }
    if (lvl?.bitrate && el.metaBitrate) el.metaBitrate.textContent = (lvl.bitrate/1000).toFixed(0) + ' kbps';
    const nLevels = state.hls.levels.length;
    if (el.metaHlsLevels) el.metaHlsLevels.textContent = nLevels + ' rendi\u00e7\u00f5es';
    if (el.metaHlsVer)    el.metaHlsVer.textContent    = '3+';
    const segDur = state.hls.config?.maxBufferLength ? '~' + state.hls.config.maxBufferLength + 's buf' : '\u2014';
    if (el.metaHlsSeg)    el.metaHlsSeg.textContent    = segDur;
    try {
      const lat = state.hls.liveSyncPosition && el.video.currentTime > 0
        ? (state.hls.liveSyncPosition - el.video.currentTime).toFixed(1) + 's' : '\u2014';
      if (el.metaHlsLatency) el.metaHlsLatency.textContent = lat;
    } catch(e) {}
  }

  function updateVideoMetadata() {
    const v = el.video;
    if (!v.videoWidth) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (el.metaRes) el.metaRes.textContent = `${w}\u00d7${h}`;
    const gcd = (a, b) => b ? gcd(b, a%b) : a, g = gcd(w, h);
    if (el.metaAR)  el.metaAR.textContent  = `${w/g}:${h/g}`;
    if (!state.hls) {
      const isBlobTs = v.currentSrc.startsWith('blob:');
      if (el.metaVcodec)    el.metaVcodec.textContent    = isBlobTs ? 'MPEG-TS (local)' : 'H.264/AVC';
      if (el.metaGamma)     el.metaGamma.textContent     = '\u2014';
      if (el.metaVR)        el.metaVR.textContent        = 'SDR (estimado)';
      if (el.metaResMax)    el.metaResMax.textContent    = `${w}\u00d7${h}`;
      if (el.metaHlsVer)    el.metaHlsVer.textContent    = 'N/A';
      if (el.metaHlsLevels) el.metaHlsLevels.textContent = 'N/A';
      if (el.metaHlsSeg)    el.metaHlsSeg.textContent    = 'N/A';
      if (el.metaHlsLatency)el.metaHlsLatency.textContent= 'N/A';
    } else {
      updateHlsMetadata();
    }
    if (state.audioContext && el.metaSr) el.metaSr.textContent = state.audioContext.sampleRate + ' Hz';
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  async function startPlayback() {
    try {
      await ensureAudioGraph();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
      await el.video.play();
      el.playerState.textContent = 'Reproduzindo';
      el.videoState.textContent  = 'Online'; el.videoDot.className = 'dot ok';
      cancelAnimationFrame(state.rafId);
      state.lastFrameAt = 0; state.frameCount = 0; state.workerBusy = false;
      setTimeout(() => { initCanvases(); updateVideoMetadata(); }, 250);
      state.rafId = requestAnimationFrame(analysisLoop);
    } catch(e) { el.playerState.textContent = 'Falha no play'; }
  }

  // ── HLS quality ───────────────────────────────────────────────────────────
  function populateHlsQuality() {
    if (!state.hls || !state.hls.levels.length) return;
    el.hlsQualitySelect.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '-1'; auto.textContent = 'Auto (ABR)';
    el.hlsQualitySelect.appendChild(auto);
    state.hls.levels.forEach((lvl, i) => {
      const opt = document.createElement('option'); opt.value = String(i);
      const fr = lvl.attrs?.['FRAME-RATE'] ? `@${parseFloat(lvl.attrs['FRAME-RATE']).toFixed(0)}fps` : 'fps';
      const vr = lvl.attrs?.['VIDEO-RANGE'] ? ` [${lvl.attrs['VIDEO-RANGE']}]` : '';
      opt.textContent = `${lvl.width}\u00d7${lvl.height} \u2022 ${(lvl.bitrate/1000).toFixed(0)}k ${fr}${vr}`;
      el.hlsQualitySelect.appendChild(opt);
    });
    el.hlsQualityWrap.classList.add('visible');
    el.hlsQualitySelect.addEventListener('change', () => {
      const v = parseInt(el.hlsQualitySelect.value);
      state.hls.currentLevel = v; if (v >= 0) state.hls.loadLevel = v;
      setTimeout(updateHlsMetadata, 500);
    });
  }

  // ── Load URL ───────────────────────────────────────────────────────────────
  function destroyHls() { if (state.hls) { state.hls.destroy(); state.hls = null; } }

  function isHlsUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes('.m3u8')) return true;
    if (lower.includes('playlist') && lower.includes('m3u8')) return true;
    if (/\/j\/ey[A-Za-z0-9_-]{10,}/.test(url)) return true;
    if (lower.includes('manifest') && lower.includes('m3u8')) return true;
    return false;
  }

  function loadFromUrl() {
    const url = el.streamUrl.value.trim(); if (!url) return;
    destroyHls();
    el.hlsQualityWrap.classList.remove('visible');
    el.video.pause(); el.video.removeAttribute('src'); el.video.load();
    state.activeSource = url;
    const srcType = isHlsUrl(url) ? 'HLS (stream)'
      : (url.includes('.ts') || url.includes('.mts')) ? 'MPEG-TS' : 'LINK';
    if (el.sourceBadge)  el.sourceBadge.textContent  = srcType;
    if (el.metaSrcType)  el.metaSrcType.textContent   = srcType;
    el.playerState.textContent = 'Carregando';
    if (el.metaSrc) el.metaSrc.textContent = url.length > 60 ? url.slice(0,60) + '\u2026' : url;
    el.corsDot.className = 'dot warn'; el.corsState.textContent = 'Verificando...';
    if (window.Hls && Hls.isSupported() && isHlsUrl(url)) {
      state.hls = new Hls({ enableWorker:true, lowLatencyMode:true, backBufferLength:30 });
      state.hls.loadSource(url); state.hls.attachMedia(el.video);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => { populateHlsQuality(); startPlayback(); });
      state.hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) {
          const msg = d.type==='networkError' ? 'Erro de rede/CORS'
            : d.type==='mediaError' ? 'Erro de m\u00eddia' : 'Erro HLS';
          el.playerState.textContent = msg; el.videoDot.className = 'dot err';
        }
      });
      el.corsState.textContent = 'HLS.js ativo'; el.corsDot.className = 'dot ok';
    } else {
      el.video.crossOrigin = 'anonymous'; el.video.src = url;
      el.video.addEventListener('loadedmetadata', startPlayback, { once:true });
      el.video.addEventListener('error', () => {
        if (window.Hls && Hls.isSupported()) {
          console.warn('[Monitor] Fallback HLS.js');
          destroyHls();
          state.hls = new Hls({ enableWorker:true });
          state.hls.loadSource(url); state.hls.attachMedia(el.video);
          state.hls.on(Hls.Events.MANIFEST_PARSED, () => { populateHlsQuality(); startPlayback(); });
        }
      }, { once:true });
    }
  }

  function loadFromFile(file) {
    if (!file) return;
    destroyHls(); el.hlsQualityWrap.classList.remove('visible');
    const url = URL.createObjectURL(file);
    state.activeSource = file.name;
    const isTs = file.name.toLowerCase().endsWith('.ts') || file.name.toLowerCase().endsWith('.mts');
    if (el.sourceBadge)  el.sourceBadge.textContent  = isTs ? 'MPEG-TS' : 'Arquivo';
    if (el.metaSrcType)  el.metaSrcType.textContent   = isTs ? 'MPEG-TS (arquivo)' : 'Arquivo local';
    el.playerState.textContent = 'Arquivo local';
    if (el.metaSrc) el.metaSrc.textContent = file.name;
    if (isTs && window.Hls && Hls.isSupported()) {
      state.hls = new Hls({ enableWorker:true });
      state.hls.loadSource(url); state.hls.attachMedia(el.video);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => startPlayback());
      state.hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) el.playerState.textContent = 'Erro TS remux'; });
    } else {
      el.video.crossOrigin = 'anonymous'; el.video.src = url;
      el.video.addEventListener('loadedmetadata', startPlayback, { once:true });
    }
  }

  // ── CORS check ─────────────────────────────────────────────────────────────
  function validateCanvasRead() {
    try {
      offscreen.width = 16; offscreen.height = 16;
      offctx.drawImage(el.video, 0, 0, 16, 16); offctx.getImageData(0, 0, 1, 1);
      el.corsState.textContent = 'Leitura ok'; el.corsDot.className = 'dot ok';
    } catch(e) {
      el.corsState.textContent = 'Bloqueado'; el.corsDot.className = 'dot err';
    }
  }

  // ── Module toggles ─────────────────────────────────────────────────────────
  function initModuleToggles() {
    const map = {
      'mod-waveform':'waveform', 'mod-vector':'vector', 'mod-histogram':'histogram',
      'mod-cie':'cie', 'mod-diamond':'diamond',
      'mod-spectrum':'spectrum', 'mod-phase':'phase', 'mod-loudness':'loudness',
    };
    Object.entries(map).forEach(([id, key]) => {
      const inp = $(id); if (!inp) return;
      const card = $('card-' + key);
      inp.addEventListener('change', () => {
        state.modules[key] = inp.checked;
        if (card) card.classList.toggle('scope-card-hidden', !inp.checked);
        if (!inp.checked && card) {
          const c = card.querySelector('canvas');
          if (c) { const ctx = c.getContext('2d'); ctx.fillStyle = BG; ctx.fillRect(0,0,c.width,c.height); }
        }
      });
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active'); $('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ── Sliders ────────────────────────────────────────────────────────────────
  function initSliders() {
    el.sliderQuality.addEventListener('input', () => { state.quality = parseInt(el.sliderQuality.value); el.valQuality.textContent = state.quality; });
    el.sliderDensity.addEventListener('input', () => { state.density = parseInt(el.sliderDensity.value); el.valDensity.textContent = state.density; });
  }

  // ── Scope buttons (dentro dos cards) ──────────────────────────────────────
  function initScopeButtons() {
    el.wfModeGroup && el.wfModeGroup.querySelectorAll('.scope-btn[data-wfmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.wfModeGroup.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.wfMode = btn.dataset.wfmode;
      });
    });
    el.vsStdGroup && el.vsStdGroup.querySelectorAll('.scope-btn[data-vsstd]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.vsStdGroup.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.vsStd = btn.dataset.vsstd;
      });
    });
    el.histRangeGroup && el.histRangeGroup.querySelectorAll('.scope-btn[data-histrange]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.histRangeGroup.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.histRange = btn.dataset.histrange;
      });
    });
    // CIE gamut standard
    el.cieStdGroup && el.cieStdGroup.querySelectorAll('.scope-btn[data-ciestd]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.cieStdGroup.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.cieStd = btn.dataset.ciestd;
        if (state.modules.cie) drawCieOn(state.ciePoints, el.cieCanvas);
      });
    });
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  function initTheme() {
    const btn = document.querySelector('[data-theme-toggle]'), html = document.documentElement;
    let mode = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    html.setAttribute('data-theme', mode);
    btn.addEventListener('click', () => {
      mode = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', mode);
    });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  el.loadUrlBtn.addEventListener('click', loadFromUrl);
  el.streamUrl.addEventListener('keydown', e => e.key === 'Enter' && loadFromUrl());
  el.fileInput.addEventListener('change', e => loadFromFile(e.target.files?.[0]));
  el.video.addEventListener('loadeddata', validateCanvasRead);
  el.video.addEventListener('pause', () => { el.playerState.textContent = 'Pausado'; });
  el.video.addEventListener('error', () => {
    el.playerState.textContent = 'Erro de m\u00eddia';
    el.videoState.textContent = 'Falha'; el.videoDot.className = 'dot err';
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  initTheme();
  initTabs();
  initModuleToggles();
  initSliders();
  initScopeButtons();
  initWorker();
  requestAnimationFrame(() => initCanvases());
  window.addEventListener('resize', () => initCanvases());
})();
