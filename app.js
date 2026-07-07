(() => {
  const VERSION = '1.4';
  console.log(
    `%c Jamal A/V %c v${VERSION} `,
    'background:#49b6c1;color:#101214;font-weight:900;padding:2px 0;border-radius:3px 0 0 3px',
    'background:#1a3438;color:#49b6c1;font-weight:700;padding:2px 4px;border-radius:0 3px 3px 0'
  );

  const Q_DIV  = [8, 4, 2, 1.5, 1];
  const D_STEP = [8, 4, 2, 1, 1];

  const state = {
    hls: null,
    audioContext: null, analyserL: null, analyserR: null,
    splitter: null, sourceNode: null,
    rafId: null,
    lastFrameAt: 0, frameCount: 0,
    activeSource: null,
    loudnessHistory: [], lufsShortBuf: [],
    worker: null, workerBusy: false,
    quality: 3, density: 3,
    vsStd: 'bt709',
    wfMode: 'luma',
    wfNits: false,
    modules: {
      waveform: true, vector: true, histogram: true,
      spectrum: true, phase: true, loudness: true
    },
    wfPoints: null, wfModeResult: 'luma',
    vsPoints: null,
    histR: null, histG: null, histB: null,
  };

  const $ = id => document.getElementById(id);
  const el = {
    video: $('video'), streamUrl: $('streamUrl'), sourceType: $('sourceType'),
    fileInput: $('fileInput'), loadUrlBtn: $('loadUrlBtn'),
    playerState: $('playerState'), videoState: $('videoState'),
    audioState: $('audioState'), corsState: $('corsState'),
    videoDot: $('videoDot'), audioDot: $('audioDot'), corsDot: $('corsDot'),
    sourceBadge: $('sourceBadge'),
    metricFps: $('metricFps'), metricResolution: $('metricResolution'),
    metricLoudness: $('metricLoudness'), metricLufs: $('metricLufs'),
    waveformCanvas: $('waveformCanvas'), vectorscopeCanvas: $('vectorscopeCanvas'),
    histogramCanvas: $('histogramCanvas'), audioCanvas: $('audioCanvas'),
    phaseCanvas: $('phaseCanvas'), loudnessCanvas: $('loudnessCanvas'),
    hlsQualityWrap: $('hlsQualityWrap'), hlsQualitySelect: $('hlsQualitySelect'),
    sliderQuality: $('sliderQuality'), sliderDensity: $('sliderDensity'),
    valQuality: $('valQuality'), valDensity: $('valDensity'),
    wfModeGroup: $('wfModeGroup'), wfNitsBtn: $('wfNitsBtn'),
    vsStdGroup: $('vsStdGroup'),
    metaRes: $('metaRes'), metaResMax: $('metaResMax'), metaFps: $('metaFps'),
    metaFpsStream: $('metaFpsStream'), metaVcodec: $('metaVcodec'),
    metaAcodec: $('metaAcodec'), metaChans: $('metaChans'), metaSr: $('metaSr'),
    metaBitrate: $('metaBitrate'), metaGamma: $('metaGamma'),
    metaAR: $('metaAR'), metaSrc: $('metaSrc'),
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
        state.worker.onerror = (e) => {
          console.error('[Jamal Worker] Erro:', e.message);
          state.workerBusy = false;
        };
      })
      .catch(() => {
        console.error('[Jamal] Falha ao carregar worker.js');
      });
  }

  function onWorkerResult(e) {
    const { wfPoints, vsPoints, histR, histG, histB, wfLen, vsLen, wfMode } = e.data;
    state.wfPoints = new Float32Array(wfPoints).subarray(0, wfLen);
    state.wfModeResult = wfMode;
    state.vsPoints = new Float32Array(vsPoints).subarray(0, vsLen);
    state.histR    = new Uint32Array(histR);
    state.histG    = new Uint32Array(histG);
    state.histB    = new Uint32Array(histB);
    state.workerBusy = false;
    const dpr = window.devicePixelRatio || 1;
    if (state.modules.waveform)
      drawWaveform(state.wfPoints, el.waveformCanvas.width/dpr, el.waveformCanvas.height/dpr);
    if (state.modules.vector)
      drawVectorscope(state.vsPoints, el.vectorscopeCanvas.width/dpr, el.vectorscopeCanvas.height/dpr);
    if (state.modules.histogram)
      drawHistogram(state.histR, state.histG, state.histB, el.histogramCanvas.width/dpr, el.histogramCanvas.height/dpr);
  }

  // ── HiDPI ──────────────────────────────────────────────────────────────────
  const CANVAS_HEIGHTS = {
    waveformCanvas: 220, vectorscopeCanvas: 220, histogramCanvas: 220,
    audioCanvas: 180, phaseCanvas: 180, loudnessCanvas: 84
  };
  function initCanvases() {
    const dpr = window.devicePixelRatio || 1;
    Object.entries(CANVAS_HEIGHTS).forEach(([id, cssH]) => {
      const c = $(id);
      if (!c) return;
      c.style.height = cssH + 'px';
      const cssW = c.parentElement ? c.parentElement.offsetWidth || 400 : 400;
      c.width  = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function getCtx(canvas) { return canvas.getContext('2d'); }
  function cw(c) { return c.width / (window.devicePixelRatio||1); }
  function ch(c) { return c.height / (window.devicePixelRatio||1); }

  const BG  = '#090b0d';
  const LC  = 'rgba(153,163,173,.8)';
  const GC  = 'rgba(153,163,173,.14)';
  const GC2 = 'rgba(153,163,173,.28)';
  function fillBg(ctx,w,h){ ctx.fillStyle=BG; ctx.fillRect(0,0,w,h); }
  function font(ctx,sz){ ctx.font = `500 ${sz}px Satoshi,system-ui`; }

  // ── WAVEFORM ───────────────────────────────────────────────────────────────
  function drawWaveformGrid(ctx, w, h) {
    const levels = state.wfNits ? [100,75,50,25,0] : [255,192,128,64,0];
    const maxVal  = state.wfNits ? 100 : 255;
    font(ctx,10); ctx.textBaseline='middle';
    levels.forEach((lv, i) => {
      const y = h - (lv/maxVal)*h;
      ctx.strokeStyle = (lv===0||lv===maxVal/2||lv===maxVal) ? GC2 : GC;
      ctx.lineWidth   = (lv===0||lv===maxVal/2||lv===maxVal) ? 1 : .7;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
      ctx.fillStyle = LC; ctx.textAlign='left';
      const label = state.wfNits ? lv+' nit' : String(lv);
      ctx.fillText(label, 4, y+(i===0?7:i===levels.length-1?-4:0));
    });
    ctx.textBaseline='bottom'; ctx.textAlign='center'; ctx.fillStyle=LC;
    [0,25,50,75,100].forEach(p => {
      ctx.fillText(p+'%', (p/100)*w, h-2);
    });
  }

  function drawWaveformLuma(ctx, pts, w, h) {
    ctx.fillStyle = 'rgba(73,182,193,.22)';
    for (let i=0; i<pts.length; i+=2) {
      const px = Math.round(pts[i] * (w-1));
      const py = Math.round((1-pts[i+1]) * (h-1));
      ctx.fillRect(px, py, 1, 1);
    }
  }

  function drawWaveformRGB(ctx, pts, w, h) {
    const colors = ['rgba(255,80,100,.3)','rgba(80,200,80,.3)','rgba(80,140,255,.3)'];
    for (let i=0; i<pts.length; i+=6) {
      for (let c=0; c<3; c++) {
        const xn  = pts[i + c*2];
        const val = pts[i + c*2 + 1];
        const px  = Math.round(xn * (w-1));
        const py  = Math.round((1-val) * (h-1));
        ctx.fillStyle = colors[c];
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  function drawWaveformYCbCr(ctx, pts, w, h) {
    const cY  = 'rgba(73,182,193,.28)';
    const cCb = 'rgba(255,180,84,.28)';
    for (let i=0; i<pts.length; i+=4) {
      const xn = pts[i],   yv = pts[i+1];
      const xn2= pts[i+2], cb = pts[i+3];
      ctx.fillStyle = cY;
      ctx.fillRect(Math.round(xn*(w-1)), Math.round((1-yv)*(h-1)), 1, 1);
      ctx.fillStyle = cCb;
      ctx.fillRect(Math.round(xn2*(w-1)), Math.round((1-cb)*(h-1)), 1, 1);
    }
  }

  function drawWaveform(pts, w, h) {
    const ctx = getCtx(el.waveformCanvas);
    fillBg(ctx,w,h);
    drawWaveformGrid(ctx,w,h);
    if (!pts || pts.length < 2) return;
    const mode = state.wfModeResult || 'luma';
    if (mode === 'rgb')        drawWaveformRGB(ctx, pts, w, h);
    else if (mode === 'ycbcr') drawWaveformYCbCr(ctx, pts, w, h);
    else                       drawWaveformLuma(ctx, pts, w, h);
    font(ctx,9); ctx.fillStyle='rgba(73,182,193,.8)';
    ctx.textAlign='right'; ctx.textBaseline='top';
    const label = {luma:'Luma',rgb:'RGB Parade',ycbcr:'YCbCr'}[mode]||mode;
    ctx.fillText((state.wfNits?'Nits · ':'')+label, w-4, 4);
  }

  // ── VECTORSCOPE ────────────────────────────────────────────────────────────
  const VS_COLORS = [
    {label:'R',r:255,g:0,b:0},{label:'G',r:0,g:255,b:0},{label:'B',r:0,g:0,b:255},
    {label:'Cy',r:0,g:255,b:255},{label:'Mg',r:255,g:0,b:255},{label:'Ye',r:255,g:255,b:0}
  ];
  function rgbToVS(r,g,b,std){
    if (std==='bt2020') return { cb: -0.1646*r-0.3354*g+0.5*b, cr: 0.5*r-0.4598*g-0.0402*b };
    return { cb: -0.1873*r-0.3127*g+0.5*b, cr: 0.5*r-0.4187*g-0.0813*b };
  }

  function drawVectorscopeBg(ctx, cx, cy, radius) {
    fillBg(ctx, cx*2, cy*2);
    [.25,.5,.75,1].forEach((pct,i)=>{
      ctx.strokeStyle = i===3?GC2:GC; ctx.lineWidth=i===3?1:.7;
      ctx.beginPath(); ctx.arc(cx,cy,radius*pct,0,Math.PI*2); ctx.stroke();
      font(ctx,9); ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(Math.round(pct*100)+'%', cx+radius*pct+8, cy-5);
    });
    ctx.strokeStyle=GC2; ctx.lineWidth=.7;
    ctx.beginPath();
    ctx.moveTo(cx,cy-radius*1.06); ctx.lineTo(cx,cy+radius*1.06);
    ctx.moveTo(cx-radius*1.06,cy); ctx.lineTo(cx+radius*1.06,cy);
    ctx.stroke();
    font(ctx,10); ctx.fillStyle=LC;
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText('Cb\u2192', cx+radius+18, cy+4);
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText('Cr\u2191', cx-4, cy-radius-2);
    font(ctx,9); ctx.fillStyle='rgba(73,182,193,.8)';
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(state.vsStd.toUpperCase(), 4, 4);
    VS_COLORS.forEach(({label,r,g,b})=>{
      const {cb,cr}=rgbToVS(r,g,b,state.vsStd);
      const tx=cx+(cb/128)*radius, ty=cy-(cr/128)*radius;
      ctx.beginPath(); ctx.arc(tx,ty,4.5,0,Math.PI*2);
      ctx.strokeStyle=`rgb(${r},${g},${b})`; ctx.lineWidth=2; ctx.stroke();
      font(ctx,9); ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(label,tx,ty-6);
    });
  }

  function drawVectorscope(pts, w, h) {
    const ctx = getCtx(el.vectorscopeCanvas);
    const cx=w/2, cy=h/2;
    const radius = Math.min(cx,cy)*.82;
    ctx.fillStyle='rgba(9,11,13,.15)';
    ctx.fillRect(0,0,w,h);
    drawVectorscopeBg(ctx,cx,cy,radius);
    if (!pts || pts.length<2) return;
    ctx.fillStyle='rgba(73,182,193,.22)';
    for (let i=0;i<pts.length;i+=2){
      const x=Math.round(cx+pts[i]*radius);
      const y=Math.round(cy-pts[i+1]*radius);
      if (x>=0&&x<w&&y>=0&&y<h) ctx.fillRect(x,y,1,1);
    }
  }

  // ── HISTOGRAMA ─────────────────────────────────────────────────────────────
  function drawHistogram(histR,histG,histB,w,h){
    const ctx=getCtx(el.histogramCanvas);
    fillBg(ctx,w,h);
    let mx=1;
    for(let i=0;i<256;i++) mx=Math.max(mx,histR[i],histG[i],histB[i]);
    font(ctx,10);
    for(let i=0;i<=4;i++){
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
      ctx.fillStyle=LC; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(v,x,h-2);
    });
    const bw=w/256;
    for(let i=0;i<256;i++){
      const x=i*bw;
      ctx.fillStyle='rgba(255,80,100,.42)'; ctx.fillRect(x,h-14-(histR[i]/mx)*(h-14),Math.max(1,bw),(histR[i]/mx)*(h-14));
      ctx.fillStyle='rgba(80,200,80,.42)';  ctx.fillRect(x,h-14-(histG[i]/mx)*(h-14),Math.max(1,bw),(histG[i]/mx)*(h-14));
      ctx.fillStyle='rgba(80,140,255,.42)'; ctx.fillRect(x,h-14-(histB[i]/mx)*(h-14),Math.max(1,bw),(histB[i]/mx)*(h-14));
    }
  }

  // ── AUDIO SPECTRUM ─────────────────────────────────────────────────────────
  function renderAudioSpectrum(){
    if(!state.modules.spectrum||!state.analyserL)return;
    const ctx=getCtx(el.audioCanvas);
    const w=cw(el.audioCanvas), h=ch(el.audioCanvas);
    const freqBuf=new Uint8Array(state.analyserL.frequencyBinCount);
    state.analyserL.getByteFrequencyData(freqBuf);
    fillBg(ctx,w,h);
    const sr=state.audioContext.sampleRate, ny=sr/2;
    const bc=state.analyserL.frequencyBinCount;
    font(ctx,9);
    [100,500,1000,5000,10000,20000].forEach(f=>{
      if(f>ny)return;
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
      ctx.fillStyle=LC; ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.fillText(db+'dB',2,y);
    });
    const bw=w/120, step=Math.max(1,Math.floor(bc/120));
    for(let i=0;i<120;i++){
      const v=(freqBuf[i*step]||0)/255;
      const barH=v*(h-14);
      ctx.fillStyle=`hsla(${185+v*55},70%,58%,.88)`;
      ctx.fillRect(i*bw,h-14-barH,Math.max(1,bw-1),barH);
    }
  }

  // ── PHASE / GONIÔMETRO ─────────────────────────────────────────────────────
  function renderPhase(){
    if(!state.modules.phase||!state.analyserL||!state.analyserR)return;
    const ctx=getCtx(el.phaseCanvas);
    const w=cw(el.phaseCanvas), h=ch(el.phaseCanvas);
    const bufL=new Float32Array(state.analyserL.fftSize);
    const bufR=new Float32Array(state.analyserR.fftSize);
    state.analyserL.getFloatTimeDomainData(bufL);
    state.analyserR.getFloatTimeDomainData(bufR);
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
    ctx.textAlign='left';  ctx.textBaseline='middle';  ctx.fillText('S',cx+sc+6,cy);
    ctx.textAlign='right'; ctx.fillText('-S',cx-sc-6,cy);
    ctx.fillStyle='rgba(73,182,193,.28)';
    for(let i=0;i<bufL.length;i++){
      const mid=(bufL[i]+bufR[i])*sc;
      const side=(bufL[i]-bufR[i])*sc;
      const px=Math.round(cx+side), py=Math.round(cy-mid);
      if(px>=0&&px<w&&py>=0&&py<h) ctx.fillRect(px,py,1,1);
    }
  }

  // ── LOUDNESS ───────────────────────────────────────────────────────────────
  function renderLoudness(){
    if(!state.modules.loudness||!state.analyserL)return;
    const ctx=getCtx(el.loudnessCanvas);
    const w=cw(el.loudnessCanvas), h=ch(el.loudnessCanvas);
    const buf=new Float32Array(state.analyserL.fftSize);
    state.analyserL.getFloatTimeDomainData(buf);
    let sum=0; for(let i=0;i<buf.length;i++) sum+=buf[i]*buf[i];
    const rms=Math.sqrt(sum/buf.length);
    const db=rms>0?Math.max(-60,20*Math.log10(rms)):-60;
    state.loudnessHistory.push(db);
    if(state.loudnessHistory.length>300) state.loudnessHistory.shift();
    state.lufsShortBuf.push(db);
    if(state.lufsShortBuf.length>90) state.lufsShortBuf.shift();
    const lufs=state.lufsShortBuf.reduce((a,v)=>a+v,0)/state.lufsShortBuf.length;
    el.metricLoudness.textContent=db.toFixed(1)+' dBFS';
    el.metricLufs.textContent=lufs.toFixed(1)+' LUFS';
    fillBg(ctx,w,h);
    const refs=[
      {v:0,   l:'0 dBFS',    c:'rgba(255,107,129,.75)'},
      {v:-9,  l:'-9',        c:'rgba(255,180,84,.6)'},
      {v:-16, l:'-16 (str)', c:'rgba(119,178,85,.6)'},
      {v:-23, l:'-23 R128',  c:'rgba(73,182,193,.6)'},
    ];
    font(ctx,9);
    refs.forEach(({v,l,c})=>{
      const y=h*(1-(v+60)/60);
      ctx.strokeStyle=c; ctx.lineWidth=.8;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
      ctx.fillStyle=c.replace('.6','.95').replace('.75','.95');
      ctx.textAlign='right'; ctx.textBaseline='bottom';
      ctx.fillText(l,w-18,y-1);
    });
    ctx.strokeStyle='rgba(255,180,84,.95)'; ctx.lineWidth=1.5;
    ctx.beginPath();
    state.loudnessHistory.forEach((v,i)=>{
      const x=(i/Math.max(1,state.loudnessHistory.length-1))*w;
      const y=h*(1-(v+60)/60);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }); ctx.stroke();
    const bH=Math.max(1,(db+60)/60*h);
    const bc2=db>-9?'#ff6b81':db>-16?'#ffb454':'#77b255';
    ctx.fillStyle=bc2+'55'; ctx.fillRect(w-14,h-bH,10,bH);
    ctx.fillStyle=bc2;      ctx.fillRect(w-14,h-bH,10,2);
  }

  // ── Loop principal ─────────────────────────────────────────────────────────
  function analysisLoop(ts) {
    if (!el.video.videoWidth) { state.rafId=requestAnimationFrame(analysisLoop); return; }
    state.frameCount++;
    if (!state.lastFrameAt) state.lastFrameAt=ts;
    const delta=ts-state.lastFrameAt;
    if (delta>=1000) {
      const fps=Math.round((state.frameCount*1000)/delta);
      el.metricFps.textContent=fps;
      el.metaFps.textContent=fps+' fps';
      state.frameCount=0; state.lastFrameAt=ts;
    }
    el.metricResolution.textContent=`${el.video.videoWidth}\u00d7${el.video.videoHeight}`;
    el.metaRes.textContent=`${el.video.videoWidth}\u00d7${el.video.videoHeight}`;
    const hasVideo = state.modules.waveform||state.modules.vector||state.modules.histogram;
    if (hasVideo && !state.workerBusy && state.worker) {
      const div = Q_DIV[state.quality-1];
      const fw  = Math.max(1, Math.round(el.video.videoWidth/div));
      const fh  = Math.max(1, Math.round(el.video.videoHeight/div));
      offscreen.width=fw; offscreen.height=fh;
      offctx.drawImage(el.video,0,0,fw,fh);
      try {
        const imgData = offctx.getImageData(0,0,fw,fh);
        state.workerBusy=true;
        state.worker.postMessage({
          buf: imgData.data.buffer, fw, fh,
          step: D_STEP[state.density-1],
          vsStd: state.vsStd,
          wfMode: state.wfMode
        }, [imgData.data.buffer]);
      } catch(e) {
        el.corsState.textContent='Bloqueado'; el.corsDot.className='dot err';
        state.workerBusy=false;
      }
    }
    renderAudioSpectrum();
    renderPhase();
    renderLoudness();
    state.rafId=requestAnimationFrame(analysisLoop);
  }

  // ── Áudio graph ────────────────────────────────────────────────────────────
  async function ensureAudioGraph() {
    if (state.audioContext) return;
    const AC=window.AudioContext||window.webkitAudioContext;
    state.audioContext=new AC();
    state.sourceNode=state.audioContext.createMediaElementSource(el.video);
    state.splitter=state.audioContext.createChannelSplitter(2);
    state.analyserL=state.audioContext.createAnalyser();
    state.analyserR=state.audioContext.createAnalyser();
    state.analyserL.fftSize=2048; state.analyserR.fftSize=2048;
    state.sourceNode.connect(state.splitter);
    state.splitter.connect(state.analyserL,0);
    state.splitter.connect(state.analyserR,1);
    const merger=state.audioContext.createChannelMerger(2);
    state.analyserL.connect(merger,0,0);
    state.analyserR.connect(merger,0,1);
    merger.connect(state.audioContext.destination);
    el.audioState.textContent='Ativo'; el.audioDot.className='dot ok';
    el.metaSr.textContent=state.audioContext.sampleRate+' Hz';
    el.metaAcodec.textContent='AAC/PCM (estimado)';
    el.metaChans.textContent='Est\u00e9reo';
  }

  // ── Metadados HLS ──────────────────────────────────────────────────────────
  function updateHlsMetadata() {
    if (!state.hls) return;
    const lvl=state.hls.currentLevel>=0?state.hls.levels[state.hls.currentLevel]:null;
    const maxLvl=state.hls.levels[state.hls.levels.length-1];
    if (maxLvl) {
      el.metaResMax.textContent=`${maxLvl.width}\u00d7${maxLvl.height}`;
      const fr=maxLvl.attrs&&maxLvl.attrs['FRAME-RATE']?parseFloat(maxLvl.attrs['FRAME-RATE']).toFixed(2):'\u2014';
      el.metaFpsStream.textContent=fr!=='\u2014'?fr+' fps':'\u2014';
      const vc=maxLvl.attrs&&maxLvl.attrs['CODECS']?maxLvl.attrs['CODECS'].split(',')[0]:'H.264 (HLS)';
      el.metaVcodec.textContent=vc;
      const vr=maxLvl.attrs&&maxLvl.attrs['VIDEO-RANGE']?maxLvl.attrs['VIDEO-RANGE']:'SDR';
      el.metaGamma.textContent=`BT.709 / ${vr}`;
    }
    if (lvl&&lvl.bitrate) el.metaBitrate.textContent=(lvl.bitrate/1000).toFixed(0)+' kbps';
  }

  function updateVideoMetadata(){
    const v=el.video;
    if(!v.videoWidth)return;
    const w=v.videoWidth,h=v.videoHeight;
    el.metaRes.textContent=`${w}\u00d7${h}`;
    el.metricResolution.textContent=`${w}\u00d7${h}`;
    const gcd=(a,b)=>b?gcd(b,a%b):a;
    const g=gcd(w,h);
    el.metaAR.textContent=`${w/g}:${h/g}`;
    if(!state.hls){
      el.metaVcodec.textContent=v.currentSrc.startsWith('blob:')?'Arquivo local':'H.264/AVC';
      el.metaGamma.textContent='SDR/BT.709 (prov\u00e1vel)';
      el.metaResMax.textContent=`${w}\u00d7${h}`;
    } else {
      updateHlsMetadata();
    }
    if(state.audioContext) el.metaSr.textContent=state.audioContext.sampleRate+' Hz';
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  async function startPlayback() {
    try {
      await ensureAudioGraph();
      if(state.audioContext.state==='suspended') await state.audioContext.resume();
      await el.video.play();
      el.playerState.textContent='Reproduzindo';
      el.videoState.textContent='Online';
      el.videoDot.className='dot ok';
      cancelAnimationFrame(state.rafId);
      state.lastFrameAt=0; state.frameCount=0;
      state.workerBusy=false;
      setTimeout(()=>{ initCanvases(); updateVideoMetadata(); },250);
      state.rafId=requestAnimationFrame(analysisLoop);
    } catch(e) {
      el.playerState.textContent='Falha no play';
    }
  }

  // ── HLS levels selector ────────────────────────────────────────────────────
  function populateHlsQuality(){
    if(!state.hls||!state.hls.levels.length)return;
    el.hlsQualitySelect.innerHTML='';
    const auto=document.createElement('option');
    auto.value='-1'; auto.textContent='Auto (ABR)';
    el.hlsQualitySelect.appendChild(auto);
    state.hls.levels.forEach((lvl,i)=>{
      const opt=document.createElement('option');
      opt.value=String(i);
      const fr=lvl.attrs&&lvl.attrs['FRAME-RATE']?`@${parseFloat(lvl.attrs['FRAME-RATE']).toFixed(0)}fps`:`fps`;
      opt.textContent=`${lvl.width}\u00d7${lvl.height} \u2022 ${(lvl.bitrate/1000).toFixed(0)}k ${fr}`;
      el.hlsQualitySelect.appendChild(opt);
    });
    el.hlsQualityWrap.classList.add('visible');
    el.hlsQualitySelect.addEventListener('change',()=>{
      const v=parseInt(el.hlsQualitySelect.value);
      state.hls.currentLevel=v;
      if(v>=0) state.hls.loadLevel=v;
      setTimeout(updateHlsMetadata,500);
    });
  }

  // ── Load URL ───────────────────────────────────────────────────────────────
  function destroyHls(){ if(state.hls){state.hls.destroy();state.hls=null;} }

  function loadFromUrl(){
    const url=el.streamUrl.value.trim();
    if(!url)return;
    destroyHls();
    el.hlsQualityWrap.classList.remove('visible');
    el.video.pause(); el.video.removeAttribute('src'); el.video.load();
    state.activeSource=url;
    el.sourceBadge.textContent=url.includes('.m3u8')?'HLS':'LINK';
    el.playerState.textContent='Carregando';
    el.metaSrc.textContent=url.length>42?url.slice(0,42)+'\u2026':url;
    const forceHls=el.sourceType.value==='hls'||url.includes('.m3u8');
    if(forceHls&&window.Hls&&Hls.isSupported()){
      state.hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});
      state.hls.loadSource(url);
      state.hls.attachMedia(el.video);
      state.hls.on(Hls.Events.MANIFEST_PARSED,()=>{
        populateHlsQuality();
        startPlayback();
      });
      state.hls.on(Hls.Events.ERROR,(_,d)=>{
        if(d.fatal){el.playerState.textContent='Erro HLS';el.videoDot.className='dot err';}
      });
    } else {
      el.video.crossOrigin='anonymous';
      el.video.src=url;
      el.video.addEventListener('loadedmetadata',startPlayback,{once:true});
    }
  }

  function loadFromFile(file){
    if(!file)return;
    destroyHls();
    el.hlsQualityWrap.classList.remove('visible');
    const url=URL.createObjectURL(file);
    state.activeSource=file.name;
    el.sourceBadge.textContent='Arquivo';
    el.playerState.textContent='Arquivo local';
    el.metaSrc.textContent=file.name;
    el.video.crossOrigin='anonymous';
    el.video.src=url;
    el.video.addEventListener('loadedmetadata',startPlayback,{once:true});
  }

  // ── CORS check ─────────────────────────────────────────────────────────────
  function validateCanvasRead(){
    try{
      offscreen.width=16;offscreen.height=16;
      offctx.drawImage(el.video,0,0,16,16);
      offctx.getImageData(0,0,1,1);
      el.corsState.textContent='Leitura ok';el.corsDot.className='dot ok';
    }catch(e){
      el.corsState.textContent='Bloqueado';el.corsDot.className='dot err';
    }
  }

  // ── Module toggles ─────────────────────────────────────────────────────────
  function initModuleToggles(){
    const map={
      'mod-waveform':'waveform','mod-vector':'vector','mod-histogram':'histogram',
      'mod-spectrum':'spectrum','mod-phase':'phase','mod-loudness':'loudness'
    };
    Object.entries(map).forEach(([id,key])=>{
      const inp=$(id);
      const card=$('card-'+key);
      inp.addEventListener('change',()=>{
        state.modules[key]=inp.checked;
        if(card) card.classList.toggle('scope-card-hidden',!inp.checked);
        if(!inp.checked&&card){
          const c=card.querySelector('canvas');
          if(c){const ctx=c.getContext('2d');ctx.fillStyle=BG;ctx.fillRect(0,0,c.width,c.height);}
        }
      });
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function initTabs(){
    document.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        $('tab-'+btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ── Sliders ────────────────────────────────────────────────────────────────
  function initSliders(){
    el.sliderQuality.addEventListener('input',()=>{
      state.quality=parseInt(el.sliderQuality.value);
      el.valQuality.textContent=state.quality;
    });
    el.sliderDensity.addEventListener('input',()=>{
      state.density=parseInt(el.sliderDensity.value);
      el.valDensity.textContent=state.density;
    });
  }

  // ── Scope button groups ────────────────────────────────────────────────────
  function initScopeButtons(){
    el.wfModeGroup.querySelectorAll('.scope-btn[data-wfmode]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        el.wfModeGroup.querySelectorAll('.scope-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.wfMode = btn.dataset.wfmode;
      });
    });
    el.wfNitsBtn.addEventListener('click',()=>{
      state.wfNits = !state.wfNits;
      el.wfNitsBtn.classList.toggle('active', state.wfNits);
    });
    el.vsStdGroup.querySelectorAll('.scope-btn[data-vsstd]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        el.vsStdGroup.querySelectorAll('.scope-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.vsStd = btn.dataset.vsstd;
      });
    });
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  function initTheme(){
    const btn=document.querySelector('[data-theme-toggle]');
    const html=document.documentElement;
    let mode=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
    html.setAttribute('data-theme',mode);
    btn.addEventListener('click',()=>{
      mode=html.getAttribute('data-theme')==='dark'?'light':'dark';
      html.setAttribute('data-theme',mode);
    });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  el.loadUrlBtn.addEventListener('click',loadFromUrl);
  el.streamUrl.addEventListener('keydown',e=>e.key==='Enter'&&loadFromUrl());
  el.fileInput.addEventListener('change',e=>loadFromFile(e.target.files?.[0]));
  el.video.addEventListener('loadeddata',validateCanvasRead);
  el.video.addEventListener('pause',()=>el.playerState.textContent='Pausado');
  el.video.addEventListener('error',()=>{
    el.playerState.textContent='Erro de m\u00eddia';
    el.videoState.textContent='Falha';
    el.videoDot.className='dot err';
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  initTheme();
  initTabs();
  initModuleToggles();
  initSliders();
  initScopeButtons();
  initWorker();
  requestAnimationFrame(()=>initCanvases());
  window.addEventListener('resize',()=>initCanvases());
})();
