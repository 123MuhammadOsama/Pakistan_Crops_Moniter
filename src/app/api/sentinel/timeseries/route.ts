import { NextResponse } from "next/server";

async function getToken() {
  const clientId = process.env.SENTINEL_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Sentinel client credentials");

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);

  const res = await fetch("https://services.sentinel-hub.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed: ${text}`);
  }
  const data = await res.json();
  if (!data?.access_token) {
    throw new Error("Token response missing access_token");
  }
  return data;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const geometry = body.geometry;
    const start = body.start ? new Date(body.start) : addDays(new Date(), -60);
    const end = body.end ? new Date(body.end) : new Date();
    const stepDays = body.stepDays || 10;

    if (!geometry) {
      return NextResponse.json({ error: "Missing geometry" }, { status: 400 });
    }

    const tokenData = await getToken();
    const token = tokenData.access_token;

    // We'll request a small NDVI image for multiple dates and return thumbnails as data URLs
    const evalscriptNDVI = `
      //VERSION=3
      function setup() {
        return { input: ["B04","B08"], output: { bands: 3 } };
      }
      function evaluatePixel(sample) {
        let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
        let v = (ndvi + 1.0) / 2.0;
        return [v, v, v];
      }
    `;

    const results: any[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, stepDays)) {
      const date = d.toISOString().slice(0, 10);
      const from = `${date}T00:00:00Z`;
      const to = `${date}T23:59:59Z`;

      const processBody = {
        input: {
          bounds: { geometry },
          data: [
            {
              type: "S2L2A",
              dataFilter: { timeRange: { from, to } },
              processing: { mosaickingOrder: "mostRecent" },
            },
          ],
        },
        evalscript: evalscriptNDVI,
        output: {
          width: 128,
          height: 128,
          responses: [{ identifier: "default", format: { type: "image/png" } }],
        },
      };

      try {
        const resp = await fetch("https://services.sentinel-hub.com/api/v1/process", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(processBody),
        });

        if (!resp.ok) {
          results.push({ date, ndvi: null, thumbnail: null, ok: false });
          continue;
        }

        const buf = Buffer.from(await resp.arrayBuffer());
        const thumb = `data:image/png;base64,${buf.toString("base64")}`;
        results.push({ date, ndvi: null, thumbnail: thumb, ok: true });
      } catch (err) {
        results.push({ date, ndvi: null, thumbnail: null, ok: false });
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
