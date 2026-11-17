/** Center-crop and compress an uploaded image before storing it in the profile. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Выберите изображение.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Фото должно быть меньше 8 МБ.");

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("Не удалось прочитать фото. Выберите изображение JPEG, PNG или WebP."); }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const x = (bitmap.width - side) / 2;
    const y = (bitmap.height - side) / 2;
    for (const size of [256, 192, 160, 128]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось обработать фото.");
      context.drawImage(bitmap, x, y, side, side, 0, 0, size, size);
      for (const quality of [0.82, 0.68, 0.5, 0.35]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        const base64 = data.slice(data.indexOf(",") + 1);
        const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
        if (base64.length * 3 / 4 - padding <= 35000) return data;
      }
    }
    throw new Error("Фото не удалось уменьшить. Выберите другое изображение.");
  } finally {
    bitmap.close();
  }
}
