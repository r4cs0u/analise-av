// ── Web Worker v2.1 ──
self.onmessage = function(e) {
  const { buf, fw, fh, step, vsStd, wfMode } = e.data;
  const data = new Uint8ClampedArray(buf);
  const total = Math.ceil(fh / step) * Math.ceil(fw / step);

  // ── WAVEFORM ──────────────────────────────────────────────────────────
  let wfPoints, wi = 0;
  if (wfMode === 'rgb') {
    wfPoints = new Float32Array(total * 6);
    for (let py = 0; py < fh; py += step) {
      for (let px = 0; px < fw; px += step) {
        const idx = (py * fw + px) * 4;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        const xn = px / fw;
        wfPoints[wi++]=xn; wfPoints[wi++]=r/255;
        wfPoints[wi++]=xn; wfPoints[wi++]=g/255;
        wfPoints[wi++]=xn; wfPoints[wi++]=b/255;
      }
    }
  } else if (wfMode === 'ycbcr') {
    wfPoints = new Float32Array(total * 4);
    for (let py = 0; py < fh; py += step) {
      for (let px = 0; px < fw; px += step) {
        const idx = (py * fw + px) * 4;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        const xn = px / fw;
        const Y  =  0.2126*r + 0.7152*g + 0.0722*b;
        const Cb = -0.1873*r - 0.3127*g + 0.5*b + 128;
        wfPoints[wi++]=xn; wfPoints[wi++]=Y/255;
        wfPoints[wi++]=xn; wfPoints[wi++]=Cb/255;
      }
    }
  } else {
    wfPoints = new Float32Array(total * 2);
    for (let py = 0; py < fh; py += step) {
      for (let px = 0; px < fw; px += step) {
        const idx = (py * fw + px) * 4;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        const luma = 0.2126*r + 0.7152*g + 0.0722*b;
        wfPoints[wi++] = px / fw;
        wfPoints[wi++] = luma / 255;
      }
    }
  }

  // ── VECTORSCOPE ─────────────────────────────────────────────────────
  const vstep = step * 2;
  const vstotal = Math.ceil(fh / vstep) * Math.ceil(fw / vstep);
  const vsPoints = new Float32Array(vstotal * 2);
  let vi = 0;
  for (let py = 0; py < fh; py += vstep) {
    for (let px = 0; px < fw; px += vstep) {
      const idx = (py * fw + px) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      let cb, cr;
      if (vsStd === 'bt2020') {
        cb = -0.1646*r - 0.3354*g + 0.5*b;
        cr =  0.5*r   - 0.4598*g - 0.0402*b;
      } else {
        cb = -0.1873*r - 0.3127*g + 0.5*b;
        cr =  0.5*r   - 0.4187*g - 0.0813*b;
      }
      vsPoints[vi++] = cb / 128;
      vsPoints[vi++] = cr / 128;
    }
  }

  // ── HISTOGRAMA ────────────────────────────────────────────────────────
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  for (let py = 0; py < fh; py += step) {
    for (let px = 0; px < fw; px += step) {
      const idx = (py * fw + px) * 4;
      histR[data[idx]]++; histG[data[idx+1]]++; histB[data[idx+2]]++;
    }
  }

  // ── CIE 1931 xy ─────────────────────────────────────────────────────────
  // Converte sRGB linear -> XYZ D65 -> xy cromaticidade
  // Matriz sRGB->XYZ D65 (IEC 61966-2-1)
  const ciestep = step * 3;
  const cietotal = Math.ceil(fh / ciestep) * Math.ceil(fw / ciestep);
  const ciePoints = new Float32Array(cietotal * 2);
  let ci = 0;
  for (let py = 0; py < fh; py += ciestep) {
    for (let px = 0; px < fw; px += ciestep) {
      const idx = (py * fw + px) * 4;
      // lineariza (desgama sRGB aproximado)
      let rl = data[idx]   / 255;
      let gl = data[idx+1] / 255;
      let bl = data[idx+2] / 255;
      rl = rl <= 0.04045 ? rl / 12.92 : Math.pow((rl + 0.055) / 1.055, 2.4);
      gl = gl <= 0.04045 ? gl / 12.92 : Math.pow((gl + 0.055) / 1.055, 2.4);
      bl = bl <= 0.04045 ? bl / 12.92 : Math.pow((bl + 0.055) / 1.055, 2.4);
      // sRGB -> XYZ D65
      const X = 0.4124564*rl + 0.3575761*gl + 0.1804375*bl;
      const Y = 0.2126729*rl + 0.7151522*gl + 0.0721750*bl;
      const Z = 0.0193339*rl + 0.1191920*gl + 0.9503041*bl;
      const denom = X + Y + Z;
      if (denom < 1e-6) continue; // pixel preto, pula
      ciePoints[ci++] = X / denom; // x
      ciePoints[ci++] = Y / denom; // y
    }
  }

  // ── DIAMOND (Twin Peaks) ──────────────────────────────────────────────
  // Eixo X: (Cr - Cb) normalizado -> posição horizontal no diamante
  // Eixo Y: luma normalizado -> posição vertical
  const dstep = step * 2;
  const dtotal = Math.ceil(fh / dstep) * Math.ceil(fw / dstep);
  const diamondPoints = new Float32Array(dtotal * 2);
  let di = 0;
  for (let py = 0; py < fh; py += dstep) {
    for (let px = 0; px < fw; px += dstep) {
      const idx = (py * fw + px) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const Y  = (0.2126*r + 0.7152*g + 0.0722*b) / 255; // 0..1
      // BT.709 Cb e Cr normalizados -1..1
      const Cb = (-0.1873*r - 0.3127*g + 0.5*b)   / 128; // -1..1
      const Cr = ( 0.5*r   - 0.4187*g - 0.0813*b) / 128; // -1..1
      // Rotação 45°: eixo X = (Cr - Cb) / sqrt(2), eixo Y = luma*2 - 1
      diamondPoints[di++] = (Cr - Cb) / 1.4142;
      diamondPoints[di++] = Y * 2 - 1; // centraliza em 0
    }
  }

  self.postMessage(
    {
      wfPoints: wfPoints.buffer, vsPoints: vsPoints.buffer,
      histR: histR.buffer, histG: histG.buffer, histB: histB.buffer,
      ciePoints: ciePoints.buffer, diamondPoints: diamondPoints.buffer,
      wfLen: wi, vsLen: vi, wfMode,
      cieLen: ci, diamondLen: di,
    },
    [wfPoints.buffer, vsPoints.buffer,
     histR.buffer, histG.buffer, histB.buffer,
     ciePoints.buffer, diamondPoints.buffer]
  );
};
