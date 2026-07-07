// ── Web Worker v1.4: multi-modo waveform + vsStd ──
self.onmessage = function(e) {
  const { buf, fw, fh, step, vsStd, wfMode } = e.data;
  const data = new Uint8ClampedArray(buf);
  const total = Math.ceil(fh / step) * Math.ceil(fw / step);

  // Waveform
  const wfStride = (wfMode === 'luma') ? 2 : 4;
  const wfPoints = new Float32Array(total * wfStride);
  let wi = 0;
  for (let py = 0; py < fh; py += step) {
    for (let px = 0; px < fw; px += step) {
      const idx = (py * fw + px) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const xn = px / fw;
      if (wfMode === 'ycbcr') {
        const Y  =  0.2126*r + 0.7152*g + 0.0722*b;
        const Cb = -0.1873*r - 0.3127*g + 0.5*b + 128;
        const Cr =  0.5*r   - 0.4187*g - 0.0813*b + 128;
        wfPoints[wi++] = xn; wfPoints[wi++] = Y/255;
        wfPoints[wi++] = xn; wfPoints[wi++] = Cb/255;
      } else if (wfMode !== 'rgb') {
        const luma = 0.2126*r + 0.7152*g + 0.0722*b;
        wfPoints[wi++] = xn;
        wfPoints[wi++] = luma / 255;
      }
    }
  }

  // RGB mode: 6 floats/point
  let wfPointsRGB = null;
  if (wfMode === 'rgb') {
    wi = 0;
    const rgbArr = new Float32Array(total * 6);
    for (let py = 0; py < fh; py += step) {
      for (let px = 0; px < fw; px += step) {
        const idx = (py * fw + px) * 4;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        const xn = px / fw;
        rgbArr[wi++]=xn; rgbArr[wi++]=r/255;
        rgbArr[wi++]=xn; rgbArr[wi++]=g/255;
        rgbArr[wi++]=xn; rgbArr[wi++]=b/255;
      }
    }
    wfPointsRGB = rgbArr;
  }

  // Vectorscope
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

  // Histograma
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  for (let py = 0; py < fh; py += step) {
    for (let px = 0; px < fw; px += step) {
      const idx = (py * fw + px) * 4;
      histR[data[idx]]++; histG[data[idx+1]]++; histB[data[idx+2]]++;
    }
  }

  const finalWf = (wfMode === 'rgb' && wfPointsRGB) ? wfPointsRGB : wfPoints;
  self.postMessage(
    { wfPoints: finalWf.buffer, vsPoints: vsPoints.buffer,
      histR: histR.buffer, histG: histG.buffer, histB: histB.buffer,
      wfLen: wi, vsLen: vi, wfMode },
    [finalWf.buffer, vsPoints.buffer, histR.buffer, histG.buffer, histB.buffer]
  );
};
