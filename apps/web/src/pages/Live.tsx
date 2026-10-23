import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { freshness } from '@lal/shared';
import { BusFront, Clock3, MapPin, Navigation, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ErrorMessage, useAuth } from '../api';
import { MapView } from '../components/MapView';
import type { Bus, Collection, Route, Trip } from '../types';

export function Live() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState('');
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState('');
  const [socketError, setSocketError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const trips = useQuery({
    queryKey: ['active-trips'],
    queryFn: () => api<Collection<Trip>>('/trips/active?limit=100'),
    refetchInterval: 10_000,
  });
  const routes = useQuery({
    queryKey: ['routes', ''],
    queryFn: () => api<Collection<Route>>('/routes?limit=100'),
  });
  const buses = useQuery({
    queryKey: ['buses'],
    queryFn: () => api<Collection<Bus>>('/buses?limit=100'),
  });
  const ids =
    trips.data?.items
      .map((t) => t._id)
      .sort()
      .join(',') || '';
  useEffect(() => {
    if (!user) return;
    const socket = io({
      transports: ['websocket'],
      withCredentials: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5,
    });
    const update = (trip: Trip) => {
      if (!trip?._id) return;
      client.setQueryData<Collection<Trip>>(['active-trips'], (old) => {
        if (!old) return old;
        const previous = old.items.find((t) => t._id === trip._id);
        if (previous && previous.version > trip.version) return old;
        const items =
          trip.status === 'ENDED'
            ? old.items.filter((t) => t._id !== trip._id)
            : old.items.map((t) => (t._id === trip._id ? trip : t));
        return { ...old, items, total: items.length };
      });
    };
    socket.on('connect', () => {
      setConnected(true);
      setSocketError('');
      for (const tripId of ids.split(',').filter(Boolean))
        socket.emit(
          'subscribe:trip',
          { tripId },
          (result: { ok: boolean; item?: Trip; error?: unknown }) => {
            if (result.ok && result.item) update(result.item);
            else if (!result.ok)
              setSocketError('Live subscription was denied. Refresh your session.');
          },
        );
      void client.invalidateQueries({ queryKey: ['active-trips'] });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      setConnected(false);
      setSocketError(
        'Live connection interrupted. Retrying; HTTP snapshots refresh every 10 seconds.',
      );
    });
    socket.on('trip:location', update);
    socket.on('trip:stale', update);
    socket.on('bus:status', update);
    socket.on('trip:ended', (event: Trip & { tripId?: string }) => {
      const id = event._id || event.tripId;
      client.setQueryData<Collection<Trip>>(['active-trips'], (old) =>
        old ? { ...old, items: old.items.filter((t) => t._id !== id) } : old,
      );
      setNotice('ট্রিপ শেষ হয়েছে · Driver sharing has ended. This bus is no longer live.');
      void client.invalidateQueries({ queryKey: ['active-trips'] });
    });
    return () => {
      for (const tripId of ids.split(',').filter(Boolean))
        socket.emit('unsubscribe:trip', { tripId });
      socket.disconnect();
    };
  }, [user?._id, ids, client]);
  const rank = { LIVE: 0, STALE: 1, OFFLINE: 2, ENDED: 3 };
  const items =
    trips.data?.items
      .filter((t) => !params.get('routeId') || t.routeId === params.get('routeId'))
      .map((trip) => {
        const local = freshness(trip.status, trip.latestPosition?.receivedAt, now);
        return { ...trip, freshness: rank[local] > rank[trip.freshness] ? local : trip.freshness };
      }) || [];
  const chosen = items.find((t) => t._id === selected) || items[0];
  return (
    <div className="container section">
      <div className="page-heading">
        <div>
          <p className="section-kicker">YOUR CAMPUS, CONNECTED</p>
          <h1>লাইভ বাস ট্র্যাকিং</h1>
          <p>চালকের শেয়ার করা সর্বশেষ অবস্থান, আপনার সামনে।</p>
        </div>
        <div className="header-actions">
          <span className={`badge ${connected ? 'live' : 'warning'}`}>
            <span className="live-dot" />
            {connected ? 'Connected' : 'Reconnecting'}
          </span>
          <button
            className="icon-button"
            onClick={() => void trips.refetch()}
            aria-label="Refresh trips"
          >
            <RefreshCw size={19} />
          </button>
        </div>
      </div>
      <ErrorMessage error={trips.error} />
      {socketError && <div className="notice slim">{socketError}</div>}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="map-layout">
        <aside className="trip-list">
          <div className="panel-header">
            <h2>
              <Radio size={19} /> সক্রিয় ট্রিপ
            </h2>
            <span className="badge neutral">{items.length}</span>
          </div>
          {items.length ? (
            items.map((trip) => {
              const bus = buses.data?.items.find((b) => b._id === trip.busId);
              const route = routes.data?.items.find((r) => r._id === trip.routeId);
              return (
                <button
                  key={trip._id}
                  onClick={() => setSelected(trip._id)}
                  className={`trip-card ${chosen?._id === trip._id ? 'active' : ''}`}
                >
                  <div className="trip-card-heading">
                    <span className="route-icon">
                      <BusFront size={22} />
                    </span>
                    <span className={`badge ${trip.freshness === 'LIVE' ? 'live' : 'warning'}`}>
                      {trip.freshness}
                    </span>
                  </div>
                  <h3>{bus?.displayNameBn || 'Assigned bus'}</h3>
                  <p>
                    {route?.nameBn || 'Route'} · {trip.direction}
                  </p>
                  {trip.isDemo && <span className="badge demo">DEVELOPMENT DEMO</span>}
                  <span className="trip-card-footer">
                    <Clock3 size={13} />
                    {trip.latestPosition
                      ? new Date(trip.latestPosition.observedAt).toLocaleTimeString('en-GB', {
                          timeZone: 'Asia/Dhaka',
                        })
                      : 'Waiting for first GPS'}
                    <span>{bus?.fleetNumber || 'Fleet no. unconfirmed'}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="empty-state compact">
              <BusFront size={35} />
              <h3>এই মুহূর্তে সক্রিয় বাস নেই</h3>
              <p>No driver is sharing an active trip for this selection.</p>
              <Link className="button secondary small" to="/routes">
                সময়সূচি দেখুন
              </Link>
            </div>
          )}
          <div className="notice slim">
            <ShieldCheck size={18} />
            <span>
              Precise locations are visible only to signed-in verified students and administrators.
            </span>
          </div>
        </aside>
        <section className="map-panel">
          <MapView trips={items} selected={chosen?._id} />
          <div className="map-info">
            <div>
              <span className="section-kicker">LAST ACCEPTED MEASUREMENT</span>
              <h3>
                {chosen
                  ? routes.data?.items.find((r) => r._id === chosen.routeId)?.nameBn ||
                    'Active trip'
                  : 'আপনার পরের যাত্রার অপেক্ষায়'}
              </h3>
            </div>
            {chosen?.latestPosition ? (
              <div className="position-details">
                <span>
                  <MapPin size={15} />
                  <span data-testid="live-coordinates">
                    {chosen.latestPosition.latitude.toFixed(6)},{' '}
                    {chosen.latestPosition.longitude.toFixed(6)}
                  </span>
                </span>
                <span>
                  Accuracy:{' '}
                  {chosen.latestPosition.accuracy != null
                    ? `±${chosen.latestPosition.accuracy} m`
                    : 'not provided'}
                </span>
                <span>
                  Observed{' '}
                  {new Date(chosen.latestPosition.observedAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Dhaka',
                  })}{' '}
                  · Dhaka
                </span>
                {chosen.latestPosition.simulated && (
                  <span className="badge demo">SYNTHETIC GPS · NOT A REAL BUS POSITION</span>
                )}
              </div>
            ) : (
              <p className="muted">
                No measured coordinates are available. Scheduled departures are not arrival
                predictions.
              </p>
            )}
          </div>
        </section>
      </div>
      <div className="notice">
        <Navigation size={20} />
        <span>
          GPS freshness is separate from trip state. LIVE requires a recent accepted reading; STALE
          and OFFLINE buses may still have an active trip. No estimated arrival time is invented.
        </span>
      </div>
    </div>
  );
}
