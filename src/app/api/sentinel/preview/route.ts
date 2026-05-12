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

function bboxToImageCoordinates(bbox: number[]) {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    [minX, maxY],
    [maxX, maxY],
    [maxX, minY],
    [minX, minY],
  ];
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const geometry = body.geometry;
    const daysBack = Number.isFinite(body.daysBack) ? Number(body.daysBack) : 30;
    const now = new Date();
    const date = body.date || now.toISOString().slice(0, 10);
    const width = body.width || 512;
    const height = body.height || 512;

    if (!geometry) {
      return NextResponse.json({ error: "Missing geometry" }, { status: 400 });
    }

    const coordsArray = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : [];
    if (!coordsArray.length) {
      return NextResponse.json({ error: "Invalid geometry coordinates" }, { status: 400 });
    }

    const tokenData = await getToken();
    const token = tokenData.access_token;

    const fromDate = body.date ? new Date(`${date}T00:00:00Z`) : new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const toDate = body.date ? new Date(`${date}T23:59:59Z`) : now;
    const from = fromDate.toISOString();
    const to = toDate.toISOString();

    const evalscriptTrueColor = `
      //VERSION=3
      function setup() {
        return {
          input: ["B04", "B03", "B02"],
          output: { bands: 3 }
        };
      }
      function evaluatePixel(sample) {
        return [sample.B04, sample.B03, sample.B02];
      }
    `;

    const evalscriptNDVI = `
      //VERSION=3
      function setup() {
        return {
          input: ["B04", "B08"],
          output: { bands: 3 }
        };
      }
      function evaluatePixel(sample) {
        let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
        // vegetation color ramp
        return colorBlend(ndvi,
          [-1.0, -0.2, 0.0, 0.2, 0.35, 0.5, 0.7, 0.9],
          [
            [0.2, 0.2, 0.2],
            [0.4, 0.2, 0.2],
            [0.5, 0.3, 0.2],
            [0.6, 0.5, 0.2],
            [0.7, 0.7, 0.2],
            [0.2, 0.6, 0.2],
            [0.1, 0.5, 0.1],
            [0.0, 0.4, 0.0]
          ]
        );
      }
    `;

    const processBody = (evalscript: string) => ({
      input: {
        bounds: { geometry },
        data: [
          {
            type: "S2L2A",
            dataFilter: {
              timeRange: { from, to },
            },
            processing: { mosaickingOrder: "mostRecent" },
          },
        ],
      },
      evalscript,
      output: {
        width,
        height,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
    });

    const respTrue = await fetch("https://services.sentinel-hub.com/api/v1/process", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(processBody(evalscriptTrueColor)),
    });

    if (!respTrue.ok) {
      const text = await respTrue.text();
      return NextResponse.json({ error: "Process API true-color failed", detail: text }, { status: 502 });
    }

    const bufTrue = Buffer.from(await respTrue.arrayBuffer());
    const trueBase64 = `data:image/png;base64,${bufTrue.toString("base64")}`;

    const respNdvi = await fetch("https://services.sentinel-hub.com/api/v1/process", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(processBody(evalscriptNDVI)),
    });

    if (!respNdvi.ok) {
      const text = await respNdvi.text();
      return NextResponse.json({ error: "Process API NDVI failed", detail: text }, { status: 502 });
    }

    const bufNdvi = Buffer.from(await respNdvi.arrayBuffer());
    const ndviBase64 = `data:image/png;base64,${bufNdvi.toString("base64")}`;

    // compute bbox from geometry (assume GeoJSON polygon or multipolygon)
    const lons: number[] = [];
    const lats: number[] = [];

    const pushCoord = (pair: any) => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      const lon = pair[0];
      const lat = pair[1];
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        lons.push(lon);
        lats.push(lat);
      }
    };

    // Support Polygon: [ [ [lng,lat], ... ] ] and MultiPolygon: [ [ [ [lng,lat], ... ] ] ]
    if (geometry.type === "Polygon") {
      coordsArray.forEach((ring: any) => {
        if (!Array.isArray(ring)) return;
        ring.forEach(pushCoord);
      });
    } else if (geometry.type === "MultiPolygon") {
      coordsArray.forEach((poly: any) => {
        if (!Array.isArray(poly)) return;
        poly.forEach((ring: any) => {
          if (!Array.isArray(ring)) return;
          ring.forEach(pushCoord);
        });
      });
    } else {
      return NextResponse.json({ error: "Unsupported geometry type" }, { status: 400 });
    }
    if (!lons.length || !lats.length) {
      return NextResponse.json({ error: "Invalid geometry coordinates" }, { status: 400 });
    }
    const minX = Math.min(...lons);
    const maxX = Math.max(...lons);
    const minY = Math.min(...lats);
    const maxY = Math.max(...lats);
    const bbox: number[] = [minX, minY, maxX, maxY];

    const coordsForImage = bboxToImageCoordinates(bbox);

    return NextResponse.json({ trueColor: trueBase64, ndvi: ndviBase64, bbox, coords: coordsForImage });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
