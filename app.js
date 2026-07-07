(() => {
  const VERSION = '2.1';
  console.log(
    `%c Jamal A/V %c v${VERSION} `,
    'background:#49b6c1;color:#101214;font-weight:900;padding:2px 0;border-radius:3px 0 0 3px',
    'background:#1a3438;color:#49b6c1;font-weight:700;padding:2px 4px;border-radius:0 3px 3px 0'
  );

  const Q_DIV  = [8, 4, 2, 1.5, 1];
  const D_STEP = [8, 4, 2, 1, 1];

  // ── Perfis de sinal ────────────────────────────────────────────────────────
  const SIGNAL_PROFILES = {
    sdr709: {
      label:'SDR BT.709', desc:'HD SDR \u00b7 Escala 0\u2013100 nit \u00b7 Gamut BT.709',
      nitsMax:100, nitsLog:false,
      nitsRefs:[
        {v:100,l:'100 nit',c:'rgba(255,107,129,.7)'},{v:75,l:'75',c:'rgba(153,163,173,.4)'},
        {v:50,l:'50',c:'rgba(153,163,173,.4)'},{v:25,l:'25',c:'rgba(153,163,173,.25)'},
        {v:0,l:'0',c:'rgba(153,163,173,.25)'},
      ],
      vsStd:'bt709', histLegal:{lo:16,hi:235},
      // pontos do gamut CIE 1931 xy (primárias + branco)
      gamut:[{x:.640,y:.330},{x:.300,y:.600},{x:.150,y:.060},{x:.3127,y:.3290}],
      gamutLabel:'BT.709',
    },
    hlg2020: {
      label:'HLG BT.2020', desc:'4K/HD HDR HLG \u00b7 Escala 0\u20131000 nit \u00b7 Gamut BT.2020',
      nitsMax:1000, nitsLog:false,
      nitsRefs:[
        {v:1000,l:'1000 nit',c:'rgba(255,107,129,.7)'},{v:203,l:'203 ref',c:'rgba(119,178,85,.7)'},
        {v:100,l:'100',c:'rgba(153,163,173,.35)'},{v:0,l:'0',c:'rgba(153,163,173,.25)'},
      ],
      vsStd:'bt2020', histLegal:{lo:16,hi:235},
      gamut:[{x:.708,y:.292},{x:.170,y:.797},{x:.131,y:.046},{x:.3127,y:.3290}],
      gamutLabel:'BT.2020',
    },
    pq2020: {
      label:'PQ BT.2020', desc:'4K/HD HDR PQ \u00b7 Escala 0\u201310000 nit (log) \u00b7 Gamut BT.2020',
      nitsMax:10000, nitsLog:true,
      nitsRefs:[
        {v:10000,l:'10k nit',c:'rgba(255,107,129,.7)'},{v:4000,l:'4000',c:'rgba(255,180,84,.55)'},
        {v:1000,l:'1000',c:'rgba(255,180,84,.45)'},{v:203,l:'203 ref',c:'rgba(119,178,85,.7)'},
        {v:100,l:'100',c:'rgba(153,163,173,.35)'},{v:0,l:'0',c:'rgba(153,163,173,.25)'},
      ],
      vsStd:'bt2020', histLegal:{lo:16,hi:235},
      gamut:[{x:.708,y:.292},{x:.170,y:.797},{x:.131,y:.046},{x:.3127,y:.3290}],
      gamutLabel:'BT.2020',
    },
  };

  const state = {
    hls:null, audioContext:null, analyserL:null, analyserR:null,
    splitter:null, sourceNode:null, rafId:null,
    lastFrameAt:0, frameCount:0, activeSource:null,
    loudnessHistory:[], lufsShortBuf:[],
    worker:null, workerBusy:false,
    quality:3, density:3,
    vsStd:'bt709', wfMode:'luma', wfNits:false, histRange:'legal',
    signalProfile:'sdr709',
    broadcastMode:false,
    modules:{ waveform:true,vector:true,histogram:true,cie:true,diamond:true,spectrum:true,phase:true,loudness:true },
    wfPoints:null, wfModeResult:'luma',
    vsPoints:null,
    histR:null, histG:null, histB:null,
    ciePoints:null, diamondPoints:null,
  };

  const $ = id => document.getElementById(id);
  const el = {
    video:$('video'), streamUrl:$('streamUrl'),
    fileInput:$('fileInput'), loadUrlBtn:$('loadUrlBtn'),
    playerState:$('playerState'), videoState:$('videoState'),
    audioState:$('audioState'), corsState:$('corsState'),
    videoDot:$('videoDot'), audioDot:$('audioDot'), corsDot:$('corsDot'),
    sourceBadge:$('sourceBadge'),
    // Media info painel padrão
    metaRes:$('metaRes'), metaResMax:$('metaResMax'), metaFps:$('metaFps'),
    metaFpsStream:$('metaFpsStream'), metaVcodec:$('metaVcodec'),
    metaAcodec:$('metaAcodec'), metaChans:$('metaChans'), metaSr:$('metaSr'),
    metaBitrate:$('metaBitrate'), metaGamma:$('metaGamma'),
    metaAR:$('metaAR'), metaSrc:$('metaSrc'), metaSrcType:$('metaSrcType'),
    metaVR:$('metaVR'), metaHlsVer:$('metaHlsVer'),
    metaHlsLevels:$('metaHlsLevels'), metaHlsSeg:$('metaHlsSeg'),
    metaHlsLatency:$('metaHlsLatency'),
    metricLoudness:$('metricLoudness'), metricLufs:$('metricLufs'),
    // Canvases principais
    waveformCanvas:$('waveformCanvas'), vectorscopeCanvas:$('vectorscopeCanvas'),
    histogramCanvas:$('histogramCanvas'), audioCanvas:$('audioCanvas'),
    phaseCanvas:$('phaseCanvas'), loudnessCanvas:$('loudnessCanvas'),
    cieCanvas:$('cieCanvas'), diamondCanvas:$('diamondCanvas'),
    // Canvases broadcast
    bcWaveformCanvas:$('bc-waveformCanvas'), bcVectorscopeCanvas:$('bc-vectorscopeCanvas'),
    bcHistogramCanvas:$('bc-histogramCanvas'), bcCieCanvas:$('bc-cieCanvas'),
    bcDiamondCanvas:$('bc-diamondCanvas'),
    // Broadcast meta fields
    bcMetaRes:$('bc-metaRes'), bcMetaResMax:$('bc-metaResMax'), bcMetaFps:$('bc-metaFps'),
    bcMetaFpsStream:$('bc-metaFpsStream'), bcMetaVcodec:$('bc-metaVcodec'),
    bcMetaBitrate:$('bc-metaBitrate'), bcMetaAR:$('bc-metaAR'),
    bcMetaGamma:$('bc-metaGamma'), bcMetaVR:$('bc-metaVR'),
    bcMetaAcodec:$('bc-metaAcodec'), bcMetaChans:$('bc-metaChans'), bcMetaSr:$('bc-metaSr'),
    bcMetricLoudness:$('bc-metricLoudness'), bcMetricLufs:$('bc-metricLufs'),
    bcMetaHlsVer:$('bc-metaHlsVer'), bcMetaHlsLevels:$('bc-metaHlsLevels'),
    bcMetaHlsSeg:$('bc-metaHlsSeg'), bcMetaHlsLatency:$('bc-metaHlsLatency'),
    bcPlayerState:$('bc-playerState'), bcCorsDot:$('bc-corsDot'), bcCorsState:$('bc-corsState'),
    bcVideoEl:$('bc-video-el'),
    // Controles
    hlsQualityWrap:$('hlsQualityWrap'), hlsQualitySelect:$('hlsQualitySelect'),
    sliderQuality:$('sliderQuality'), sliderDensity:$('sliderDensity'),
    valQuality:$('valQuality'), valDensity:$('valDensity'),
    wfModeGroup:$('wfModeGroup'), wfNitsBtn:$('wfNitsBtn'),
    vsStdGroup:$('vsStdGroup'), histRangeGroup:$('histRangeGroup'),
    profileGroup:$('profileGroup'), profileDesc:$('profileDesc'),
    broadcastBtn:$('broadcastBtn'), exportFrameBtn:$('exportFrameBtn'),
    mainArea:$('mainArea'),
  };

  const offscreen = document.createElement('canvas');
  const offctx = offscreen.getContext('2d', { willReadFrequently:true });

  function getProfile() { return SIGNAL_PROFILES[state.signalProfile]; }

  // ── Sync meta helper ───────────────────────────────────────────────────────
  // Atualiza par (padrão + broadcast) ao mesmo tempo
  function setMeta(std, bc, val) {
    if (std) std.textContent = val;
    if (bc)  bc.textContent  = val;
  }

  // ── Web Worker ─────────────────────────────────────────────────────────────
  function initWorker() {
    fetch('worker.js')
      .then(r => r.blob())
      .then(blob => {
        state.worker = new Worker(URL.createObjectURL(blob));
        state.worker.onmessage = onWorkerResult;
        state.worker.onerror = e => { console.error('[Jamal Worker]', e.message); state.workerBusy=false; };
      })
      .catch(() => console.error('[Jamal] Falha ao carregar worker.js'));
  }

  function onWorkerResult(e) {
    const { wfPoints,vsPoints,histR,histG,histB,wfLen,vsLen,wfMode,ciePoints,cieLen,diamondPoints,diamondLen } = e.data;
    state.wfPoints     = new Float32Array(wfPoints).subarray(0, wfLen);
    state.wfModeResult = wfMode;
    state.vsPoints     = new Float32Array(vsPoints).subarray(0, vsLen);
    state.histR        = new Uint32Array(histR);
    state.histG        = new Uint32Array(histG);
    state.histB        = new Uint32Array(histB);
    state.ciePoints    = ciePoints ? new Float32Array(ciePoints).subarray(0, cieLen||0) : null;
    state.diamondPoints= diamondPoints ? new Float32Array(diamondPoints).subarray(0, diamondLen||0) : null;
    state.workerBusy   = false;
    if (state.broadcastMode) {
      if (state.modules.waveform)   drawWaveformOn(state.wfPoints, el.bcWaveformCanvas);
      if (state.modules.vector)     drawVectorscopeOn(state.vsPoints, el.bcVectorscopeCanvas);
      if (state.modules.histogram)  drawHistogramOn(state.histR, state.histG, state.histB, el.bcHistogramCanvas);
      if (state.modules.cie)        drawCieOn(state.ciePoints, el.bcCieCanvas);
      if (state.modules.diamond)    drawDiamondOn(state.diamondPoints, el.bcDiamondCanvas);
    } else {
      if (state.modules.waveform)   drawWaveformOn(state.wfPoints, el.waveformCanvas);
      if (state.modules.vector)     drawVectorscopeOn(state.vsPoints, el.vectorscopeCanvas);
      if (state.modules.histogram)  drawHistogramOn(state.histR, state.histG, state.histB, el.histogramCanvas);
      if (state.modules.cie)        drawCieOn(state.ciePoints, el.cieCanvas);
      if (state.modules.diamond)    drawDiamondOn(state.diamondPoints, el.diamondCanvas);
    }
  }

  // ── HiDPI ──────────────────────────────────────────────────────────────────
  const CANVAS_HEIGHTS = {
    waveformCanvas:220, vectorscopeCanvas:220, histogramCanvas:220,
    cieCanvas:220, diamondCanvas:220,
    audioCanvas:180, phaseCanvas:180, loudnessCanvas:84,
    'bc-waveformCanvas':200, 'bc-vectorscopeCanvas':200,
    'bc-histogramCanvas':180, 'bc-cieCanvas':180, 'bc-diamondCanvas':180,
  };
  function initCanvases() {
    const dpr = window.devicePixelRatio || 1;
    Object.entries(CANVAS_HEIGHTS).forEach(([id, cssH]) => {
      const c = $(id); if (!c) return;
      c.style.height = cssH + 'px';
      const cssW = c.parentElement ? c.parentElement.offsetWidth || 400 : 400;
      c.width  = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function getCtx(canvas) { return canvas ? canvas.getContext('2d') : null; }
  function cw(c) { return c.width / (window.devicePixelRatio||1); }
  function ch(c) { return c.height / (window.devicePixelRatio||1); }

  const BG  = '#090b0d';
  const LC  = 'rgba(153,163,173,.8)';
  const GC  = 'rgba(153,163,173,.14)';
  const GC2 = 'rgba(153,163,173,.28)';
  function fillBg(ctx,w,h) { ctx.fillStyle=BG; ctx.fillRect(0,0,w,h); }
  function font(ctx,sz) { ctx.font=`500 ${sz}px Satoshi,system-ui`; }

  // ── WAVEFORM ───────────────────────────────────────────────────────────────
  function drawWaveformGrid(ctx,w,h) {
    const prof = getProfile();
    if (state.wfNits) {
      const refs=prof.nitsRefs, nMax=prof.nitsMax;
      font(ctx,10); ctx.textBaseline='middle';
      refs.forEach((ref,i) => {
        const yn=prof.nitsLog?(ref.v>0?Math.log10(ref.v)/Math.log10(nMax):0):ref.v/nMax;
        const y=h-yn*h;
        ctx.strokeStyle=ref.c; ctx.lineWidth=ref.v===nMax||ref.v===0?1:.7;
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
        ctx.fillStyle=ref.c.replace(/[\d.]+\)$/,'.95)');
        ctx.textAlign='left';
        ctx.fillText(ref.l, 4, y+(i===0?7:i===refs.length-1?-4:0));
      });
    } else {
      [255,192,128,64,0].forEach((lv,i) => {
        const y=h-(lv/255)*h;
        ctx.strokeStyle=(lv===0||lv===128||lv===255)?GC2:GC;
        ctx.lineWidth=(lv===0||lv===128||lv===255)?1:.7;
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
        font(ctx,10); ctx.fillStyle=LC; ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(String(lv), 4, y+(i===0?7:i===4?-4:0));
      });
    }
    ctx.textBaseline='bottom'; ctx.textAlign='center'; ctx.fillStyle=LC; font(ctx,9);
    [0,25,50,75,100].forEach(p=>ctx.fillText(p+'%',(p/100)*w,h-2));
  }

  function drawWaveformLuma(ctx,pts,w,h) {
    ctx.fillStyle='rgba(73,182,193,.22)';
    for (let i=0;i<pts.length;i+=2) ctx.fillRect(Math.round(pts[i]*(w-1)),Math.round((1-pts[i+1])*(h-1)),1,1);
  }
  function drawWaveformRGB(ctx,pts,w,h) {
    const colors=['rgba(255,80,100,.3)','rgba(80,200,80,.3)','rgba(80,140,255,.3)'];
    for (let i=0;i<pts.length;i+=6) for (let c=0;c<3;c++) {
      ctx.fillStyle=colors[c];
      ctx.fillRect(Math.round(pts[i+c*2]*(w-1)),Math.round((1-pts[i+c*2+1])*(h-1)),1,1);
    }
  }
  function drawWaveformYCbCr(ctx,pts,w,h) {
    for (let i=0;i<pts.length;i+=4) {
      ctx.fillStyle='rgba(73,182,193,.28)'; ctx.fillRect(Math.round(pts[i]*(w-1)),Math.round((1-pts[i+1])*(h-1)),1,1);
      ctx.fillStyle='rgba(255,180,84,.28)'; ctx.fillRect(Math.round(pts[i+2]*(w-1)),Math.round((1-pts[i+3])*(h-1)),1,1);
    }
  }

  function drawWaveformOn(pts, canvas) {
    if (!canvas) return;
    const ctx=getCtx(canvas), w=cw(canvas), h=ch(canvas);
    fillBg(ctx,w,h); drawWaveformGrid(ctx,w,h);
    if (!pts||pts.length<2) return;
    const mode=state.wfModeResult||'luma';
    if (mode==='rgb') drawWaveformRGB(ctx,pts,w,h);
    else if (mode==='ycbcr') drawWaveformYCbCr(ctx,pts,w,h);
    else drawWaveformLuma(ctx,pts,w,h);
    font(ctx,9); ctx.fillStyle='rgba(73,182,193,.8)';
    ctx.textAlign='right'; ctx.textBaseline='top';
    ctx.fillText((state.wfNits?getProfile().label+' Nits \u00b7 ':'')+({luma:'Luma',rgb:'RGB Parade',ycbcr:'YCbCr'}[mode]||mode),w-4,4);
  }

  // ── VECTORSCOPE ────────────────────────────────────────────────────────────
  const VS_COLORS=[
    {label:'R',r:255,g:0,b:0},{label:'G',r:0,g:255,b:0},{label:'B',r:0,g:0,b:255},
    {label:'Cy',r:0,g:255,b:255},{label:'Mg',r:255,g:0,b:255},{label:'Ye',r:255,g:255,b:0}
  ];
  function rgbToVS(r,g,b,std) {
    if (std==='bt2020') return {cb:-0.1646*r-0.3354*g+0.5*b,cr:0.5*r-0.4598*g-0.0402*b};
    return {cb:-0.1873*r-0.3127*g+0.5*b,cr:0.5*r-0.4187*g-0.0813*b};
  }
  function drawVectorscopeOn(pts, canvas) {
    if (!canvas) return;
    const ctx=getCtx(canvas), w=cw(canvas), h=ch(canvas);
    const cx=w/2, cy=h/2, radius=Math.min(cx,cy)*.82;
    ctx.fillStyle='rgba(9,11,13,.15)'; ctx.fillRect(0,0,w,h);
    fillBg(ctx,w,h);
    [.25,.5,.75,1].forEach((pct,i)=>{
      ctx.strokeStyle=i===3?GC2:GC; ctx.lineWidth=i===3?1:.7;
      ctx.beginPath(); ctx.arc(cx,cy,radius*pct,0,Math.PI*2); ctx.stroke();
      font(ctx,9); ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(Math.round(pct*100)+'%',cx+radius*pct+8,cy-5);
    });
    ctx.strokeStyle=GC2; ctx.lineWidth=.7;
    ctx.beginPath();
    ctx.moveTo(cx,cy-radius*1.06); ctx.lineTo(cx,cy+radius*1.06);
    ctx.moveTo(cx-radius*1.06,cy); ctx.lineTo(cx+radius*1.06,cy);
    ctx.stroke();
    font(ctx,10); ctx.fillStyle=LC;
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText('Cb\u2192',cx+radius+18,cy+4);
    ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText('Cr\u2191',cx-4,cy-radius-2);
    font(ctx,9); ctx.fillStyle='rgba(73,182,193,.8)';
    ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(state.vsStd.toUpperCase(),4,4);
    VS_COLORS.forEach(({label,r,g,b})=>{
      const {cb,cr}=rgbToVS(r,g,b,state.vsStd);
      const tx=cx+(cb/128)*radius, ty=cy-(cr/128)*radius;
      ctx.beginPath(); ctx.arc(tx,ty,4.5,0,Math.PI*2);
      ctx.strokeStyle=`rgb(${r},${g},${b})`; ctx.lineWidth=2; ctx.stroke();
      font(ctx,9); ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(label,tx,ty-6);
    });
    if (!pts||pts.length<2) return;
    ctx.fillStyle='rgba(73,182,193,.22)';
    for (let i=0;i<pts.length;i+=2) {
      const x=Math.round(cx+pts[i]*radius), y=Math.round(cy-pts[i+1]*radius);
      if (x>=0&&x<w&&y>=0&&y<h) ctx.fillRect(x,y,1,1);
    }
  }

  // ── HISTOGRAMA ─────────────────────────────────────────────────────────────
  function drawHistogramOn(histR, histG, histB, canvas) {
    if (!canvas||!histR) return;
    const ctx=getCtx(canvas), w=cw(canvas), h=ch(canvas);
    fillBg(ctx,w,h);
    const legal=getProfile().histLegal;
    let mx=1;
    for (let i=0;i<256;i++) mx=Math.max(mx,histR[i],histG[i],histB[i]);
    font(ctx,10);
    for (let i=0;i<=4;i++) {
      const y=(h/4)*i;
      ctx.strokeStyle=GC; ctx.lineWidth=.7;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
      ctx.fillStyle=LC; ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.fillText(Math.round((1-i/4)*100)+'%',4,y+(i===0?7:i===4?-4:0));
    }
    [0,64,128,192,255].forEach(v=>{
      const x=(v/255)*w;
      ctx.strokeStyle=GC; ctx.lineWidth=.5;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
      ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText(v,x,h-2);
    });
    if (state.histRange==='legal') {
      const xLo=(legal.lo/255)*w, xHi=(legal.hi/255)*w;
      ctx.fillStyle='rgba(255,180,84,.06)';
      ctx.fillRect(0,0,xLo,h); ctx.fillRect(xHi,0,w-xHi,h);
      ctx.strokeStyle='rgba(255,180,84,.4)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(xLo,0); ctx.lineTo(xLo,h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xHi,0); ctx.lineTo(xHi,h); ctx.stroke();
    }
    const bw=w/256;
    for (let i=0;i<256;i++) {
      const x=i*bw;
      const clip=state.histRange==='legal'&&(i<=legal.lo||i>=legal.hi);
      const a=clip?'.75':'.42';
      ctx.fillStyle=`rgba(255,80,100,${a})`; ctx.fillRect(x,h-14-(histR[i]/mx)*(h-14),Math.max(1,bw),(histR[i]/mx)*(h-14));
      ctx.fillStyle=`rgba(80,200,80,${a})`;  ctx.fillRect(x,h-14-(histG[i]/mx)*(h-14),Math.max(1,bw),(histG[i]/mx)*(h-14));
      ctx.fillStyle=`rgba(80,140,255,${a})`; ctx.fillRect(x,h-14-(histB[i]/mx)*(h-14),Math.max(1,bw),(histB[i]/mx)*(h-14));
    }
    if (state.histRange==='legal') {
      font(ctx,9);
      if (histR[0]+histR[1]+histR[2]>0) { ctx.fillStyle='rgba(255,180,84,.9)'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText('\u25bc clip',2,2); }
      if (histR[253]+histR[254]+histR[255]>0) { ctx.fillStyle='rgba(255,107,129,.9)'; ctx.textAlign='right'; ctx.textBaseline='top'; ctx.fillText('clip \u25bc',w-2,2); }
    }
  }

  // ── CIE CHROMATICITY ───────────────────────────────────────────────────────
  // Locus CIE 1931 xy aproximado (pontos de 360nm a 700nm)
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
    [.1741,.0050] // fecha o locus
  ];

  function drawCieOn(pts, canvas) {
    if (!canvas) return;
    const ctx=getCtx(canvas), w=cw(canvas), h=ch(canvas);
    fillBg(ctx,w,h);
    // margem
    const mx=24, my=20, pw=w-mx*2, ph=h-my*2;
    // fundo gradiente simulando cores espectrais
    const grd=ctx.createLinearGradient(mx,my,mx+pw,my+ph);
    grd.addColorStop(0,'rgba(0,0,200,.18)');
    grd.addColorStop(.3,'rgba(0,200,0,.18)');
    grd.addColorStop(.6,'rgba(200,200,0,.18)');
    grd.addColorStop(1,'rgba(200,0,0,.18)');
    ctx.fillStyle=grd; ctx.fillRect(mx,my,pw,ph);
    // grade
    font(ctx,9);
    [0,.2,.4,.6,.8].forEach(v=>{
      const x=mx+v*pw, y=my+v*ph;
      ctx.strokeStyle=GC; ctx.lineWidth=.6;
      ctx.beginPath(); ctx.moveTo(x,my); ctx.lineTo(x,my+ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx,y); ctx.lineTo(mx+pw,y); ctx.stroke();
      ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(v.toFixed(1),x,my+ph+3);
      ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillText(v.toFixed(1),mx-3,y);
    });
    ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText('x',mx+pw/2,my+ph+12);
    ctx.save(); ctx.translate(mx-16,my+ph/2); ctx.rotate(-Math.PI/2);
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('y',0,0); ctx.restore();
    // locus
    ctx.beginPath();
    CIE_LOCUS.forEach(([lx,ly],i)=>{
      const px=mx+lx*pw/.8, py=my+(1-ly/.9)*ph;
      i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
    });
    ctx.strokeStyle='rgba(255,255,255,.55)'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.06)'; ctx.fill();
    // gamut do perfil
    const prof=getProfile();
    const gPts=prof.gamut;
    if (gPts&&gPts.length>=3) {
      ctx.beginPath();
      gPts.slice(0,3).forEach(({x:gx,gy},i)=>{
        const px=mx+gx*pw/.8, py=my+(1-gy/.9)*ph;
        i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
      });
      // Corrige acesso a y
      ctx.beginPath();
      gPts.slice(0,3).forEach((pt,i)=>{
        const px=mx+pt.x*pw/.8, py=my+(1-pt.y/.9)*ph;
        i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
      });
      ctx.closePath();
      ctx.strokeStyle='rgba(73,182,193,.9)'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.fillStyle='rgba(73,182,193,.06)'; ctx.fill();
      // branco de referência
      const wp=gPts[3]||{x:.3127,y:.3290};
      const wpx=mx+wp.x*pw/.8, wpy=my+(1-wp.y/.9)*ph;
      ctx.beginPath(); ctx.arc(wpx,wpy,3.5,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,.8)'; ctx.fill();
      font(ctx,9); ctx.fillStyle='rgba(255,255,255,.6)';
      ctx.textAlign='left'; ctx.textBaseline='bottom'; ctx.fillText('D65',wpx+5,wpy);
    }
    // pontos do sinal
    if (pts&&pts.length>=2) {
      ctx.fillStyle='rgba(255,200,80,.55)';
      for (let i=0;i<pts.length;i+=2) {
        const px=mx+pts[i]*pw/.8, py=my+(1-pts[i+1]/.9)*ph;
        if (px>=mx&&px<=mx+pw&&py>=my&&py<=my+ph) ctx.fillRect(Math.round(px),Math.round(py),1,1);
      }
    }
    // rótulo
    font(ctx,9); ctx.fillStyle='rgba(73,182,193,.8)';
    ctx.textAlign='right'; ctx.textBaseline='top';
    ctx.fillText('CIE 1931 xy \u00b7 '+prof.gamutLabel,w-4,4);
  }

  // ── DIAMOND / TWIN PEAKS ───────────────────────────────────────────────────
  // Eixos: Y (luma) na vertical, Cr-Cb na horizontal, rotação 45°
  // Diamond = Luma vs (R-Y)+(B-Y), ideal para checar balanço de cores e saturação
  function drawDiamondOn(pts, canvas) {
    if (!canvas) return;
    const ctx=getCtx(canvas), w=cw(canvas), h=ch(canvas);
    fillBg(ctx,w,h);
    const cx=w/2, cy=h/2, sc=Math.min(cx,cy)*.84;
    // contorno do diamante
    ctx.beginPath();
    ctx.moveTo(cx,   cy-sc);
    ctx.lineTo(cx+sc,cy);
    ctx.lineTo(cx,   cy+sc);
    ctx.lineTo(cx-sc,cy);
    ctx.closePath();
    ctx.strokeStyle=GC2; ctx.lineWidth=1.2; ctx.stroke();
    ctx.fillStyle='rgba(73,182,193,.03)'; ctx.fill();
    // linhas de eixo
    ctx.strokeStyle=GC2; ctx.lineWidth=.7;
    ctx.beginPath();
    ctx.moveTo(cx,cy-sc); ctx.lineTo(cx,cy+sc);
    ctx.moveTo(cx-sc,cy); ctx.lineTo(cx+sc,cy);
    // linhas 75%
    const s75=sc*.75;
    ctx.moveTo(cx,cy-s75); ctx.lineTo(cx+s75,cy); ctx.lineTo(cx,cy+s75); ctx.lineTo(cx-s75,cy); ctx.closePath();
    ctx.stroke();
    // labels
    font(ctx,9); ctx.fillStyle=LC;
    ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText('Y\u2191',cx,cy-sc-4);
    ctx.textBaseline='top'; ctx.fillText('Y\u2193',cx,cy+sc+4);
    ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillText('B-Y',cx-sc-4,cy);
    ctx.textAlign='left'; ctx.fillText('R-Y',cx+sc+4,cy);
    font(ctx,9); ctx.fillStyle='rgba(73,182,193,.8)';
    ctx.textAlign='right'; ctx.textBaseline='top'; ctx.fillText('Diamond',w-4,4);
    // pontos
    if (!pts||pts.length<2) return;
    ctx.fillStyle='rgba(73,182,193,.3)';
    for (let i=0;i<pts.length;i+=2) {
      // pts[i]=chrominance position (-1..1), pts[i+1]=luma (0..1)
      const px=Math.round(cx+pts[i]*sc);
      const py=Math.round(cy-pts[i+1]*sc);
      if (px>=0&&px<w&&py>=0&&py<h) ctx.fillRect(px,py,1,1);
    }
  }

  // ── AUDIO SPECTRUM ─────────────────────────────────────────────────────────
  function renderAudioSpectrum() {
    if (!state.modules.spectrum||!state.analyserL) return;
    const ctx=getCtx(el.audioCanvas), w=cw(el.audioCanvas), h=ch(el.audioCanvas);
    const freqBuf=new Uint8Array(state.analyserL.frequencyBinCount);
    state.analyserL.getByteFrequencyData(freqBuf);
    fillBg(ctx,w,h);
    const ny=state.audioContext.sampleRate/2, bc=state.analyserL.frequencyBinCount;
    font(ctx,9);
    [100,500,1000,5000,10000,20000].forEach(f=>{
      if (f>ny) return;
      const x=(Math.round(f/ny*bc)/bc)*w;
      ctx.strokeStyle=GC; ctx.lineWidth=.7;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h-14); ctx.stroke();
      ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(f>=1000?(f/1000)+'k':f,x,h-2);
    });
    [0,-12,-24,-36,-48,-60].forEach(db=>{
      const y=(1-Math.abs(db)/60)*(h-14);
      ctx.strokeStyle=GC; ctx.lineWidth=.5;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
      ctx.fillStyle=LC; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(db+'dB',2,y);
    });
    const bw=w/120, step=Math.max(1,Math.floor(bc/120));
    for (let i=0;i<120;i++) {
      const v=(freqBuf[i*step]||0)/255, barH=v*(h-14);
      ctx.fillStyle=`hsla(${185+v*55},70%,58%,.88)`;
      ctx.fillRect(i*bw,h-14-barH,Math.max(1,bw-1),barH);
    }
  }

  // ── PHASE / GONIÔMETRO ────────────────────────────────────────────────────
  function renderPhase() {
    if (!state.modules.phase||!state.analyserL||!state.analyserR) return;
    const ctx=getCtx(el.phaseCanvas), w=cw(el.phaseCanvas), h=ch(el.phaseCanvas);
    const bufL=new Float32Array(state.analyserL.fftSize), bufR=new Float32Array(state.analyserR.fftSize);
    state.analyserL.getFloatTimeDomainData(bufL); state.analyserR.getFloatTimeDomainData(bufR);
    const cx=w/2, cy=h/2, sc=Math.min(cx,cy)*.84;
    ctx.fillStyle='rgba(9,11,13,.2)'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=GC2; ctx.lineWidth=.7;
    ctx.beginPath(); ctx.arc(cx,cy,sc,0,Math.PI*2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx,cy-sc); ctx.lineTo(cx,cy+sc);
    ctx.moveTo(cx-sc,cy); ctx.lineTo(cx+sc,cy);
    ctx.stroke();
    font(ctx,10); ctx.fillStyle=LC;
    ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText('M',cx,cy-sc-4);
    ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText('S',cx+sc+6,cy);
    ctx.textAlign='right'; ctx.fillText('-S',cx-sc-6,cy);
    ctx.fillStyle='rgba(73,182,193,.28)';
    for (let i=0;i<bufL.length;i++) {
      const px=Math.round(cx+(bufL[i]-bufR[i])*sc), py=Math.round(cy-(bufL[i]+bufR[i])*sc);
      if (px>=0&&px<w&&py>=0&&py<h) ctx.fillRect(px,py,1,1);
    }
  }

  // ── LOUDNESS ───────────────────────────────────────────────────────────────
  function renderLoudness() {
    if (!state.modules.loudness||!state.analyserL) return;
    const ctx=getCtx(el.loudnessCanvas), w=cw(el.loudnessCanvas), h=ch(el.loudnessCanvas);
    const buf=new Float32Array(state.analyserL.fftSize);
    state.analyserL.getFloatTimeDomainData(buf);
    let sum=0; for (let i=0;i<buf.length;i++) sum+=buf[i]*buf[i];
    const rms=Math.sqrt(sum/buf.length);
    const db=rms>0?Math.max(-60,20*Math.log10(rms)):-60;
    state.loudnessHistory.push(db); if (state.loudnessHistory.length>300) state.loudnessHistory.shift();
    state.lufsShortBuf.push(db);   if (state.lufsShortBuf.length>90)  state.lufsShortBuf.shift();
    const lufs=state.lufsShortBuf.reduce((a,v)=>a+v,0)/state.lufsShortBuf.length;
    const dbStr=db.toFixed(1)+' dBFS', lufsStr=lufs.toFixed(1)+' LUFS';
    // atualiza painel padrão e broadcast
    setMeta(el.metricLoudness, el.bcMetricLoudness, dbStr);
    setMeta(el.metricLufs,     el.bcMetricLufs,     lufsStr);
    fillBg(ctx,w,h);
    const refs=[{v:0,l:'0 dBFS',c:'rgba(255,107,129,.75)'},{v:-9,l:'-9',c:'rgba(255,180,84,.6)'},{v:-16,l:'-16 str',c:'rgba(119,178,85,.6)'},{v:-23,l:'-23 R128',c:'rgba(73,182,193,.6)'}];
    font(ctx,9);
    refs.forEach(({v,l,c})=>{
      const y=h*(1-(v+60)/60);
      ctx.strokeStyle=c; ctx.lineWidth=.8;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
      ctx.fillStyle=c.replace(/[\d.]+\)$/,'.95)');
      ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText(l,w-18,y-1);
    });
    ctx.strokeStyle='rgba(255,180,84,.95)'; ctx.lineWidth=1.5; ctx.beginPath();
    state.loudnessHistory.forEach((v,i)=>{
      const x=(i/Math.max(1,state.loudnessHistory.length-1))*w, y=h*(1-(v+60)/60);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }); ctx.stroke();
    const bH=Math.max(1,(db+60)/60*h), bc2=db>-9?'#ff6b81':db>-16?'#ffb454':'#77b255';
    ctx.fillStyle=bc2+'55'; ctx.fillRect(w-14,h-bH,10,bH);
    ctx.fillStyle=bc2;      ctx.fillRect(w-14,h-bH,10,2);
  }

  // ── Loop principal ─────────────────────────────────────────────────────────
  function analysisLoop(ts) {
    const activeVideo = state.broadcastMode ? el.bcVideoEl : el.video;
    if (!activeVideo.videoWidth) { state.rafId=requestAnimationFrame(analysisLoop); return; }
    state.frameCount++;
    if (!state.lastFrameAt) state.lastFrameAt=ts;
    const delta=ts-state.lastFrameAt;
    if (delta>=1000) {
      const fps=Math.round((state.frameCount*1000)/delta);
      setMeta(el.metaFps, el.bcMetaFps, fps+' fps');
      state.frameCount=0; state.lastFrameAt=ts;
    }
    setMeta(el.metaRes, el.bcMetaRes, `${activeVideo.videoWidth}\u00d7${activeVideo.videoHeight}`);
    const hasVideo=state.modules.waveform||state.modules.vector||state.modules.histogram||state.modules.cie||state.modules.diamond;
    if (hasVideo&&!state.workerBusy&&state.worker) {
      const div=Q_DIV[state.quality-1];
      const fw=Math.max(1,Math.round(activeVideo.videoWidth/div));
      const fh=Math.max(1,Math.round(activeVideo.videoHeight/div));
      offscreen.width=fw; offscreen.height=fh;
      offctx.drawImage(activeVideo,0,0,fw,fh);
      try {
        const imgData=offctx.getImageData(0,0,fw,fh);
        state.workerBusy=true;
        state.worker.postMessage(
          {buf:imgData.data.buffer,fw,fh,step:D_STEP[state.density-1],vsStd:state.vsStd,wfMode:state.wfMode},
          [imgData.data.buffer]
        );
      } catch(e) {
        setMeta(el.corsState,el.bcCorsState,'Bloqueado');
        el.corsDot.className='dot err';
        if (el.bcCorsDot) el.bcCorsDot.className='dot err';
        state.workerBusy=false;
      }
    }
    renderAudioSpectrum();
    renderPhase();
    renderLoudness();
    state.rafId=requestAnimationFrame(analysisLoop);
  }

  // ── Áudio graph ───────────────────────────────────────────────────────────
  async function ensureAudioGraph() {
    if (state.audioContext) return;
    const AC=window.AudioContext||window.webkitAudioContext;
    state.audioContext=new AC();
    const srcEl=el.video; // sempre usa o video principal para o grafo de áudio
    state.sourceNode=state.audioContext.createMediaElementSource(srcEl);
    state.splitter=state.audioContext.createChannelSplitter(2);
    state.analyserL=state.audioContext.createAnalyser();
    state.analyserR=state.audioContext.createAnalyser();
    state.analyserL.fftSize=2048; state.analyserR.fftSize=2048;
    state.sourceNode.connect(state.splitter);
    state.splitter.connect(state.analyserL,0); state.splitter.connect(state.analyserR,1);
    const merger=state.audioContext.createChannelMerger(2);
    state.analyserL.connect(merger,0,0); state.analyserR.connect(merger,0,1);
    merger.connect(state.audioContext.destination);
    el.audioState.textContent='Ativo'; el.audioDot.className='dot ok';
    setMeta(el.metaSr, el.bcMetaSr, state.audioContext.sampleRate+' Hz');
    setMeta(el.metaAcodec, el.bcMetaAcodec, 'AAC/PCM (estimado)');
    setMeta(el.metaChans, el.bcMetaChans, 'Estéreo');
  }

  // ── Metadados HLS ──────────────────────────────────────────────────────────
  function updateHlsMetadata() {
    if (!state.hls) return;
    const lvl=state.hls.currentLevel>=0?state.hls.levels[state.hls.currentLevel]:null;
    const maxLvl=state.hls.levels[state.hls.levels.length-1];
    if (maxLvl) {
      setMeta(el.metaResMax,el.bcMetaResMax,`${maxLvl.width}\u00d7${maxLvl.height}`);
      const fr=maxLvl.attrs&&maxLvl.attrs['FRAME-RATE']?parseFloat(maxLvl.attrs['FRAME-RATE']).toFixed(2):'\u2014';
      setMeta(el.metaFpsStream,el.bcMetaFpsStream,fr!=='\u2014'?fr+' fps':'\u2014');
      const vc=maxLvl.attrs&&maxLvl.attrs['CODECS']?maxLvl.attrs['CODECS'].split(',')[0]:'H.264 (HLS)';
      setMeta(el.metaVcodec,el.bcMetaVcodec,vc);
      const vr=maxLvl.attrs&&maxLvl.attrs['VIDEO-RANGE']?maxLvl.attrs['VIDEO-RANGE']:'SDR';
      setMeta(el.metaVR,el.bcMetaVR,vr);
      setMeta(el.metaGamma,el.bcMetaGamma,getProfile().label+' / '+vr);
    }
    if (lvl&&lvl.bitrate) setMeta(el.metaBitrate,el.bcMetaBitrate,(lvl.bitrate/1000).toFixed(0)+' kbps');
    // Manifesto
    const nLevels=state.hls.levels.length;
    setMeta(el.metaHlsLevels,el.bcMetaHlsLevels,nLevels+' rendições');
    if (state.hls.config) setMeta(el.metaHlsVer,el.bcMetaHlsVer,'3+');
    // Latência e duração do segmento (estimativa via config)
    const segDur=state.hls.config&&state.hls.config.fragLoadingMaxRetry?'~'+state.hls.config.maxBufferLength+'s buf':'—';
    setMeta(el.metaHlsSeg,el.bcMetaHlsSeg,segDur);
    // latência: diferença entre live edge e currentTime
    try {
      const lat=state.hls.liveSyncPosition?el.video.currentTime>0?(state.hls.liveSyncPosition-el.video.currentTime).toFixed(1)+'s':'—':'—';
      setMeta(el.metaHlsLatency,el.bcMetaHlsLatency,lat);
    } catch(e){}
  }

  function updateVideoMetadata() {
    const v=el.video;
    if (!v.videoWidth) return;
    const w=v.videoWidth, h=v.videoHeight;
    setMeta(el.metaRes,el.bcMetaRes,`${w}\u00d7${h}`);
    const gcd=(a,b)=>b?gcd(b,a%b):a, g=gcd(w,h);
    setMeta(el.metaAR,el.bcMetaAR,`${w/g}:${h/g}`);
    if (!state.hls) {
      const isBlobTs=v.currentSrc.startsWith('blob:');
      setMeta(el.metaVcodec,el.bcMetaVcodec,isBlobTs?'MPEG-TS (local)':'H.264/AVC');
      setMeta(el.metaGamma,el.bcMetaGamma,getProfile().label+' (provável)');
      setMeta(el.metaVR,el.bcMetaVR,'SDR (estimado)');
      setMeta(el.metaResMax,el.bcMetaResMax,`${w}\u00d7${h}`);
      setMeta(el.metaHlsVer,el.bcMetaHlsVer,'N/A'); setMeta(el.metaHlsLevels,el.bcMetaHlsLevels,'N/A');
      setMeta(el.metaHlsSeg,el.bcMetaHlsSeg,'N/A'); setMeta(el.metaHlsLatency,el.bcMetaHlsLatency,'N/A');
    } else { updateHlsMetadata(); }
    if (state.audioContext) setMeta(el.metaSr,el.bcMetaSr,state.audioContext.sampleRate+' Hz');
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  async function startPlayback() {
    try {
      await ensureAudioGraph();
      if (state.audioContext.state==='suspended') await state.audioContext.resume();
      await el.video.play();
      // broadcast video espelha o mesmo srcObject
      if (el.bcVideoEl) { el.bcVideoEl.src=el.video.src; el.bcVideoEl.muted=true; el.bcVideoEl.play().catch(()=>{}); }
      el.playerState.textContent='Reproduzindo';
      setMeta(el.playerState,el.bcPlayerState,'Reproduzindo');
      el.videoState.textContent='Online'; el.videoDot.className='dot ok';
      cancelAnimationFrame(state.rafId);
      state.lastFrameAt=0; state.frameCount=0; state.workerBusy=false;
      setTimeout(()=>{ initCanvases(); updateVideoMetadata(); },250);
      state.rafId=requestAnimationFrame(analysisLoop);
    } catch(e) { el.playerState.textContent='Falha no play'; }
  }

  // ── HLS levels ─────────────────────────────────────────────────────────────
  function populateHlsQuality() {
    if (!state.hls||!state.hls.levels.length) return;
    el.hlsQualitySelect.innerHTML='';
    const auto=document.createElement('option'); auto.value='-1'; auto.textContent='Auto (ABR)';
    el.hlsQualitySelect.appendChild(auto);
    state.hls.levels.forEach((lvl,i)=>{
      const opt=document.createElement('option'); opt.value=String(i);
      const fr=lvl.attrs&&lvl.attrs['FRAME-RATE']?`@${parseFloat(lvl.attrs['FRAME-RATE']).toFixed(0)}fps`:'fps';
      const vr=lvl.attrs&&lvl.attrs['VIDEO-RANGE']?` [${lvl.attrs['VIDEO-RANGE']}]`:'';
      opt.textContent=`${lvl.width}\u00d7${lvl.height} \u2022 ${(lvl.bitrate/1000).toFixed(0)}k ${fr}${vr}`;
      el.hlsQualitySelect.appendChild(opt);
    });
    el.hlsQualityWrap.classList.add('visible');
    el.hlsQualitySelect.addEventListener('change',()=>{
      const v=parseInt(el.hlsQualitySelect.value);
      state.hls.currentLevel=v; if (v>=0) state.hls.loadLevel=v;
      setTimeout(updateHlsMetadata,500);
    });
  }

  // ── Load URL ───────────────────────────────────────────────────────────────
  function destroyHls() { if (state.hls) { state.hls.destroy(); state.hls=null; } }

  // Detecta se URL deve ser tratada como HLS mesmo sem extensão .m3u8
  // (JWT na URL, parâmetros de token, ou redirecionamento para playlist)
  function isHlsUrl(url) {
    if (!url) return false;
    const lower=url.toLowerCase();
    // extensão explícita
    if (lower.includes('.m3u8')) return true;
    // playlist detectada por path
    if (lower.includes('playlist') && (lower.includes('.m3u8') || lower.includes('m3u8'))) return true;
    // URL com JWT (padrão base64url após /j/ ou ?token=)
    if (/\/j\/ey[A-Za-z0-9_-]{10,}/.test(url)) return true;
    // manifest na query
    if (lower.includes('manifest')&&lower.includes('m3u8')) return true;
    return false;
  }

  function loadFromUrl() {
    const url=el.streamUrl.value.trim(); if (!url) return;
    destroyHls();
    el.hlsQualityWrap.classList.remove('visible');
    el.video.pause(); el.video.removeAttribute('src'); el.video.load();
    state.activeSource=url;
    const srcType=isHlsUrl(url)?'HLS (stream)':url.includes('.ts')||url.includes('.mts')?'MPEG-TS':'LINK';
    el.sourceBadge.textContent=srcType;
    setMeta(el.metaSrcType,null,srcType);
    el.playerState.textContent='Carregando';
    setMeta(el.metaSrc,null,url.length>60?url.slice(0,60)+'\u2026':url);
    el.corsDot.className='dot warn'; setMeta(el.corsState,el.bcCorsState,'Verificando...');
    if (window.Hls&&Hls.isSupported()&&isHlsUrl(url)) {
      state.hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});
      state.hls.loadSource(url);
      state.hls.attachMedia(el.video);
      state.hls.on(Hls.Events.MANIFEST_PARSED,()=>{ populateHlsQuality(); startPlayback(); });
      state.hls.on(Hls.Events.ERROR,(_,d)=>{
        if (d.fatal) {
          const msg=d.type==='networkError'?'Erro de rede/CORS':d.type==='mediaError'?'Erro de mídia':'Erro HLS';
          el.playerState.textContent=msg; el.videoDot.className='dot err';
          console.error('[Jamal HLS]',d);
        }
      });
      setMeta(el.corsState,el.bcCorsState,'HLS.js ativo'); el.corsDot.className='dot ok';
    } else {
      // Tenta direto (MPEG-TS via blob ou link simples)
      el.video.crossOrigin='anonymous';
      el.video.src=url;
      el.video.addEventListener('loadedmetadata',startPlayback,{once:true});
      el.video.addEventListener('error',()=>{
        // Último recurso: tenta via HLS.js mesmo assim
        if (window.Hls&&Hls.isSupported()) {
          console.warn('[Jamal] Fallback para HLS.js após erro nativo');
          destroyHls();
          state.hls=new Hls({enableWorker:true});
          state.hls.loadSource(url); state.hls.attachMedia(el.video);
          state.hls.on(Hls.Events.MANIFEST_PARSED,()=>{ populateHlsQuality(); startPlayback(); });
        }
      },{once:true});
    }
  }

  function loadFromFile(file) {
    if (!file) return;
    destroyHls(); el.hlsQualityWrap.classList.remove('visible');
    const url=URL.createObjectURL(file);
    state.activeSource=file.name;
    const isTs=file.name.toLowerCase().endsWith('.ts')||file.name.toLowerCase().endsWith('.mts');
    el.sourceBadge.textContent=isTs?'MPEG-TS':'Arquivo';
    setMeta(el.metaSrcType,null,isTs?'MPEG-TS (arquivo)':'Arquivo local');
    el.playerState.textContent='Arquivo local'; setMeta(el.metaSrc,null,file.name);
    if (isTs&&window.Hls&&Hls.isSupported()) {
      // .ts local: remux via HLS.js
      state.hls=new Hls({enableWorker:true});
      state.hls.loadSource(url); state.hls.attachMedia(el.video);
      state.hls.on(Hls.Events.MANIFEST_PARSED,()=>startPlayback());
      state.hls.on(Hls.Events.ERROR,(_,d)=>{ if (d.fatal) el.playerState.textContent='Erro TS remux'; });
    } else {
      el.video.crossOrigin='anonymous';
      el.video.src=url;
      el.video.addEventListener('loadedmetadata',startPlayback,{once:true});
    }
  }

  // ── CORS check ─────────────────────────────────────────────────────────────
  function validateCanvasRead() {
    try {
      offscreen.width=16; offscreen.height=16;
      offctx.drawImage(el.video,0,0,16,16); offctx.getImageData(0,0,1,1);
      setMeta(el.corsState,el.bcCorsState,'Leitura ok');
      el.corsDot.className='dot ok'; if (el.bcCorsDot) el.bcCorsDot.className='dot ok';
    } catch(e) {
      setMeta(el.corsState,el.bcCorsState,'Bloqueado');
      el.corsDot.className='dot err'; if (el.bcCorsDot) el.bcCorsDot.className='dot err';
    }
  }

  // ── Export frame ───────────────────────────────────────────────────────────
  function exportFrame() {
    if (!el.video.videoWidth) return;
    const c=document.createElement('canvas');
    c.width=el.video.videoWidth; c.height=el.video.videoHeight;
    c.getContext('2d').drawImage(el.video,0,0);
    try { const a=document.createElement('a'); a.download=`frame_${Date.now()}.png`; a.href=c.toDataURL('image/png'); a.click(); }
    catch(e) { alert('Export bloqueado por CORS.'); }
  }

  // ── Broadcast toggle ───────────────────────────────────────────────────────
  function initBroadcastBtn() {
    el.broadcastBtn.addEventListener('click',()=>{
      state.broadcastMode=!state.broadcastMode;
      el.mainArea.classList.toggle('broadcast-mode',state.broadcastMode);
      el.broadcastBtn.classList.toggle('active',state.broadcastMode);
      // sincroniza vídeo broadcast
      if (state.broadcastMode&&el.bcVideoEl&&el.video.src) {
        el.bcVideoEl.src=el.video.src; el.bcVideoEl.muted=true; el.bcVideoEl.play().catch(()=>{});
        el.bcVideoEl.currentTime=el.video.currentTime;
      }
      setTimeout(initCanvases,80);
    });
  }

  // ── Perfil de sinal ────────────────────────────────────────────────────────
  function initProfileButtons() {
    el.profileGroup.querySelectorAll('.profile-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        el.profileGroup.querySelectorAll('.profile-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); state.signalProfile=btn.dataset.profile;
        const prof=getProfile(); el.profileDesc.textContent=prof.desc;
        state.vsStd=prof.vsStd;
        el.vsStdGroup.querySelectorAll('.scope-btn').forEach(b=>b.classList.toggle('active',b.dataset.vsstd===prof.vsStd));
        updateVideoMetadata();
      });
    });
  }

  // ── Module toggles ─────────────────────────────────────────────────────────
  function initModuleToggles() {
    const map={
      'mod-waveform':'waveform','mod-vector':'vector','mod-histogram':'histogram',
      'mod-cie':'cie','mod-diamond':'diamond',
      'mod-spectrum':'spectrum','mod-phase':'phase','mod-loudness':'loudness',
    };
    Object.entries(map).forEach(([id,key])=>{
      const inp=$(id); if (!inp) return;
      const card=$('card-'+key);
      inp.addEventListener('change',()=>{
        state.modules[key]=inp.checked;
        if (card) card.classList.toggle('scope-card-hidden',!inp.checked);
        if (!inp.checked&&card) {
          const c=card.querySelector('canvas');
          if (c) { const ctx=c.getContext('2d'); ctx.fillStyle=BG; ctx.fillRect(0,0,c.width,c.height); }
        }
      });
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active'); $('tab-'+btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ── Sliders ────────────────────────────────────────────────────────────────
  function initSliders() {
    el.sliderQuality.addEventListener('input',()=>{ state.quality=parseInt(el.sliderQuality.value); el.valQuality.textContent=state.quality; });
    el.sliderDensity.addEventListener('input',()=>{ state.density=parseInt(el.sliderDensity.value); el.valDensity.textContent=state.density; });
  }

  // ── Scope buttons ──────────────────────────────────────────────────────────
  function initScopeButtons() {
    el.wfModeGroup.querySelectorAll('.scope-btn[data-wfmode]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        el.wfModeGroup.querySelectorAll('.scope-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); state.wfMode=btn.dataset.wfmode;
      });
    });
    el.wfNitsBtn.addEventListener('click',()=>{ state.wfNits=!state.wfNits; el.wfNitsBtn.classList.toggle('active',state.wfNits); });
    el.vsStdGroup.querySelectorAll('.scope-btn[data-vsstd]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        el.vsStdGroup.querySelectorAll('.scope-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); state.vsStd=btn.dataset.vsstd;
      });
    });
    el.histRangeGroup.querySelectorAll('.scope-btn[data-histrange]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        el.histRangeGroup.querySelectorAll('.scope-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); state.histRange=btn.dataset.histrange;
      });
    });
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  function initTheme() {
    const btn=document.querySelector('[data-theme-toggle]'), html=document.documentElement;
    let mode=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
    html.setAttribute('data-theme',mode);
    btn.addEventListener('click',()=>{ mode=html.getAttribute('data-theme')==='dark'?'light':'dark'; html.setAttribute('data-theme',mode); });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  el.loadUrlBtn.addEventListener('click',loadFromUrl);
  el.streamUrl.addEventListener('keydown',e=>e.key==='Enter'&&loadFromUrl());
  el.fileInput.addEventListener('change',e=>loadFromFile(e.target.files?.[0]));
  el.video.addEventListener('loadeddata',validateCanvasRead);
  el.video.addEventListener('pause',()=>{ el.playerState.textContent='Pausado'; setMeta(el.playerState,el.bcPlayerState,'Pausado'); });
  el.video.addEventListener('error',()=>{
    el.playerState.textContent='Erro de mídia'; el.videoState.textContent='Falha'; el.videoDot.className='dot err';
    setMeta(el.playerState,el.bcPlayerState,'Erro de mídia');
  });
  el.exportFrameBtn.addEventListener('click',exportFrame);

  // ── Boot ───────────────────────────────────────────────────────────────────
  initTheme();
  initTabs();
  initModuleToggles();
  initSliders();
  initScopeButtons();
  initProfileButtons();
  initBroadcastBtn();
  initWorker();
  requestAnimationFrame(()=>initCanvases());
  window.addEventListener('resize',()=>initCanvases());
})();
