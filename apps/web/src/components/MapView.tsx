import { useEffect, useState } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LocateFixed, MapPinned } from 'lucide-react';
import type { Trip } from '../types';

const busIcon = L.divIcon({
  className: 'bus-marker-wrapper',
  html: '<div class="bus-marker"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 11h14M8 3v8m8-8v8M8 20v2m8-2v2M8 15h.01M16 15h.01"/></svg></div>',
  iconSize: [42, 48],
  iconAnchor: [21, 43],
});
function Follow({ trip, recenter }: { trip: Trip | undefined; recenter: number }) {
  const map = useMap();
  useEffect(() => {
    if (trip?.latestPosition)
      map.setView([trip.latestPosition.latitude, trip.latestPosition.longitude], 15, {
        animate: false,
      });
  }, [trip?._id, recenter]);
  return null;
}
export function MapView({ trips, selected }: { trips: Trip[]; selected?: string }) {
  const [failed, setFailed] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const chosen = trips.find((t) => t._id === selected) || trips.find((t) => t.latestPosition);
  const tileUrl =
    import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution =
    import.meta.env.VITE_MAP_ATTRIBUTION ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  return (
    <div className="map-view">
      <MapContainer
        center={[23.7337, 90.3928]}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url={tileUrl}
          attribution={attribution}
          eventHandlers={{ tileerror: () => setFailed(true) }}
        />
        {trips
          .filter((t) => t.latestPosition && t.status === 'ACTIVE')
          .map((trip) => {
            const p = trip.latestPosition!;
            return (
              <Marker
                key={trip._id}
                position={[p.latitude, p.longitude]}
                icon={busIcon}
                opacity={trip.freshness === 'LIVE' ? 1 : 0.5}
              >
                <Popup>
                  <strong>{trip.isDemo ? 'DEVELOPMENT DEMO' : 'Active bus trip'}</strong>
                  <br />
                  {trip.freshness} · Last measured{' '}
                  {new Date(p.observedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka' })}
                  <br />
                  {p.simulated ? 'SYNTHETIC coordinates' : 'Driver GPS measurement'}
                  <br />
                  {p.accuracy != null
                    ? `Reported accuracy ±${Math.round(p.accuracy)} m`
                    : 'Accuracy unavailable'}
                </Popup>
                {p.accuracy != null && (
                  <Circle
                    center={[p.latitude, p.longitude]}
                    radius={Math.min(p.accuracy, 5000)}
                    pathOptions={{ color: '#a80f24', fillOpacity: 0.06, weight: 1 }}
                  />
                )}
              </Marker>
            );
          })}
        <Follow trip={chosen} recenter={recenter} />
      </MapContainer>
      <button
        className="icon-button map-recenter"
        onClick={() => setRecenter((n) => n + 1)}
        aria-label="Recenter on last measured bus position"
        disabled={!chosen?.latestPosition}
      >
        <LocateFixed size={22} />
      </button>
      {failed && (
        <div className="map-tile-error" role="status">
          <MapPinned size={17} /> Map tiles unavailable. Measured bus data and routes remain usable.
        </div>
      )}
      {!trips.some((t) => t.latestPosition) && (
        <div className="map-empty">
          <MapPinned size={24} />
          <strong>এখন কোনো GPS অবস্থান নেই</strong>
          <span>Map is centered on the campus area, not a bus location.</span>
        </div>
      )}
    </div>
  );
}
