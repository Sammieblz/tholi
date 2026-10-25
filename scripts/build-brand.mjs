import sharp from "sharp";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
export async function buildBrand(out) {
  await mkdir(out + "/media", { recursive: true });
  for (const file of ["tholi_brand_logo.png", "tholi_icon.png"])
    await copyFile("apps/public/media/" + file, out + "/media/" + file);
  for (const size of [16, 32, 48, 128])
    await sharp("apps/public/media/tholi_icon.png")
      .resize(size, size, { fit: "contain" })
      .png()
      .toFile(out + "/media/icon-" + size + ".png");
}

/** Website derivatives preserve the supplied mark and use an opaque brand canvas. */
export async function buildWebsiteBrand(out) {
  await mkdir(out + "/icons", { recursive: true });
  const mark = await sharp("apps/public/media/tholi_icon.png")
    .trim()
    .png()
    .toBuffer();
  const icon = async (size, scale = 0.8) => {
    const foreground = await sharp(mark)
      .resize(Math.round(size * scale), Math.round(size * scale), {
        fit: "contain",
        background: "#faf7f000",
      })
      .toBuffer();
    const composited = await sharp({
      create: { width: size, height: size, channels: 3, background: "#faf7f0" },
    })
      .composite([{ input: foreground, gravity: "center" }])
      .png()
      .toBuffer();
    return sharp(composited).removeAlpha().png().toBuffer();
  };
  for (const size of [16, 32, 48, 96])
    await writeFile(`${out}/icons/favicon-${size}.png`, await icon(size));
  for (const size of [192, 512])
    await writeFile(`${out}/icons/icon-${size}.png`, await icon(size));
  await writeFile(`${out}/icons/maskable-512.png`, await icon(512, 0.56));
  await writeFile(`${out}/apple-touch-icon.png`, await icon(180));
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map((size) => icon(size)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((buffer, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index];
    header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  await writeFile(`${out}/favicon.ico`, Buffer.concat([header, ...images]));
}
