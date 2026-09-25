import { NextResponse } from "next/server";

// Uploads the coin image and its Metaplex-style metadata JSON to IPFS via Pinata.
// Runs on the server so PINATA_JWT never reaches the browser.
const PINATA_UPLOAD = "https://uploads.pinata.cloud/v3/files";
const GATEWAY = process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]; // no SVG: it can carry scripts

// Best-effort limit per IP. Serverless instances don't share memory, so this slows abuse but doesn't stop it.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "PINATA_JWT is not set in .env" }, { status: 500 });

  // Only accept uploads from our own pages.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many uploads, try again in a few minutes" }, { status: 429 });

  const form = await req.formData();
  const image = form.get("image");
  const name = String(form.get("name") ?? "").trim();
  const symbol = String(form.get("symbol") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();

  if (!(image instanceof File) || !IMAGE_TYPES.includes(image.type))
    return NextResponse.json({ error: "Image must be PNG, JPEG, GIF or WebP" }, { status: 400 });
  if (image.size > MAX_IMAGE_BYTES)
    return NextResponse.json({ error: "Image must be 4 MB or smaller" }, { status: 400 });
  if (!name || !symbol) return NextResponse.json({ error: "Name and ticker are required" }, { status: 400 });
  if (name.length > 32 || symbol.length > 10 || description.length > 500 || !/^[A-Za-z0-9]+$/.test(symbol))
    return NextResponse.json({ error: "Name up to 32 characters, ticker up to 10 letters or digits, description up to 500" }, { status: 400 });

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
