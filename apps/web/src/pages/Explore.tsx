import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BusFront,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Heart,
  MapPin,
  Navigation,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, ErrorMessage, Loading, useAuth } from '../api';
import type { Bus, Collection, Route, Schedule } from '../types';

export function VerificationBadge({ status }: { status: string }) {
  return status === 'VERIFIED' ? (
    <span className="badge live">
      <Check size={12} /> Admin reviewed
    </span>
  ) : (
    <span className="badge warning">Schedule needs confirmation</span>
  );
}
export function timeLabel(value: string) {
  const [h, m] = value.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
export function Home({ routesOnly = false }: { routesOnly?: boolean }) {
  const [search, setSearch] = useState('');
  const { user } = useAuth();
  const routes = useQuery({
    queryKey: ['routes', search],
    queryFn: () => api<Collection<Route>>(`/routes?limit=100&search=${encodeURIComponent(search)}`),
  });
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () =>
      api<{
        routeCount: number;
        scheduleCount: number;
        activeTripCount: number;
        demoActiveTripCount: number;
      }>('/stats'),
    refetchInterval: 15_000,
  });
  return (
    <>
      {!routesOnly && (
        <section className="hero">
          <div className="container hero-inner">
            <motion.div
              className="hero-content"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
            >
              <div className="eyebrow">
                <span className="live-dot" /> ঢাকা বিশ্ববিদ্যালয়ের পথে, একসাথে
              </div>
              <h1 className="hero-title">
                প্রিয় লাল বাস,
                <br />
                <em>এখন হাতের মুঠোয়।</em>
              </h1>
              <p className="hero-description">
                ক্যাম্পাসের পথে অপেক্ষাটা হোক একটু সহজ। আপনার রুট খুঁজুন, সময়সূচি দেখুন, আর চলন্ত
                বাসের অবস্থান জানুন এক জায়গায়।
              </p>
              <p className="hero-description english">
                Your campus. Your commute. A little less waiting.
              </p>
              <div className="hero-actions">
                <Link className="button primary" to={user ? '/live' : '/login'}>
                  <Navigation size={18} /> বাস ট্র্যাক করুন <ArrowUpRight size={18} />
                </Link>
                <a className="button secondary" href="#explore">
                  রুট খুঁজুন <ArrowRight size={18} />
                </a>
              </div>
              <div className="hero-proof">
                <span>
                  <ShieldCheck size={17} /> DU academic email access
                </span>
                <span>
                  <Heart size={16} /> Built for our community
                </span>
              </div>
            </motion.div>
            <motion.div
              className="hero-art"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65 }}
            >
              <div className="hero-art-label">
                <Sparkles size={14} /> THE JOURNEY FEELS LIKE HOME
              </div>
              <img
                src="/illustrations/heritage-bus.svg"
                alt="Original illustration of a crimson double-decker bus and campus-inspired architecture"
              />
              <div className="hero-badge">
                <span className="stat-icon">
                  <Radio size={20} />
                </span>
                <div>
                  <strong>একটুখানি নিশ্চিন্ত যাত্রা</strong>
                  <span>Live when a driver shares GPS</span>
                </div>
                <span className="live-dot" />
              </div>
              <span className="art-caption">A familiar red. A new way to find it.</span>
            </motion.div>
          </div>
        </section>
      )}
      <div className="container">
        {!routesOnly && (
          <section className="stats-grid" aria-label="Transport data summary">
            <div className="stat-card">
              <span className="stat-icon">
                <Compass size={23} />
              </span>
              <div>
                <div className="stat-value">
                  {stats.data?.routeCount ?? '—'}
                  <span>টি</span>
                </div>
                <div className="stat-label">
                  রুট এক ঠিকানায় <span>Routes to explore</span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Clock3 size={23} />
              </span>
              <div>
                <div className="stat-value">
                  {stats.data?.scheduleCount ?? '—'}
                  <span>টি</span>
                </div>
                <div className="stat-label">
                  সময়সূচির এন্ট্রি <span>Draft timetable entries</span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Radio size={23} />
              </span>
              <div>
                <div className="stat-value">
                  {stats.data?.activeTripCount ?? '—'}
                  <span className="live-dot" />
                </div>
                <div className="stat-label">
                  এখন সক্রিয় ট্রিপ <span>Real trips, excluding demos</span>
                </div>
              </div>
            </div>
          </section>
        )}
        <section className="section" id="explore">
          <div className="section-heading">
            <div>
              <p className="section-kicker">FIND YOUR WAY</p>
              <h2>
                আপনার রুট, আপনার লাল বাস<span>একটু খুঁজলেই কাছাকাছি।</span>
              </h2>
            </div>
            <span className="badge neutral">
              <MapPin size={13} /> ঢাকা বিশ্ববিদ্যালয়
            </span>
          </div>
          <div className="search-bar">
            <Search className="search-icon" size={20} />
            <input
              aria-label="Search routes"
              placeholder="বাসের নাম, রুট বা গন্তব্য দিয়ে খুঁজুন…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="search-hint">রুট খুঁজুন</span>
          </div>
          <div className="notice slim">
            <ShieldCheck size={17} />
            <span>
              সময়সূচি যাচাই চলছে · Screenshot schedules are preliminary. Confirm with the transport
              office before travelling.
            </span>
          </div>
          <ErrorMessage error={routes.error} />
          {routes.isPending ? (
            <Loading />
          ) : (
            <div className="route-grid">
              {routes.data?.items.map((route, i) => (
                <Link key={route._id} to={`/routes/${route._id}`} className="route-card">
                  <div className="route-card-top">
                    <span className={`route-icon route-color-${i % 4}`}>
                      <BusFront size={24} />
                    </span>
                    <ArrowUpRight size={20} className="route-arrow" />
                  </div>
                  <div className="route-name">{route.nameBn}</div>
                  <div className="route-subtitle">
                    {route.subtitle || 'ঢাকা বিশ্ববিদ্যালয় পরিবহন রুট'}
                  </div>
                  <div className="route-meta">
                    <span>
                      <MapPin size={13} />
                      {route.slug.replaceAll('-', ' ')}
                    </span>
                    <span>
                      সময়সূচি দেখুন <ChevronRight size={14} />
                    </span>
                  </div>
                  <VerificationBadge status={route.status} />
                </Link>
              ))}
            </div>
          )}
          {routes.data?.items.length === 0 && (
            <div className="empty-state">
              <Search size={32} />
              <h3>এই নামে রুট পাওয়া যায়নি</h3>
              <p>Try a Bengali route name, English slug, or another destination.</p>
              <button className="button secondary" onClick={() => setSearch('')}>
                সব রুট দেখুন
              </button>
            </div>
          )}
        </section>
        {!routesOnly && (
          <>
            <section className="section how-section">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">LESS GUESSING. MORE GOING.</p>
                  <h2>তিন ধাপে, নিশ্চিন্ত পথে।</h2>
                </div>
                <span className="muted">ক্যাম্পাসের সাথে, সবসময়।</span>
              </div>
              <div className="how-grid">
                {[
                  {
                    icon: Search,
                    title: 'আপনার রুট খুঁজুন',
                    text: 'বাসের নাম বা গন্তব্য দিয়ে রুট ও প্রাথমিক সময়সূচি দেখে নিন।',
                  },
                  {
                    icon: ShieldCheck,
                    title: 'বিশ্ববিদ্যালয়ের ইমেইলে প্রবেশ',
                    text: 'আপনার DU academic email যাচাই করে নিরাপদে লগইন করুন।',
                  },
                  {
                    icon: Navigation,
                    title: 'বাসের অবস্থান দেখুন',
                    text: 'চালক ট্রিপ চালু করে GPS শেয়ার করলে লাইভ ম্যাপে অবস্থান দেখুন।',
                  },
                ].map((step, i) => (
                  <div className="how-card" key={step.title}>
                    <span className="how-number">0{i + 1}</span>
                    <step.icon size={27} />
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="section faq-grid">
              <div>
                <p className="section-kicker">A FEW THINGS TO KNOW</p>
                <h2>যাত্রার আগে, একটু জেনে নিন।</h2>
                <Link className="back-link" to="/login?role=driver">
                  চালক হিসেবে যোগ দিন <ArrowRight size={17} />
                </Link>
              </div>
              <div>
                {[
                  {
                    q: 'বাস সবসময় লাইভ দেখা যাবে?',
                    a: 'Only during an active trip with recent driver GPS. Stale or offline readings are clearly marked. Phone lock or backgrounding can pause tracking.',
                  },
                  {
                    q: 'সময়সূচি কি নিশ্চিত?',
                    a: 'The supplied timetable is an unverified transcription. No operating days or arrival predictions are assumed. Please confirm before travel.',
                  },
                  {
                    q: 'আমার ব্যক্তিগত অবস্থান কি শেয়ার হবে?',
                    a: 'Students do not share GPS. Driver location is shared only during an active authorized trip and stops when the trip ends.',
                  },
                ].map((item) => (
                  <details key={item.q}>
                    <summary>
                      {item.q}
                      <ArrowDown size={16} />
                    </summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
export function RouteDetail() {
  const { id } = useParams();
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const route = useQuery({
    queryKey: ['route', id],
    queryFn: () => api<{ item: Route }>(`/routes/${id}`),
  });
  const schedule = useQuery({
    queryKey: ['schedule', id, direction],
    queryFn: () =>
      api<Collection<Schedule>>(`/routes/${id}/schedule?direction=${direction}&limit=100`),
  });
  const buses = useQuery({
    queryKey: ['buses', id],
    queryFn: () => api<Collection<Bus>>(`/buses?routeId=${id}&limit=100`),
  });
  if (route.isPending)
    return (
      <div className="container">
        <Loading />
      </div>
    );
  if (!route.data)
    return (
      <div className="container section">
        <ErrorMessage error={route.error} />
      </div>
    );
  const item = route.data.item;
  return (
    <div className="container section">
      <Link to="/routes" className="back-link">
        ← সব রুটে ফিরুন
      </Link>
      <div className="page-heading">
        <div>
          <p className="section-kicker">ROUTE & TIMETABLE</p>
          <h1>{item.nameBn}</h1>
          <p>{item.subtitle || 'ঢাকা বিশ্ববিদ্যালয় পরিবহন'}</p>
        </div>
        <Link to={`/live?routeId=${item._id}`} className="button primary">
          <Navigation size={18} /> লাইভ ম্যাপে দেখুন
        </Link>
      </div>
      <div className="notice">
        <ShieldCheck size={21} />
        <div>
          <VerificationBadge status={item.status} />
          <p>
            These are scheduled departure times, never live arrival predictions. Operating days are
            unknown unless explicitly reviewed. Timezone: Asia/Dhaka.
          </p>
        </div>
      </div>
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>
              <Clock3 size={21} /> সময়সূচি
            </h2>
            <div className="tabs">
              <button
                className={`tab ${direction === 'UP' ? 'active' : ''}`}
                onClick={() => setDirection('UP')}
              >
                আপ · UP
              </button>
              <button
                className={`tab ${direction === 'DOWN' ? 'active' : ''}`}
                onClick={() => setDirection('DOWN')}
              >
                ডাউন · DOWN
              </button>
            </div>
          </div>
          <ErrorMessage error={schedule.error} />
          {schedule.isPending ? (
            <Loading />
          ) : (
            <div className="schedule-list">
              {schedule.data?.items.map((entry) => (
                <div className="schedule-row" key={entry._id}>
                  <div className="schedule-time">
                    <Clock3 size={15} />
                    {timeLabel(entry.departureTime)}
                    <small>{entry.departureTime} · ঢাকা</small>
                  </div>
                  <div className="schedule-place">
                    {entry.departurePlace || 'প্রস্থান স্থান নিশ্চিত নয়'}
                    <div className="schedule-tags">
                      {entry.busType && <span>{entry.busType}</span>}
                      {entry.vehicleNumber && (
                        <span>Source vehicle: {entry.vehicleNumber} (unverified)</span>
                      )}
                      {entry.isStaffOnly && (
                        <span className="badge warning">শুধু স্টাফ · Staff only</span>
                      )}
                      {entry.notes && <span>{entry.notes}</span>}
                      {!entry.daysOfWeek && <span>Operating days unconfirmed</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {schedule.data?.items.length === 0 && (
            <div className="empty-state">এই দিকের সময়সূচি নেই।</div>
          )}
        </section>
        <aside>
          <section className="panel">
            <div className="panel-header">
              <h2>
                <MapPin size={20} /> পথের বিবরণ
              </h2>
            </div>
            <p className="stop-copy">
              {direction === 'UP'
                ? item.routeUpText || 'আপ রুটের বিবরণ নিশ্চিত করা হয়নি।'
                : item.routeDownText || 'ডাউন রুটের বিবরণ নিশ্চিত করা হয়নি।'}
            </p>
            <div className="notice slim">
              Stop descriptions are source transcriptions. No verified map geometry is available.
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>
                <BusFront size={20} /> এই রুটের বাস
              </h2>
            </div>
            {buses.data?.items.length ? (
              buses.data.items.map((bus) => (
                <div className="bus-row" key={bus._id}>
                  <strong>{bus.displayNameBn}</strong>
                  {bus.isDemo && <span className="badge demo">DEMO</span>}
                  <p className="muted">
                    Fleet: {bus.fleetNumber || 'not confirmed'} · {bus.busType.replaceAll('_', ' ')}
                  </p>
                </div>
              ))
            ) : (
              <div className="empty-state compact">
                <BusFront size={29} />
                <p>No approved physical bus has been confirmed for this route.</p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
