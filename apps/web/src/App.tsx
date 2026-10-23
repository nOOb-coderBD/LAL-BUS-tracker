import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  BusFront,
  MapPin,
  ArrowUpRight,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  Navigation,
  WifiOff,
  Compass,
  Clock3,
} from 'lucide-react';
import { useAuth, useConnectivity, Loading } from './api';
import { Home, RouteDetail } from './pages/Explore';
import { Login } from './pages/Login';
const Live = lazy(() => import('./pages/Live').then((module) => ({ default: module.Live })));
const Driver = lazy(() => import('./pages/Driver').then((module) => ({ default: module.Driver })));
const Admin = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Admin })));

function Guard({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user && roles.includes(user.role) ? children : <Navigate to="/login" replace />;
}
export default function App() {
  const { user, logout } = useAuth();
  const online = useConnectivity();
  const [menu, setMenu] = useState(false);
  return (
    <div className="app">
      {!online && (
        <div className="offline-banner" role="status">
          <WifiOff size={16} /> সংযোগ বিচ্ছিন্ন · You’re offline. Live locations cannot update.
        </div>
      )}
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="Lal Bus Tracker home">
            <span className="brand-icon">
              <BusFront size={25} />
            </span>
            <span className="brand-text">
              লাল বাস<span className="brand-subtitle">LAL BUS TRACKER</span>
            </span>
          </Link>
          <nav
            aria-label="Main navigation"
            className={`nav-links ${menu ? 'is-open' : ''}`}
            onClick={() => setMenu(false)}
          >
            <NavLink to="/" end className="nav-link">
              হোম <span>Home</span>
            </NavLink>
            <NavLink to="/routes" className="nav-link">
              রুট ও সময়সূচি <span>Routes</span>
            </NavLink>
            <NavLink to="/live" className="nav-link">
              লাইভ ট্র্যাকিং <span>Live map</span>
            </NavLink>
            {user?.role === 'DRIVER' && (
              <NavLink to="/driver" className="nav-link">
                Driver
              </NavLink>
            )}
            {user?.role === 'ADMIN' && (
              <NavLink to="/admin" className="nav-link">
                Admin
              </NavLink>
            )}
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <span className="avatar" title={user.name}>
                  {user.name?.charAt(0)}
                  {user.isDemo && <span className="avatar-demo" />}
                </span>
                <button className="icon-button" onClick={() => void logout()} aria-label="Sign out">
                  <LogOut size={19} />
                </button>
              </>
            ) : (
              <Link to="/login" className="button primary small">
                শিক্ষার্থী লগইন <ArrowUpRight size={16} />
              </Link>
            )}
            <button
              className="icon-button menu-button"
              onClick={() => setMenu(!menu)}
              aria-label="Toggle navigation"
              aria-expanded={menu}
            >
              {menu ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
      </header>
      {user?.isDemo && (
        <div className="demo-banner">
          <span className="badge demo">DEVELOPMENT DEMO</span> {user.role.toLowerCase()} persona ·
          Simulated identity, not university verification.
        </div>
      )}
      <main id="main">
        <Suspense
          fallback={
            <div className="container">
              <Loading />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/routes" element={<Home routesOnly />} />
            <Route path="/routes/:id" element={<RouteDetail />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/live"
              element={
                <Guard roles={['STUDENT', 'ADMIN']}>
                  <Live />
                </Guard>
              }
            />
            <Route
              path="/driver"
              element={
                <Guard roles={['DRIVER']}>
                  <Driver />
                </Guard>
              }
            />
            <Route
              path="/admin"
              element={
                <Guard roles={['ADMIN']}>
                  <Admin />
                </Guard>
              }
            />
            <Route
              path="*"
              element={
                <div className="container empty-state">
                  <Compass size={36} />
                  <h1>পথ খুঁজে পাওয়া যায়নি</h1>
                  <p>This page has taken a different route.</p>
                  <Link className="button primary" to="/">
                    Back home
                  </Link>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </main>
      <footer className="footer">
        <div className="container footer-grid">
          <div>
            <Link className="brand" to="/">
              <span className="brand-icon">
                <BusFront size={22} />
              </span>
              <span className="brand-text">
                লাল বাস<span className="brand-subtitle">A LITTLE CLOSER TO CAMPUS.</span>
              </span>
            </Link>
            <p>
              বিশ্ববিদ্যালয়ের পথে, একসাথে।
              <br />
              An unofficial student project. Not endorsed by the University of Dhaka.
            </p>
          </div>
          <div>
            <strong>আপনার যাত্রা</strong>
            <Link to="/routes">
              <Clock3 size={15} /> Routes & schedules
            </Link>
            <Link to="/live">
              <MapPin size={15} /> Live bus map
            </Link>
          </div>
          <div>
            <strong>পরিবহন সহযোগী</strong>
            <Link to="/login?role=driver">
              <Navigation size={15} /> Driver sign in
            </Link>
            <Link to="/login?role=admin">
              <ShieldCheck size={15} /> Transport administration
            </Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>Made for the DU community, with care.</span>
          <span>ঢাকা, বাংলাদেশ · Asia/Dhaka</span>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/" end>
          <BusFront size={20} />
          হোম
        </NavLink>
        <NavLink to="/routes">
          <Compass size={20} />
          রুট
        </NavLink>
        <NavLink to="/live">
          <MapPin size={20} />
          লাইভ
        </NavLink>
        <NavLink
          to={user?.role === 'DRIVER' ? '/driver' : user?.role === 'ADMIN' ? '/admin' : '/login'}
        >
          <ShieldCheck size={20} />
          {user ? 'অ্যাকাউন্ট' : 'লগইন'}
        </NavLink>
      </nav>
    </div>
  );
}
