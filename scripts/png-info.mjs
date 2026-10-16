import { inflateSync } from "node:zlib";

// Minimal PNG reader (8-bit, non-interlaced, grey+alpha / RGB / RGBA / palette)
// so tests and the build check can inspect real pixels without dependencies.
export function readPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("Not a PNG file.");
  let offset = 8, header = null, palette = null, transparency = null;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = { width:chunk.readUInt32BE(0), height:chunk.readUInt32BE(4), depth:chunk[8], colorType:chunk[9], interlace:chunk[12] };
    else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") data.push(chunk);
    offset += 12 + length;
  }
  if (!header) throw new Error("PNG header missing.");
  if (header.depth !== 8 || header.interlace !== 0) throw new Error("Only 8-bit non-interlaced PNGs are supported.");
  const channels = { 0:1, 2:3, 3:1, 4:2, 6:4 }[header.colorType];
  const bpp = channels, stride = header.width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(header.height * stride);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let i = 0; i < header.width * header.height; i++) {
    let r, g, b, a = 255;
    if (header.colorType === 6) [r, g, b, a] = pixels.subarray(i * 4, i * 4 + 4);
    else if (header.colorType === 2) [r, g, b] = pixels.subarray(i * 3, i * 3 + 3);
    else if (header.colorType === 4) { r = g = b = pixels[i * 2]; a = pixels[i * 2 + 1]; }
    else if (header.colorType === 0) r = g = b = pixels[i];
    else { const index = pixels[i]; [r, g, b] = palette.subarray(index * 3, index * 3 + 3); a = transparency?.[index] ?? 255; }
    rgba.set([r, g, b, a], i * 4);
  }
  return { width:header.width, height:header.height, colorType:header.colorType, rgba, hasAlphaChannel:[4, 6].includes(header.colorType) || !!transparency };
}

// Describes how Android will see an image used as a status-bar badge:
// only alpha matters, and every visible pixel is tinted.
export function badgeReport(png) {
  const { width, height, rgba } = png;
  let transparent = 0, opaque = 0, partial = 0, nonWhite = 0, minX = width, minY = height, maxX = -1, maxY = -1, edgeVisible = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, a = rgba[i + 3];
    if (a === 0) { transparent++; continue; }
    if (a === 255) opaque++; else partial++;
    if (a > 40 && (rgba[i] < 250 || rgba[i + 1] < 250 || rgba[i + 2] < 250)) nonWhite++;
    if (a > 10) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeVisible++;
    }
  }
  const total = width * height;
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => rgba[(y * width + x) * 4 + 3]);
  return {
    width, height, transparentShare:transparent / total, opaqueShare:opaque / total, partialShare:partial / total,
    nonWhiteVisiblePixels:nonWhite, edgeVisiblePixels:edgeVisible, cornerAlphas:corners,
    bboxWidthShare:(maxX - minX + 1) / width, bboxHeightShare:(maxY - minY + 1) / height, hasAlphaChannel:png.hasAlphaChannel
  };
}
