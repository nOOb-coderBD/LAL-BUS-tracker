import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BusFront,
  CheckCircle2,
  Clock3,
  Crosshair,
  MapPin,
  Navigation,
  Play,
  Radio,
  Square,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, ErrorMessage, post, useConnectivity } from '../api';
import type { Bus, Collection, Route, Trip } from '../types';

export function Driver() {
  const client = useQueryClient();
  const online = useConnectivity();
  const buses = useQuery({
    queryKey: ['assigned-buses'],
    queryFn: () => api<Collection<Bus>>('/buses?assigned=true&limit=100'),
  });
  const routes = useQuery({
    queryKey: ['routes', ''],
    queryFn: () => api<Collection<Route>>('/routes?limit=100'),
  });
  const active = useQuery({
    queryKey: ['driver-trip'],
    queryFn: () => api<{ item: Trip | null }>('/driver/trips/active'),
    refetchInterval: 10_000,
  });
  const [busId, setBusId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [direction, setDirection] = useState('UP');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [gpsMessage, setGpsMessage] = useState('GPS is not sharing.');
  const [sharing, setSharing] = useState(false);
  const [lastAccepted, setLastAccepted] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const inFlight = useRef(false);
  const wanted = useRef(false);
  const activeId = useRef<string | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const watchGeneration = useRef(0);
  const trip = active.data?.item;
  activeId.current = trip?._id || null;
  const selectedBus = buses.data?.items.find((b) => b._id === busId);
  const availableRoutes =
    routes.data?.items.filter((r) => selectedBus?.routeIds.includes(r._id)) || [];
  useEffect(() => {
    if (!busId && buses.data?.items.length) setBusId(buses.data.items[0]._id);
  }, [buses.data]);
  useEffect(() => {
    if (!availableRoutes.some((r) => r._id === routeId)) setRouteId(availableRoutes[0]?._id || '');
  }, [busId, routes.data]);
  function stopWatch() {
    watchGeneration.current++;
    inFlight.current = false;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
    void wakeLock.current?.release();
    wakeLock.current = null;
  }
  async function beginSharing(id: string) {
    wanted.current = true;
    stopWatch();
    const generation = watchGeneration.current;
    setError(null);
    if (!window.isSecureContext) {
      setGpsMessage('HTTPS is required on a phone. Plain HTTP over LAN cannot request GPS.');
      return;
    }
    if (!navigator.geolocation) {
      setGpsMessage('This browser does not support location sharing.');
      return;
    }
    setGpsMessage('Waiting for precise location permission and a measured GPS reading…');
    if ('wakeLock' in navigator) {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (generation !== watchGeneration.current || !wanted.current) {
          void lock.release();
          return;
        }
        wakeLock.current = lock;
      } catch {
        /* Optional capability: foreground warning remains visible. */
      }
    }
    if (generation !== watchGeneration.current || !wanted.current) return;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        if (
          generation !== watchGeneration.current ||
          !wanted.current ||
          document.visibilityState !== 'visible' ||
          inFlight.current ||
          Date.now() - lastSent.current < 6000
        )
          return;
        setSharing(true);
        inFlight.current = true;
        lastSent.current = Date.now();
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        void post<{ item: Trip }>(`/driver/trips/${id}/locations`, {
          eventId: crypto.randomUUID(),
          latitude,
          longitude,
          accuracy,
          ...(heading !== null ? { heading } : {}),
          ...(speed !== null ? { speed } : {}),
          observedAt: new Date(position.timestamp).toISOString(),
        })
          .then((result) => {
            if (generation !== watchGeneration.current || !wanted.current) return;
            setLastAccepted(result.item.latestPosition?.receivedAt || null);
            setGpsMessage(`GPS accepted · reported accuracy ±${Math.round(accuracy)} m`);
            client.setQueryData(['driver-trip'], result);
          })
          .catch((err) => {
            if (generation !== watchGeneration.current) return;
            setError(err);
            setGpsMessage(
              'GPS report was not accepted. Students will see the last reading become stale/offline.',
            );
          })
          .finally(() => {
            if (generation === watchGeneration.current) inFlight.current = false;
          });
      },
      (err) => {
        if (err.code === 1) {
          wanted.current = false;
          stopWatch();
        } else setSharing(false);
        setGpsMessage(
          err.code === 1
            ? 'Location permission denied. Enable precise location in browser settings, then retry.'
            : err.code === 2
              ? 'GPS is temporarily unavailable. Still listening for recovery; move to a place with better reception. The bus will become stale/offline until a reading is accepted.'
              : 'GPS timed out. Still listening for recovery; keep this screen open. The bus will become stale/offline until a reading is accepted.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        stopWatch();
        setGpsMessage(
          'Sharing paused while the app is backgrounded. Keep this screen open during the trip.',
        );
      } else if (wanted.current && activeId.current) {
        lastSent.current = 0;
        void beginSharing(activeId.current);
        void active.refetch();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', visibility);
      wanted.current = false;
      watchGeneration.current++;
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      void wakeLock.current?.release();
    };
  }, []);
  useEffect(() => {
    if (!trip && !active.isPending) {
      wanted.current = false;
      stopWatch();
    }
  }, [trip?._id, active.isPending]);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ item: Trip }>('/driver/trips/start', {
        busId,
        routeId,
        direction,
      });
      client.setQueryData(['driver-trip'], result);
      activeId.current = result.item._id;
      setConfirm(false);
      lastSent.current = 0;
      void beginSharing(result.item._id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function end() {
    if (!trip) return;
    wanted.current = false;
    stopWatch();
    setBusy(true);
    setError(null);
    try {
      await post(`/driver/trips/${trip._id}/end`);
      client.setQueryData(['driver-trip'], { item: null });
      setGpsMessage('Trip ended. Your location is no longer shared.');
      setLastAccepted(null);
    } catch (err) {
      setError(err);
      setGpsMessage(
        'GPS stopped on this phone, but ending the server trip failed. Retry End Trip when connected.',
      );
    } finally {
      setBusy(false);
    }
  }
  const elapsed = trip
    ? Math.max(0, Math.floor((now - new Date(trip.startedAt).getTime()) / 1000))
    : 0;
  const elapsedLabel = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div className="container section">
      <div className="page-heading">
        <div>
          <p className="section-kicker">THE JOURNEY STARTS WITH YOU</p>
          <h1>চালকের ড্যাশবোর্ড</h1>
          <p>শুধু অনুমোদিত বাসে, সক্রিয় ট্রিপের সময় অবস্থান শেয়ার করুন।</p>
        </div>
        <span className={`badge ${online ? 'live' : 'warning'}`}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />} {online ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="safety">
        <AlertTriangle size={23} />
        <div>
          <strong>নিরাপত্তা সবার আগে।</strong>
          <p>
            Do not operate the phone while driving; ask an assistant to set up the tracking.
            Foreground PWA GPS can pause when the phone locks or the app is backgrounded.
          </p>
        </div>
      </div>
      <ErrorMessage error={error || active.error || buses.error} />
      <div className="driver-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>
              <BusFront size={22} /> {trip ? 'সক্রিয় ট্রিপ' : 'নতুন ট্রিপ শুরু করুন'}
            </h2>
            {trip?.isDemo && <span className="badge demo">DEVELOPMENT DEMO</span>}
          </div>
          {trip ? (
            <>
              <div className="active-trip-summary">
                <span className="badge live">
                  <Radio size={13} /> TRIP ACTIVE · {trip.freshness || 'OFFLINE'}
                </span>
                <h2>
                  {buses.data?.items.find((b) => b._id === trip.busId)?.displayNameBn ||
                    'Your assigned bus'}
                </h2>
                <p>
                  {routes.data?.items.find((r) => r._id === trip.routeId)?.nameBn} ·{' '}
                  {trip.direction}
                </p>
                <div className="trip-timer">
                  <Clock3 size={20} />
                  {elapsedLabel}
                </div>
                <p className="muted">
                  A trip being active does not mean its GPS is live. Check the last accepted
                  reading.
                </p>
              </div>
              <div className="trip-controls">
                <button
                  className="button primary"
                  data-testid="gps-start"
                  onClick={() => void beginSharing(trip._id)}
                  disabled={sharing || busy}
                >
                  <Crosshair size={19} />
                  {sharing ? 'GPS sharing enabled' : 'GPS শেয়ার / Resume'}
                </button>
                <button
                  className="button danger"
                  data-testid="driver-end"
                  onClick={() => void end()}
                  disabled={busy}
                >
                  <Square size={19} /> End Trip · ট্রিপ শেষ করুন
                </button>
              </div>
            </>
          ) : (
            <div className="form-stack">
              <label className="field">
                অনুমোদিত বাস · Assigned bus
                <select value={busId} onChange={(e) => setBusId(e.target.value)}>
                  <option value="">Select your approved bus</option>
                  {buses.data?.items.map((bus) => (
                    <option key={bus._id} value={bus._id}>
                      {bus.displayNameBn}
                      {bus.isDemo ? ' · DEMO' : ''} · {bus.fleetNumber || 'Fleet no. not confirmed'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                রুট · Route
                <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                  <option value="">Select assigned route</option>
                  {availableRoutes.map((route) => (
                    <option value={route._id} key={route._id}>
                      {route.nameBn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                দিক · Direction
                <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="UP">আপ · UP</option>
                  <option value="DOWN">ডাউন · DOWN</option>
                </select>
              </label>
              <Dialog.Root open={confirm} onOpenChange={setConfirm}>
                <Dialog.Trigger asChild>
                  <button
                    className="button primary"
                    data-testid="driver-start"
                    disabled={!busId || !routeId || !online || busy}
                  >
                    <Play size={20} /> Start Trip · ট্রিপ শুরু করুন
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-overlay" />
                  <Dialog.Content className="dialog-content">
                    <span className="brand-icon">
                      <Navigation size={24} />
                    </span>
                    <Dialog.Title>ট্রিপ শুরু করতে প্রস্তুত?</Dialog.Title>
                    <Dialog.Description>
                      Confirm while safely parked. Starting this trip requests precise location
                      permission and begins foreground sharing for your assigned bus. Keep the app
                      visible during the trip.
                    </Dialog.Description>
                    <div className="trip-controls">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void start()}
                      >
                        <Play size={18} /> Confirm Start Trip
                      </button>
                      <Dialog.Close asChild>
                        <button className="button secondary" disabled={busy}>
                          Cancel
                        </button>
                      </Dialog.Close>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              {!buses.data?.items.length && (
                <div className="notice">
                  No approved bus is assigned. Ask the administrator to approve your driver profile
                  and bus assignment.
                </div>
              )}
            </div>
          )}
        </section>
        <aside>
          <section className={`gps-status ${sharing ? 'is-sharing' : ''}`}>
            <span className="stat-icon">
              <MapPin size={25} />
            </span>
            <h2>GPS & connection</h2>
            <p role="status">{gpsMessage}</p>
            <div className="gps-metrics">
              <div>
                <span>Foreground</span>
                <strong>{document.visibilityState === 'visible' ? 'Visible' : 'Background'}</strong>
              </div>
              <div>
                <span>Last accepted</span>
                <strong>
                  {lastAccepted || trip?.latestPosition?.receivedAt
                    ? new Date(lastAccepted || trip!.latestPosition!.receivedAt).toLocaleTimeString(
                        'en-GB',
                        { timeZone: 'Asia/Dhaka' },
                      )
                    : 'No reading yet'}
                </strong>
              </div>
              <div>
                <span>Accuracy</span>
                <strong>
                  {trip?.latestPosition?.accuracy != null
                    ? `±${Math.round(trip.latestPosition.accuracy)} m`
                    : 'Unavailable'}
                </strong>
              </div>
            </div>
          </section>
          <div className="notice">
            <CheckCircle2 size={20} />
            <span>
              Keep this screen in the foreground with precise location enabled. Only measured phone
              readings are sent, approximately every 6 seconds when available.
            </span>
          </div>
          <div className="notice slim">
            <Navigation size={17} />
            <span>
              Development simulation is available through <code>npm run demo:trip</code>. Synthetic
              locations are explicitly labeled and allowed only for demo trips.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
