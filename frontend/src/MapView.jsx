import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fmtInt, fmtMoney, fmtMoneyShort } from "./format.js";

// Sequential single-hue ramp (reference palette blue). Magnitude always gains contrast
// against the surface, so the ramp runs light->dark on light maps and dark->light on dark maps.
const RAMP_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const RAMP_DARK = [...RAMP_LIGHT].reverse();

const dark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;
const esri = (name) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`;

function quantileBreaks(values, k) {
  const v = [...values].sort((a, b) => a - b);
  return Array.from({ length: k - 1 }, (_, i) => v[Math.floor(((i + 1) * v.length) / k)]);
}

const fmtPct = (x) => `${x > 0 ? "+" : ""}${x}%`;

export default function MapView({ armsLength, years, selected, onSelectPlace, onAsk }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pointsRef = useRef(null);
  const [fc, setFc] = useState(null);
  const [metric, setMetric] = useState("median");
  const [focusCode, setFocusCode] = useState(null);
  const [points, setPoints] = useState(null);
  const isDark = dark();
  const ramp = isDark ? RAMP_DARK : RAMP_LIGHT;

  // Map, basemap and a labels layer that sits above the colored shapes.
  useEffect(() => {
    const map = L.map(el.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      preferCanvas: true,
      minZoom: 9,
      maxBounds: [
        [39.9, -80.8],
        [41.0, -79.3],
      ],
    });
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    map.createPane("labels").style.zIndex = 450;
    map.getPane("labels").style.pointerEvents = "none";
    const base = isDark ? "World_Dark_Gray" : "World_Light_Gray";
    L.tileLayer(esri(`${base}_Base`), {
      maxZoom: 16,
      attribution: "Basemap &copy; Esri, HERE, Garmin, OpenStreetMap contributors · Boundaries: Allegheny County parcels",
    }).addTo(map);
    L.tileLayer(esri(`${base}_Reference`), { maxZoom: 16, pane: "labels" }).addTo(map);
    map.fitBounds(
      [
        [40.2, -80.36],
        [40.67, -79.69],
      ],
      { paddingTopLeft: [240, 10] } // leave room for the legend panel
    );
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
    mapRef.current = map;
    el.current.__map = map; // handle for the scripted demo recorder (demo/record.js)
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = new URLSearchParams({ arms_length_only: armsLength, year_from: years[0], year_to: years[1] });
    fetch(`/api/map?${q}`)
      .then((r) => r.json())
      .then(setFc);
  }, [armsLength, years]);

  const canChange = years[1] > years[0];
  const key = metric === "change" && canChange ? "change" : "median";
  const breaks = useMemo(() => {
    if (!fc) return [];
    const vals = fc.features.map((f) => f.properties[key]).filter((v) => v != null);
    return vals.length ? quantileBreaks(vals, ramp.length) : [];
  }, [fc, key, ramp.length]);

  const colorFor = (v) => {
    let i = 0;
    while (i < breaks.length && v >= breaks[i]) i++;
    return ramp[i];
  };

  const focus = fc?.features.find((f) => f.properties.municode === focusCode)?.properties ?? null;

  // Choropleth.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fc) return;
    layerRef.current?.remove();
    const chosen = new Set(selected.filter(Boolean));
    const edge = isDark ? "#0b0b0b" : "#ffffff";
    const style = (p) => {
      const v = p[key];
      const exact = chosen.has(p.name) || p.municode === focusCode;
      const inGroup = chosen.has(p.muni_group);
      return {
        color: exact || inGroup ? "#eb6834" : edge,
        weight: exact ? 3 : inGroup ? 1.2 : 0.7,
        opacity: 1,
        fillColor: v == null ? (isDark ? "#3a3a37" : "#c9c8c2") : colorFor(v),
        fillOpacity: v == null ? 0.55 : 0.68,
      };
    };
    const layer = L.geoJSON(fc, {
      style: (f) => style(f.properties),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        const v = p[key];
        const detail =
          v == null
            ? `<span class="tip-muted">Not enough sales to show (${key === "median" ? p.median_n : p.change_n.join(" → ")})</span>`
            : key === "median"
              ? `<b>${fmtMoney(v)}</b> <span class="tip-muted">· ${fmtInt(p.median_n)} sales</span>`
              : `<b>${fmtPct(v)}</b> <span class="tip-muted">· ${fmtInt(p.change_n[0])} → ${fmtInt(p.change_n[1])} sales</span>`;
        lyr.bindTooltip(`<div class="tip-name">${p.name}</div>${detail}`, {
          sticky: true,
          direction: "top",
          offset: [0, -8],
          className: "map-tip",
        });
        lyr.on({
          mouseover: (e) => {
            e.target.setStyle({ weight: 2.5, color: isDark ? "#ffffff" : "#0b0b0b" });
            e.target.bringToFront();
            pointsRef.current?.eachLayer((d) => d.bringToFront()); // never cover the sale dots
          },
          mouseout: (e) => e.target.setStyle(style(p)),
          click: () => {
            setFocusCode(p.municode);
            onSelectPlace(p.name);
            map.fitBounds(lyr.getBounds(), { paddingTopLeft: [300, 40], paddingBottomRight: [320, 40], maxZoom: 14 });
          },
        });
      },
    }).addTo(map);
    layerRef.current = layer;
    el.current.__shapes = layer;
    // Canvas draws in insertion order: keep the sale dots above the re-created shapes.
    pointsRef.current?.eachLayer((d) => d.bringToFront());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, key, breaks, selected, focusCode]);

  // Individual sales for the focused place.
  useEffect(() => {
    const map = mapRef.current;
    pointsRef.current?.remove();
    pointsRef.current = null;
    setPoints(null);
    if (!map || !focusCode) return;
    const q = new URLSearchParams({
      municode: focusCode,
      arms_length_only: armsLength,
      year_from: years[0],
      year_to: years[1],
    });
    let cancelled = false;
    fetch(`/api/sales_points?${q}`)
      .then((r) => r.json())
      .then((pts) => {
        if (cancelled) return;
        const group = L.featureGroup(
          pts.map((s) =>
            L.circleMarker([s.lat, s.lon], {
              radius: 3.5,
              color: isDark ? "#1a1a19" : "#ffffff",
              weight: 1.2,
              fillColor: "#eb6834",
              fillOpacity: 0.95,
            }).bindPopup(
              `<div class="tip-name">${s.address}</div><b>${fmtMoney(s.price)}</b> · ${s.date}<br><span class="tip-muted">${s.sale_type}</span>`
            )
          )
        ).addTo(map);
        pointsRef.current = group;
        el.current.__points = group;
        setPoints(pts.length);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCode, armsLength, years]);

  const fmtVal = (v) => (key === "median" ? fmtMoneyShort(v) : fmtPct(v));
  const label = fc ? (key === "median" ? fc.meta.median_label : fc.meta.change_label) : "Loading…";

  return (
    <section className="card map-card">
      <div className="map-wrap">
        <div className="map" ref={el} />

        <div className="map-panel">
          <div className="map-panel-title">{label}</div>
          <div className="seg small">
            <button className={key === "median" ? "on" : ""} onClick={() => setMetric("median")}>
              Median price
            </button>
            <button
              className={key === "change" ? "on" : ""}
              onClick={() => setMetric("change")}
              disabled={!canChange}
              title={canChange ? "" : "Pick at least two years"}
            >
              Price change
            </button>
          </div>
          {breaks.length > 0 && (
            <div className="ramp">
              <div className="ramp-bar">
                {ramp.map((c) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </div>
              <div className="ramp-labels">
                <span>{fmtVal(breaks[0])}</span>
                <span>{fmtVal(breaks[Math.floor(breaks.length / 2)])}</span>
                <span>{fmtVal(breaks.at(-1))}+</span>
              </div>
            </div>
          )}
          <div className="nodata-key">
            <span className="nodata-sw" /> Fewer than {fc?.meta.min_n ?? 30} sales
          </div>
          <div className="map-hint">Click a place to see its sales. Scroll to zoom after clicking the map.</div>
        </div>

        {focus && (
          <div className="map-detail">
            <button className="x close" aria-label="Close" onClick={() => setFocusCode(null)}>
              ×
            </button>
            <div className="detail-kicker">
              {focus.muni_group !== focus.name ? `${focus.muni_group} ward` : "Municipality"}
            </div>
            <div className="detail-name">{focus.name}</div>
            <div className="detail-grid">
              <div>
                <div className="detail-label">Median price</div>
                <div className="detail-value">{focus.median ? fmtMoney(focus.median) : "—"}</div>
                <div className="detail-note">{fmtInt(focus.median_n)} sales</div>
              </div>
              <div>
                <div className="detail-label">Price change</div>
                <div className="detail-value">{focus.change != null ? fmtPct(focus.change) : "—"}</div>
                <div className="detail-note">
                  {canChange ? `${fmtInt(focus.change_n[0])} → ${fmtInt(focus.change_n[1])} sales` : "needs 2+ years"}
                </div>
              </div>
            </div>
            {(focus.median == null || (canChange && focus.change == null)) && (
              <div className="detail-warn">
                Too few sales for a reliable figure ({fc.meta.min_n} needed). Try a wider year range or all priced sales.
              </div>
            )}
            <div className="detail-note dots">
              <span className="dot" /> {points == null ? "Loading sales…" : `${fmtInt(points)} sales on the map (click one)`}
            </div>
            <button
              className="btn wide"
              onClick={() =>
                onAsk(
                  `How have sale prices in ${focus.name} changed between ${years[0]} and ${years[1]}, and how reliable is that data?`
                )
              }
            >
              Ask Claude about {focus.name}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
