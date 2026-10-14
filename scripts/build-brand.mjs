import sharp from "sharp";
import { mkdir, copyFile } from "node:fs/promises";
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
