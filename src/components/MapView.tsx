"use client";

import React, { useEffect, useRef, useState } from "react";
import Map, { NavigationControl } from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import { getDb, type FarmRecord } from "../lib/db";
import { useNDVI } from "../hooks/useNDVI";
import NDVIReport from "./NDVIReport";

import "mapbox-gl/dist/mapbox-gl.css";

const SAVED_SOURCE = "saved-source";
const PREVIEW_SOURCE = "preview-source";

const SAVED_LINE_LAYER = "saved-line";
const SAVED_FILL_LAYER = "saved-fill";

const PREVIEW_LINE_LAYER = "preview-line";
const PREVIEW_FILL_LAYER = "preview-fill";

type Coord = {
  lng: number;
  lat: number;
};

type SavedFarm = {
  id: number;
  name: string;
  area: number;
  geometry: GeoJSON.Polygon;
  coords: Coord[];
  centerLat: number;
  centerLng: number;
};

const formatAreaSqm = (area: number) => `${area.toFixed(0)} m²`;
const formatCoordinate = (value: number) => value.toFixed(6);

const getPolygonCenter = (coords: Coord[]) => {
  if (!coords.length) return { lat: 0, lng: 0 };

  const total = coords.reduce(
    (acc, coord) => ({
      lat: acc.lat + coord.lat,
      lng: acc.lng + coord.lng,
    }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: total.lat / coords.length,
    lng: total.lng / coords.length,
  };
};

const normalizeCoords = (farm: any): Coord[] => {
  if (Array.isArray(farm?.coords) && farm.coords.length) {
    return farm.coords;
  }

  const ring = farm?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return [];

  const coords = ring.map((pair: number[]) => ({
    lng: pair[0],
    lat: pair[1],
  }));

  const last = coords[coords.length - 1];
  const first = coords[0];

  if (last && first && last.lng === first.lng && last.lat === first.lat) {
    coords.pop();
  }

  return coords;
};

export default function MapView() {
  const mapRef = useRef<any>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const hoverPopupRef = useRef<mapboxgl.Popup | null>(null);

  const [drawing, setDrawing] = useState(false);

  const [boundaryCoords, setBoundaryCoords] = useState<Coord[]>([]);
  const boundaryCoordsRef = useRef<Coord[]>([]);

  const [currentArea, setCurrentArea] = useState(0);

  const [farmName, setFarmName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchLat, setSearchLat] = useState("");
  const [searchLng, setSearchLng] = useState("");

  const [savedFarms, setSavedFarms] = useState<SavedFarm[]>([]);
  const [searchResults, setSearchResults] = useState<SavedFarm[]>([]);
  const [mapReady, setMapReady] = useState(false);
  
  const searchLatLngMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const [message, setMessage] = useState(
    'Click "Start drawing" to mark your boundary.'
  );

  const [ndviData, setNdviData] = useState<any>(null);
  const [selectedFarmForReport, setSelectedFarmForReport] = useState<SavedFarm | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const { fetchPreview, fetchTimeseries, loading: ndviLoading } = useNDVI();

  const toSavedFarm = (farm: FarmRecord): SavedFarm | null => {
    const coords = normalizeCoords(farm);
    if (coords.length < 3) return null;

    const polygonCoords = [
      ...coords.map((c) => [c.lng, c.lat]),
      [coords[0].lng, coords[0].lat],
    ];
    const polygon = turf.polygon([polygonCoords]);
    const area = Number.isFinite(farm.area)
      ? farm.area
      : turf.area(polygon);
    const center = getPolygonCenter(coords);

    return {
      id: farm.id ?? Date.now(),
      name: farm.name ?? "Unnamed",
      area,
      geometry: polygon.geometry,
      coords,
      centerLat: center.lat,
      centerLng: center.lng,
    };
  };

  const loadFarms = async () => {
    try {
      const db = getDb();
      const farms = await db.farms.orderBy("createdAt").toArray();
      console.log("Loaded farms from Dexie:", farms);
      const normalized = farms
        .map((farm) => toSavedFarm(farm))
        .filter(Boolean) as SavedFarm[];
      console.log("Normalized farms:", normalized);
      setSavedFarms(normalized);
    } catch (err) {
      console.error("Failed to load farms:", err);
      setSavedFarms([]);
    }
  };

  useEffect(() => {
    loadFarms();
  }, []);

  useEffect(() => {
    boundaryCoordsRef.current = boundaryCoords;
  }, [boundaryCoords]);

  useEffect(() => {
    setSearchResults(savedFarms);
  }, [savedFarms]);

  const handleMapLoad = () => {
    console.log("✓✓✓ MAP FULLY LOADED - onLoad FIRED ✓✓✓");
    
    if (!mapRef.current) {
      console.log("ERROR: mapRef.current still null in handleMapLoad");
      return;
    }

    const map = mapRef.current.getMap();
    if (!map) {
      console.log("ERROR: map.getMap() null in handleMapLoad");
      return;
    }

    console.log("Setting up map sources and layers...");

    // Add terrain
    if (!map.getSource("mapbox-dem")) {
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
      });
      map.setTerrain({
        source: "mapbox-dem",
        exaggeration: 1.5,
      });
    }

    // Add sky
    if (!map.getLayer("sky")) {
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0, 0],
          "sky-atmosphere-sun-intensity": 15,
        },
      });
    }

    // Add saved source and layers
    if (!map.getSource(SAVED_SOURCE)) {
      map.addSource(SAVED_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer(SAVED_FILL_LAYER)) {
      map.addLayer({
        id: SAVED_FILL_LAYER,
        type: "fill",
        source: SAVED_SOURCE,
        paint: {
          "fill-color": "#10b981",
          "fill-opacity": 0.35,
        },
      });
    }

    if (!map.getLayer(SAVED_LINE_LAYER)) {
      map.addLayer({
        id: SAVED_LINE_LAYER,
        type: "line",
        source: SAVED_SOURCE,
        paint: {
          "line-color": "#000000",
          "line-width": 5,
        },
      });
    }

    // Add preview source and layers
    if (!map.getSource(PREVIEW_SOURCE)) {
      map.addSource(PREVIEW_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer(PREVIEW_FILL_LAYER)) {
      map.addLayer({
        id: PREVIEW_FILL_LAYER,
        type: "fill",
        source: PREVIEW_SOURCE,
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.30,
        },
      });
    }

    if (!map.getLayer(PREVIEW_LINE_LAYER)) {
      map.addLayer({
        id: PREVIEW_LINE_LAYER,
        type: "line",
        source: PREVIEW_SOURCE,
        paint: {
          "line-color": "#1f2937",
          "line-width": 4,
        },
      });
    }

    // Set up hover popup
    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "farm-hover-popup",
      });
    }

    // Hover listeners
    map.on("mousemove", SAVED_FILL_LAYER, (event: any) => {
      const feature = event.features?.[0];
      if (!feature || !hoverPopupRef.current) return;

      const name = feature.properties?.name;
      const area = Number(feature.properties?.area);
      const centerLat = Number(feature.properties?.centerLat);
      const centerLng = Number(feature.properties?.centerLng);

      map.getCanvas().style.cursor = "pointer";
      hoverPopupRef.current
        .setLngLat(event.lngLat)
        .setHTML(
          `<div style="display:grid;gap:2px;">
            <span style="font-weight:700;">${String(name)}</span>
            <span style="font-size:11px;">Area: ${
              Number.isFinite(area) && area > 0 ? formatAreaSqm(area) : "N/A"
            }</span>
            <span style="font-size:11px;">Lat: ${
              Number.isFinite(centerLat)
                ? formatCoordinate(centerLat)
                : "N/A"
            } | Lng: ${
              Number.isFinite(centerLng)
                ? formatCoordinate(centerLng)
                : "N/A"
            }</span>
          </div>`
        )
        .addTo(map);
    });

    map.on("mouseleave", SAVED_FILL_LAYER, () => {
      if (!hoverPopupRef.current) return;
      map.getCanvas().style.cursor = "";
      hoverPopupRef.current.remove();
    });

    // Draw initial farms
    console.log("Drawing initial farms, count:", savedFarms.length);
    drawSavedFarms(savedFarms);

    // Set map ready
    console.log("Calling setMapReady(true)");
    setMapReady(true);
    console.log("✓✓✓ mapReady is NOW TRUE ✓✓✓");
  };

  useEffect(() => {
    console.log("Effect triggered: mapReady=", mapReady, "savedFarms count=", savedFarms.length);
    if (!mapReady) {
      console.log("Map not ready yet");
      return;
    }
    console.log("Calling drawSavedFarms with", savedFarms.length, "farms");
    drawSavedFarms(savedFarms);
  }, [mapReady, savedFarms]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleClick = async (e: any) => {
      try {
        const feature = e.features && e.features[0];
        if (!feature) return;

        const id = Number(feature.properties?.id ?? feature.id);
        const saved = savedFarms.find((s) => s.id === id);
        const geometry = saved
          ? {
              type: "Polygon",
              coordinates: [
                [...saved.coords.map((c) => [c.lng, c.lat] as [number, number]), [saved.coords[0].lng, saved.coords[0].lat]],
              ],
            }
          : feature.geometry;

        setMessage("Loading farm monitor images...");
        const preview = await fetchPreview(geometry, { daysBack: 30 });
        if (!preview || preview.error) {
          setMessage("Failed to load preview");
          return;
        }

        const { trueColor, ndvi, coords } = preview;
        const validCoords =
          Array.isArray(coords) &&
          coords.length === 4 &&
          coords.every((pair: any) =>
            Array.isArray(pair) && pair.length === 2 &&
            Number.isFinite(pair[0]) && Number.isFinite(pair[1])
          );
        if (!validCoords) {
          setMessage("Invalid preview coordinates");
          return;
        }

        try {
          if (map.getLayer("farm-preview-layer")) map.removeLayer("farm-preview-layer");
          if (map.getSource("farm-preview")) map.removeSource("farm-preview");
        } catch (err) {}

        map.addSource("farm-preview", { type: "image", url: trueColor, coordinates: coords });
        map.addLayer({ id: "farm-preview-layer", type: "raster", source: "farm-preview" });

        try {
          if (map.getLayer("farm-ndvi-layer")) map.removeLayer("farm-ndvi-layer");
          if (map.getSource("farm-ndvi")) map.removeSource("farm-ndvi");
        } catch (err) {}

        map.addSource("farm-ndvi", { type: "image", url: ndvi, coordinates: coords });
        map.addLayer({ id: "farm-ndvi-layer", type: "raster", source: "farm-ndvi", paint: { "raster-opacity": 0.6 } });

        setMessage(`Showing monitor for ${saved?.name ?? "farm"}`);
      } catch (err) {
        console.error(err);
        setMessage("Error loading farm monitor");
      }
    };

    map.on("click", SAVED_FILL_LAYER, handleClick);
    return () => {
      map.off("click", SAVED_FILL_LAYER, handleClick);
    };
  }, [mapReady, savedFarms, fetchPreview]);

  useEffect(() => {
    console.log("mapReady state changed to:", mapReady);
  }, [mapReady]);

  const handleMapClick = (e: any) => {
    if (!drawing) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const point = {
      lng: e.lngLat.lng,
      lat: e.lngLat.lat,
    };

    setBoundaryCoords((prev) => {
      const next = [...prev, point];
      updatePreview(next);

      const marker = new mapboxgl.Marker({ color: "#ff0000" })
        .setLngLat([point.lng, point.lat])
        .addTo(map);

      if (next.length === 1) {
        const el = marker.getElement();
        el.style.cursor = "pointer";
        el.title = "Click to close boundary";
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          finalizeBoundary();
        });
      }

      markersRef.current.push(marker);
      return next;
    });
  };

  const updatePreview = (coords: Coord[]) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const source = map.getSource(PREVIEW_SOURCE) as mapboxgl.GeoJSONSource;
    if (!source) return;

    if (coords.length < 2) {
      source.setData({ type: "FeatureCollection", features: [] });
      setCurrentArea(0);
      return;
    }

    if (coords.length < 3) {
      const line = coords.map((c) => [c.lng, c.lat]);
      source.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: line,
            },
            properties: {},
          },
        ],
      } as any);
      setCurrentArea(0);
      return;
    }

    const polygon = [
      ...coords.map((c) => [c.lng, c.lat]),
      [coords[0].lng, coords[0].lat],
    ];

    const polygonFeature = turf.polygon([polygon]);
    const area = turf.area(polygonFeature);
    setCurrentArea(area);

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [polygon],
          },
          properties: {},
        },
      ],
    } as any);
  };

  const clearMarkers = () => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
  };

  const resetBoundary = () => {
    setBoundaryCoords([]);
    setCurrentArea(0);
    clearMarkers();
    updatePreview([]);
    setMessage("Boundary cleared. Start drawing again or save another field.");
  };

  const drawSavedFarms = (farms: SavedFarm[]) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const source = map.getSource(SAVED_SOURCE) as mapboxgl.GeoJSONSource;
    if (!source) return;

    const features = farms.map((farm) => {
      // Reconstruct polygon geometry to ensure it's valid
      const polygon = [
        ...farm.coords.map((c) => [c.lng, c.lat]),
        [farm.coords[0].lng, farm.coords[0].lat], // Close the ring
      ];

      return {
        id: farm.id,
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [polygon],
        },
        properties: {
          id: farm.id,
          name: farm.name,
          area: farm.area,
          centerLat: farm.centerLat,
          centerLng: farm.centerLng,
        },
      };
    });

    console.log("Drawing farms:", features.length, features);
    source.setData({
      type: "FeatureCollection",
      features,
    } as any);
  };

  const finalizeBoundary = () => {
    const coords = boundaryCoordsRef.current;
    if (coords.length < 3) return;

    const polygonCoords = [
      ...coords.map((c) => [c.lng, c.lat]),
      [coords[0].lng, coords[0].lat],
    ];

    const polygon = turf.polygon([polygonCoords]);
    const area = turf.area(polygon);

    setCurrentArea(area);
    updatePreview(coords);
    setDrawing(false);
    setMessage(`Boundary closed. Area: ${formatAreaSqm(area)}.`);
  };

  const saveBoundary = async () => {
    console.log("saveBoundary called, boundaryCoords:", boundaryCoords.length);
    if (boundaryCoords.length < 3) {
      setMessage("Please mark at least 3 boundary points.");
      return;
    }

    if (!farmName.trim()) {
      setMessage("Please enter a land name before saving.");
      return;
    }
    console.log("Saving farm:", farmName);

    const polygonCoords = [
      ...boundaryCoords.map((c) => [c.lng, c.lat]),
      [boundaryCoords[0].lng, boundaryCoords[0].lat],
    ];
    const polygon = turf.polygon([polygonCoords]);
    const area = turf.area(polygon);
    const center = getPolygonCenter(boundaryCoords);

    const db = getDb();
    const record: FarmRecord = {
      name: farmName.trim(),
      coords: boundaryCoords,
      area,
      createdAt: Date.now(),
    };

    const id = await db.farms.add(record);
    console.log("Farm saved to Dexie with ID:", id);
    const newFarm: SavedFarm = {
      id,
      name: record.name,
      area: record.area,
      geometry: polygon.geometry,
      coords: record.coords,
      centerLat: center.lat,
      centerLng: center.lng,
    };

    setSavedFarms((prev) => [...prev, newFarm]);
    console.log("setSavedFarms called with:", [...(savedFarms || []), newFarm]);

    await loadFarms();

    setDrawing(false);
    setBoundaryCoords([]);
    setFarmName("");
    setCurrentArea(0);
    updatePreview([]);
    clearMarkers();
    setMessage(`Saved land as "${newFarm.name}" with area ${formatAreaSqm(area)}.`);
  };

  const startDrawing = () => {
    setDrawing(true);
    setBoundaryCoords([]);
    setCurrentArea(0);
    setMessage("Drawing mode enabled. Click map to mark boundaries.");
    updatePreview([]);
    clearMarkers();
  };

  const fetchNDVIReport = async (farm: SavedFarm) => {
    setSelectedFarmForReport(farm);
    setShowReport(true);
    setReportError(null);
    
    try {
      setMessage("Loading NDVI data for report...");
      const geometry = {
        type: "Polygon" as const,
        coordinates: [
          [
            ...farm.coords.map((c) => [c.lng, c.lat]),
            [farm.coords[0].lng, farm.coords[0].lat],
          ],
        ],
      };

      // Fetch NDVI statistics
      const statsRes = await fetch("/api/sentinel/ndvi-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry, daysBack: 30 }),
      });

      if (!statsRes.ok) {
        const err = await statsRes.json();
        throw new Error(err?.error || "Failed to fetch NDVI stats");
      }

      const statsData = await statsRes.json();
      setNdviData(statsData);
      setMessage(`NDVI report generated for ${farm.name}`);
    } catch (err: any) {
      const errorMsg = err?.message || "Failed to generate NDVI report";
      setReportError(errorMsg);
      setMessage(errorMsg);
    }
  };

  const searchFarms = (value?: string) => {
    const raw = typeof value === "string" ? value : searchTerm;
    const term = raw.trim().toLowerCase();
    const results = term
      ? savedFarms.filter((farm) =>
          farm.name.toLowerCase().includes(term)
        )
      : savedFarms;

    setSearchResults(results);

    if (results.length > 0 && mapRef.current) {
      const map = mapRef.current.getMap();
      const coords = results[0].coords.map(
        (coord) => [coord.lng, coord.lat] as [number, number]
      );
      const bounds = coords.reduce(
        (b, point) => b.extend(point),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
    }
  };

  const searchByLatLng = () => {
    const lat = parseFloat(searchLat);
    const lng = parseFloat(searchLng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage("Please enter valid latitude and longitude values.");
      return;
    }

    if (lat < -90 || lat > 90) {
      setMessage("Latitude must be between -90 and 90.");
      return;
    }

    if (lng < -180 || lng > 180) {
      setMessage("Longitude must be between -180 and 180.");
      return;
    }

    if (!mapRef.current) return;

    const map = mapRef.current.getMap();

    // Remove previous search marker
    if (searchLatLngMarkerRef.current) {
      searchLatLngMarkerRef.current.remove();
    }

    // Add marker at the searched location
    const el = document.createElement("div");
    el.textContent = "📍";
    el.style.fontSize = "32px";
    el.style.cursor = "pointer";
    el.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,0.3))";

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([lng, lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<div style="padding:8px;">
            <strong>Search Location</strong><br/>
            Lat: ${lat.toFixed(6)}<br/>
            Lng: ${lng.toFixed(6)}
          </div>`
        )
      )
      .addTo(map);

    marker.togglePopup();
    searchLatLngMarkerRef.current = marker;

    // Center map on the location
    map.flyTo({
      center: [lng, lat],
      zoom: 16,
      duration: 1500,
    });

    setMessage(`Pinned location: Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)}`);
  };

  const takeScreenshot = () => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const canvas = map.getCanvas();
    if (!canvas) return;

    const capture = () => {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = "farm-boundary-image.png";
        link.href = dataUrl;
        link.click();
      } catch {
        setMessage("Screenshot failed.");
      }
    };

    let handled = false;
    const onceCapture = () => {
      if (handled) return;
      handled = true;
      capture();
    };

    map.once("idle", onceCapture);
    map.triggerRepaint();
    setTimeout(onceCapture, 700);
  };

  return (
    <div className="relative h-screen w-full">
      <Map
        ref={mapRef}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: 67.0011,
          latitude: 24.8607,
          zoom: 13,
          pitch: 60,
        }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        preserveDrawingBuffer={true}
      >
        <NavigationControl position="top-right" />
      </Map>

      <div className="absolute top-4 left-4 z-10 w-80 rounded-2xl bg-white/95 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Land Boundary Tool</h2>
            <p className="mt-1 text-xs text-gray-600">
              Draw, save, search and capture your fields.
            </p>
          </div>
          <button
            onClick={takeScreenshot}
            className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
          >
            Capture
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => {
              startDrawing();
              resetBoundary();
              setMessage(
                "Drawing mode enabled. Click map to add land corners."
              );
            }}
            className="rounded-lg bg-black p-2 text-white"
          >
            {drawing ? "Drawing Active" : "Start Drawing"}
          </button>


          <button
            onClick={resetBoundary}
            className="rounded-lg bg-orange-500 p-2 text-white"
          >
            Clear Boundary
          </button>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            Land Name
          </label>

          <input
            value={farmName}
            onChange={(e) => setFarmName(e.target.value)}
            placeholder="Enter land name"
            className="w-full rounded-lg border p-2"
          />

          {currentArea > 0 && (
            <div className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-gray-700">
              <span className="font-semibold">Current Area:</span>{" "}
              {formatAreaSqm(currentArea)}
            </div>
          )}
        </div>

          <button
            onClick={saveBoundary}
            className="rounded-lg bg-green-600 p-2 text-white mt-2"
          >
            Save Boundary
          </button>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            Search Saved Land
          </label>
          <div className="flex gap-2">
            <input
              value={searchTerm}
              onChange={(e) => {
                const next = e.target.value;
                setSearchTerm(next);
                searchFarms(next);
              }}
              placeholder="Search by name"
              className="flex-1 rounded-lg border p-2"
            />
            <button
              onClick={() => searchFarms()}
              className="rounded-lg bg-black px-3 text-sm text-white"
            >
              Search
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            Pin Location by Coordinates
          </label>
          <div className="flex flex-col gap-2">
            <input
              value={searchLat}
              onChange={(e) => setSearchLat(e.target.value)}
              placeholder="Latitude"
              type="number"
              step="0.000001"
              className="flex-1 rounded-lg border p-2 text-sm"
            />
            <input
              value={searchLng}
              onChange={(e) => setSearchLng(e.target.value)}
              placeholder="Longitude"
              type="number"
              step="0.000001"
              className="flex-1 rounded-lg border p-2 text-sm"
            />
          </div>
          <button
            onClick={searchByLatLng}
            className="mt-2 w-full rounded-lg bg-blue-600 p-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            📍 Pin Location
          </button>
        </div>

        <div className="mt-4 rounded-lg bg-gray-100 p-3 text-sm">
          {message}
        </div>

        <div className="mt-4 rounded-lg border p-3 text-xs">
          <div className="font-semibold">Vegetation Legend (NDVI)</div>
          <div className="mt-2 grid gap-1">
            {/* <div><span className="inline-block h-2 w-6 rounded bg-[#333333]" /> <span className="ml-2">Water / non-veg</span></div> */}
            <div><span className="inline-block h-2 w-6 rounded bg-[#8a4d33]" /> <span className="ml-2">Bare soil</span></div>
            <div><span className="inline-block h-2 w-6 rounded bg-[#bfa84d]" /> <span className="ml-2">Sparse vegetation</span></div>
            <div><span className="inline-block h-2 w-6 rounded bg-[#a8b200]" /> <span className="ml-2">Moderate vegetation</span></div>
            <div><span className="inline-block h-2 w-6 rounded bg-[#1f8f1f]" /> <span className="ml-2">Healthy vegetation</span></div>
            <div><span className="inline-block h-2 w-6 rounded bg-[#0c6b0c]" /> <span className="ml-2">Very healthy vegetation</span></div>
          </div>
        </div>

        <div className="mt-4 max-h-60 overflow-y-auto">
          <h3 className="font-semibold">Saved Lands</h3>

          {searchResults.length === 0 ? (
            <div className="mt-2 text-sm text-gray-500">
              No matching lands found.
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {searchResults.map((farm) => (
                <div key={farm.id} className="rounded-lg border p-2">
                  <button
                    onClick={() => {
                      if (!mapRef.current) return;
                      const map = mapRef.current.getMap();
                      const coords = farm.coords.map(
                        (coord) => [coord.lng, coord.lat] as [number, number]
                      );
                      const bounds = coords.reduce(
                        (b, point) => b.extend(point),
                        new mapboxgl.LngLatBounds(coords[0], coords[0])
                      );
                      map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
                    }}
                    className="w-full text-left hover:bg-gray-50 p-1 rounded"
                  >
                    <div className="font-semibold">{farm.name}</div>
                    <div className="text-xs text-gray-500">
                      {farm.coords.length} points
                    </div>
                    <div className="text-xs text-blue-600">
                      {formatAreaSqm(farm.area)}
                    </div>
                  </button>
                  <button
                    onClick={() => fetchNDVIReport(farm)}
                    className="mt-2 w-full rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
                  >
                    📊 NDVI Report
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showReport && selectedFarmForReport && (
        <div className="absolute bottom-4 right-4 z-20 max-h-[calc(100vh-120px)] max-w-2xl overflow-y-auto rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between bg-white rounded-t-2xl p-4 border-b">
            <h3 className="text-lg font-bold">NDVI Report - {selectedFarmForReport.name}</h3>
            <button
              onClick={() => setShowReport(false)}
              className="rounded-full bg-red-500 px-3 py-1 text-sm font-semibold text-white hover:bg-red-600"
            >
              ✕ Close
            </button>
          </div>
          <div className="bg-white rounded-b-2xl p-4">
            <NDVIReport
              stats={ndviData?.stats}
              farmName={selectedFarmForReport.name}
              area={selectedFarmForReport.area}
              error={reportError}
              loading={ndviLoading}
            />
          </div>
        </div>
      )}
    </div>
  );
}