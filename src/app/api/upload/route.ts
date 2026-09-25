import { NextResponse } from "next/server";

// Uploads the coin image and its Metaplex-style metadata JSON to IPFS via Pinata.
// Runs on the server so PINATA_JWT never reaches the browser.
const PINATA_UPLOAD = "https://uploads.pinata.cloud/v3/files";
const GATEWAY = process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "PINATA_JWT is not set in .env" }, { status: 500 });

  const form = await req.formData();
  const image = form.get("image");
  const name = String(form.get("name") ?? "").trim();
  const symbol = String(form.get("symbol") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();

  if (!(image instanceof File) || !image.type.startsWith("image/"))
    return NextResponse.json({ error: "Image is required" }, { status: 400 });
  if (image.size > MAX_IMAGE_BYTES)
    return NextResponse.json({ error: "Image must be 4 MB or smaller" }, { status: 400 });
  if (!name || !symbol) return NextResponse.json({ error: "Name and ticker are required" }, { status: 400 });

  const pin = async (file: Blob, filename: string) => {
    const body = new FormData();
    body.append("file", file, filename);
    body.append("network", "public");
    body.append("name", filename);
    const res = await fetch(PINATA_UPLOAD, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body });
    if (!res.ok) throw new Error(`${filename} upload failed: ${await res.text()}`);
    return `${GATEWAY}/ipfs/${(await res.json()).data.cid}`;
  };

  try {
    const imageUri = await pin(image, `${symbol}-image`);
    const metadata = {
      name,
      symbol,
      description,
      image: imageUri,
      properties: { files: [{ uri: imageUri, type: image.type }], category: "image" },
    };
    const uri = await pin(new Blob([JSON.stringify(metadata)], { type: "application/json" }), `${symbol}-metadata.json`);
    return NextResponse.json({ uri, imageUri });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
