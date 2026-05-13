"use client";

import React from "react";

interface NDVIStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  p25?: number;
  p75?: number;
  percentageVegetation: number;
  pixelCount: number;
}

interface TimeseriesData {
  date: string;
  value: number;
}

interface NDVIReportProps {
  stats?: NDVIStats;
  timeseries?: TimeseriesData[];
  previewData?: any;
  loading?: boolean;
  error?: string | null;
  farmName?: string;
  area?: number;
}

export default function NDVIReport({
  stats,
  timeseries,
  previewData,
  loading,
  error,
  farmName,
  area,
}: NDVIReportProps) {
  const calculateStats = (ndviValues: number[]): NDVIStats | null => {
    if (!ndviValues || ndviValues.length === 0) return null;

    const sorted = [...ndviValues].sort((a, b) => a - b);
    const min = Math.min(...ndviValues);
    const max = Math.max(...ndviValues);
    const mean = ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length;
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    const variance =
      ndviValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      ndviValues.length;
    const stdDev = Math.sqrt(variance);

    // Healthy vegetation typically has NDVI > 0.5
    const vegetationCount = ndviValues.filter((v) => v > 0.5).length;
    const percentageVegetation = (vegetationCount / ndviValues.length) * 100;

    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p75 = sorted[Math.floor(sorted.length * 0.75)];

    return {
      min,
      max,
      mean,
      median,
      stdDev,
      p25,
      p75,
      percentageVegetation,
      pixelCount: ndviValues.length,
    };
  };

  const extractNDVIValues = (): number[] => {
    if (!previewData) return [];

    // Handle different data formats
    if (Array.isArray(previewData)) {
      return previewData.filter((v) => typeof v === "number");
    }

    if (previewData.data && Array.isArray(previewData.data)) {
      return previewData.data;
    }

    if (previewData.values && Array.isArray(previewData.values)) {
      return previewData.values;
    }

    return [];
  };

  // Get stats from props or calculate from data
  const displayStats = stats || calculateStats(extractNDVIValues());

  const getHealthStatus = (ndvi: number): { label: string; color: string } => {
    if (ndvi < 0) return { label: "Water/Cloud", color: "text-blue-600" };
    if (ndvi < 0.2) return { label: "Non-vegetated", color: "text-red-600" };
    if (ndvi < 0.4) return { label: "Sparse Vegetation", color: "text-yellow-600" };
    if (ndvi < 0.6) return { label: "Moderate Vegetation", color: "text-green-500" };
    return { label: "Dense Vegetation", color: "text-green-700" };
  };

  const meanHealth = displayStats ? getHealthStatus(displayStats.mean) : null;

  return (
    <div className="w-full bg-white rounded-lg shadow-lg p-6 border border-gray-200">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">NDVI Data Report</h2>
        {farmName && (
          <p className="text-gray-600">
            Farm: <span className="font-semibold">{farmName}</span>
          </p>
        )}
        {area && (
          <p className="text-gray-600">
            Area: <span className="font-semibold">{(area / 10000).toFixed(2)} hectares</span>
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          <span className="ml-3 text-gray-600">Loading NDVI data...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 font-semibold">Error loading data</p>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && displayStats && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <p className="text-gray-600 text-sm font-semibold">Mean NDVI</p>
              <p className={`text-3xl font-bold ${meanHealth?.color || "text-green-600"}`}>
                {displayStats.mean.toFixed(3)}
              </p>
              <p className="text-xs text-gray-600 mt-1">{meanHealth?.label}</p>
            </div>

            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-gray-600 text-sm font-semibold">Median NDVI</p>
              <p className="text-3xl font-bold text-blue-600">
                {displayStats.median.toFixed(3)}
              </p>
            </div>

            <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
              <p className="text-gray-600 text-sm font-semibold">Std. Deviation</p>
              <p className="text-3xl font-bold text-purple-600">
                {displayStats.stdDev.toFixed(3)}
              </p>
            </div>

            <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
              <p className="text-gray-600 text-sm font-semibold">Min NDVI</p>
              <p className="text-3xl font-bold text-orange-600">
                {displayStats.min.toFixed(3)}
              </p>
            </div>

            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <p className="text-gray-600 text-sm font-semibold">Max NDVI</p>
              <p className="text-3xl font-bold text-red-600">
                {displayStats.max.toFixed(3)}
              </p>
            </div>

            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
              <p className="text-gray-600 text-sm font-semibold">Vegetation Cover</p>
              <p className="text-3xl font-bold text-emerald-600">
                {displayStats.percentageVegetation.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Detailed Statistics */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Detailed Statistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-700">Total Pixels Analyzed:</span>
                <span className="font-semibold text-gray-900">
                  {displayStats.pixelCount.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-700">NDVI Range:</span>
                <span className="font-semibold text-gray-900">
                  {displayStats.min.toFixed(3)} to {displayStats.max.toFixed(3)}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-700">Range Span:</span>
                <span className="font-semibold text-gray-900">
                  {(displayStats.max - displayStats.min).toFixed(3)}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-700">Coefficient of Variation:</span>
                <span className="font-semibold text-gray-900">
                  {displayStats.mean !== 0
                    ? ((displayStats.stdDev / displayStats.mean) * 100).toFixed(2)
                    : "N/A"}
                  %
                </span>
              </div>

              {displayStats.p25 !== undefined && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200">
                  <span className="text-gray-700">25th Percentile (Q1):</span>
                  <span className="font-semibold text-gray-900">
                    {displayStats.p25.toFixed(3)}
                  </span>
                </div>
              )}

              {displayStats.p75 !== undefined && (
                <div className="flex justify-between items-center py-2 border-b border-gray-200">
                  <span className="text-gray-700">75th Percentile (Q3):</span>
                  <span className="font-semibold text-gray-900">
                    {displayStats.p75.toFixed(3)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Health Assessment */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">Health Assessment</h3>
            <div className="space-y-2">
              <p className="text-gray-700">
                <span className="font-semibold">Overall Status:</span>{" "}
                <span className={meanHealth?.color}>{meanHealth?.label}</span>
              </p>
              <p className="text-gray-700">
                <span className="font-semibold">Vegetation Coverage:</span> Approximately{" "}
                <span className="font-semibold text-green-600">
                  {displayStats.percentageVegetation.toFixed(1)}%
                </span>{" "}
                of the area has healthy vegetation (NDVI &gt; 0.5)
              </p>
              <p className="text-gray-700 text-sm mt-3">
                {displayStats.mean > 0.6
                  ? "✓ Excellent vegetation health detected. Continue monitoring for maintenance."
                  : displayStats.mean > 0.4
                    ? "⚠ Moderate vegetation detected. Consider irrigation or nutrient assessment."
                    : displayStats.mean > 0.2
                      ? "⚠ Low vegetation index. Immediate intervention recommended."
                      : "✗ Critical: Very low vegetation detected. Urgent assessment needed."}
              </p>
            </div>
          </div>

          {/* NDVI Classification */}
          <div className="mt-6 bg-gray-50 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">NDVI Classification Guide</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-blue-500 rounded"></div>
                <span>
                  <strong>&lt; 0:</strong> Water bodies and clouds
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-red-500 rounded"></div>
                <span>
                  <strong>0 - 0.2:</strong> Non-vegetated (soil, urban)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-yellow-500 rounded"></div>
                <span>
                  <strong>0.2 - 0.4:</strong> Sparse vegetation
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-green-500 rounded"></div>
                <span>
                  <strong>0.4 - 0.6:</strong> Moderate vegetation
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-green-700 rounded"></div>
                <span>
                  <strong>&gt; 0.6:</strong> Dense, healthy vegetation
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && !error && !displayStats && (
        <div className="text-center py-8">
          <p className="text-gray-500">No NDVI data available. Draw a boundary and fetch data to generate the report.</p>
        </div>
      )}
    </div>
  );
}
