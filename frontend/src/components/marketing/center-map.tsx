"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import { LocateFixed, MapPin, Navigation, Phone } from "lucide-react";
import "leaflet/dist/leaflet.css";

import "./center-map.css";
import { CENTER } from "@/lib/config";
import { cn, formatPhone } from "@/lib/utils";

type CenterMapProps = {
  regionLabel: string;
  findUsLabel: string;
  directionsLabel: string;
  callLabel: string;
  recenterLabel: string;
  className?: string;
};

const POSITION: [number, number] = [CENTER.coords.lat, CENTER.coords.lng];

/** Brand pin rendered as an inline SVG divIcon — no image assets needed. */
function brandPinIcon() {
  return L.divIcon({
    className: "",
    iconSize: [44, 56],
    iconAnchor: [22, 54],
    html: `<div class="bw-pin"><span class="bw-pin__pulse"></span><svg viewBox="0 0 44 56" aria-hidden="true"><path d="M22 2C11.5 2 3 10.5 3 21c0 14.2 16.6 30.4 17.3 31.1a2.3 2.3 0 0 0 3.4 0C24.4 51.4 41 35.2 41 21 41 10.5 32.5 2 22 2Z" fill="#89F336" stroke="#101704" stroke-width="2.5"/><circle cx="22" cy="20" r="7.5" fill="#101704"/></svg></div>`,
  });
}

/**
 * Cursor (wheel) zoom stays OFF until the user shows intent — a click or
 * keyboard focus on the map — then turns on, and turns back off when the
 * cursor leaves. This gives wheel zoom on the map without trapping page
 * scroll for passers-by. Touch pinch-zoom is unaffected (always on).
 */
function WheelZoomGate() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const enable = () => map.scrollWheelZoom.enable();
    const disable = () => map.scrollWheelZoom.disable();
    container.addEventListener("click", enable);
    container.addEventListener("focusin", enable);
    container.addEventListener("mouseleave", disable);
    container.addEventListener("focusout", disable);
    return () => {
      container.removeEventListener("click", enable);
      container.removeEventListener("focusin", enable);
      container.removeEventListener("mouseleave", disable);
      container.removeEventListener("focusout", disable);
    };
  }, [map]);

  return null;
}

/**
 * On touch devices one-finger drag would hijack page scrolling, so dragging
 * stays off until the first tap on the map (pinch-zoom always works).
 */
function TouchDragGate() {
  const map = useMap();

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    map.dragging.disable();
    const container = map.getContainer();
    const enable = () => map.dragging.enable();
    container.addEventListener("click", enable);
    return () => container.removeEventListener("click", enable);
  }, [map]);

  return null;
}

function RecenterButton({ label }: { label: string }) {
  const map = useMap();
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        // Scale the flight time with the distance so far-out jumps
        // still animate smoothly instead of snapping.
        const gap = Math.abs(map.getZoom() - CENTER.mapZoom);
        map.flyTo(POSITION, CENTER.mapZoom, { duration: Math.min(0.6 + gap * 0.18, 2.2) });
      }}
      // Stacked above the Leaflet +/- control (bottom-right, ~72px tall).
      className="absolute right-2.5 bottom-24 z-10 inline-flex size-10 items-center justify-center rounded-xl border border-border bg-surface/90 text-fg shadow-lg backdrop-blur transition-colors hover:border-brand hover:text-brand"
    >
      <LocateFixed className="size-4.5" />
    </button>
  );
}

/** Clicking the brand pin flies all the way in on it (max zoom). */
function ZoomableMarker({ icon }: { icon: L.DivIcon }) {
  const map = useMap();
  return (
    <Marker
      position={POSITION}
      icon={icon}
      keyboard={false}
      eventHandlers={{
        click: () => {
          const gap = map.getMaxZoom() - map.getZoom();
          if (gap <= 0) return;
          map.flyTo(POSITION, map.getMaxZoom(), { duration: Math.min(0.6 + gap * 0.18, 2.4) });
        },
      }}
    />
  );
}

/**
 * Live interactive map of the center — dark-filtered OSM tiles (keyless),
 * custom brand pin, overlay info card with directions + call actions.
 * Client-only: always mounted through `center-map-dynamic` (ssr: false).
 */
export function CenterMap({
  regionLabel,
  findUsLabel,
  directionsLabel,
  callLabel,
  recenterLabel,
  className,
}: CenterMapProps) {
  const pinIcon = useMemo(() => brandPinIcon(), []);

  return (
    <div role="region" aria-label={regionLabel} className={cn("bw-map", className)}>
      <MapContainer
        center={POSITION}
        zoom={CENTER.mapZoom}
        minZoom={4}
        maxZoom={19}
        zoomControl={false}
        scrollWheelZoom={false}
        attributionControl
      >
        {/*
          OSM standard raster tiles (keyless, full street detail) with a
          CSS dark filter to match the dark-only theme (see center-map.css).
          To switch to CARTO dark_all later: register a free key and use
          https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=KEY
          with subdomains="abcd" — then drop the .leaflet-tile-pane filter.
        */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <ZoomControl position="bottomright" />
        <ZoomableMarker icon={pinIcon} />
        <WheelZoomGate />
        <TouchDragGate />
        <RecenterButton label={recenterLabel} />
      </MapContainer>

      {/*
        Overlay info card. On phones it collapses to a slim top bar
        (truncated address + icon buttons) so the map and pin stay visible;
        full card with text buttons on sm+.
      */}
      <div className="absolute inset-x-3 top-3 z-10 sm:inset-x-auto sm:top-4 sm:left-4 sm:max-w-xs">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface/90 p-2 pl-3 shadow-xl backdrop-blur-md sm:block sm:p-4">
          <p className="hidden items-center gap-1.5 text-xs font-semibold tracking-wide text-brand-subtle-fg uppercase sm:flex">
            <MapPin className="size-3.5" />
            {findUsLabel}
          </p>
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg sm:mt-1.5 sm:text-sm sm:whitespace-normal">
            {CENTER.address}
          </p>
          <div className="flex shrink-0 gap-1.5 sm:mt-3 sm:flex-wrap sm:gap-2">
            <a
              href={CENTER.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={directionsLabel}
              className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-brand text-brand-fg transition-colors duration-fast hover:bg-brand-hover sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3.5 sm:text-sm sm:font-semibold"
            >
              <Navigation className="size-4" />
              <span className="hidden sm:inline">{directionsLabel}</span>
            </a>
            <a
              href={`tel:${CENTER.phone.replace(/\s/g, "")}`}
              aria-label={`${callLabel} · ${formatPhone(CENTER.phone)}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-bg text-fg transition-colors hover:border-brand hover:text-brand sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3.5 sm:text-sm sm:font-semibold"
            >
              <Phone className="size-4" />
              <span className="hidden sm:inline">
                {callLabel} · {formatPhone(CENTER.phone)}
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
