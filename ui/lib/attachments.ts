export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.pdf,.csv,image/jpeg,image/png,application/pdf,text/csv";

export function attachmentType(name: string) {
  const suffix = name.lastIndexOf(".");
  if (suffix < 0) return;
  switch (name.slice(suffix + 1).toLowerCase()) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "pdf": return "application/pdf";
    case "csv": return "text/csv";
  }
}

export function matchesAttachmentSignature(bytes: Uint8Array, mime: string) {
  const prefix = mime === "image/jpeg" ? [0xff, 0xd8, 0xff]
    : mime === "image/png" ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    : mime === "application/pdf" ? [0x25, 0x50, 0x44, 0x46, 0x2d] : [];
  return prefix.length > 0 && prefix.every((byte, index) => bytes[index] === byte);
}

const thumbnailPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export function isAttachmentThumbnail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 90_000 && thumbnailPattern.test(value);
}

export async function createAttachmentThumbnail(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) return;
    const scale = Math.min(1, 240 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/jpeg", 0.72);
    return isAttachmentThumbnail(thumbnail) ? thumbnail : undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}
